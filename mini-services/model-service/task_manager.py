"""task_manager.py — in-memory async task tracking for video generation.

Holds a registry of generation jobs keyed by `task_id`. Each task runs
in a FIFO asyncio queue served by a single GPU worker.

Robustness features (fixes hallucination / weak-pipeline bugs):
  - Bulletproof parsing of the ---RAG_START--- payload from the web app:
    multiple fallbacks ensure the *clean* user prompt always reaches the
    model, never the raw protocol text.
  - Ollama output sanitization: strips meta text ("Here is..."), labels
    ("Prompt:"), surrounding quotes, and echoed protocol markers that small
    LLMs produce — previously these went straight into Wan2.1 and garbled
    the output.
  - GROUNDING FIREWALL: an LLM rewrite is only accepted if it still
    contains the user's original subject and actions (content-word
    overlap check). A rewrite that drifts onto a different scene — the
    classic prompt hallucination — is discarded.
  - DETERMINISTIC RAG ENHANCEMENT: when Ollama is down, unreachable, or
    its output is rejected, the RAG style keywords are merged into the
    user prompt WITHOUT any LLM. The knowledge base therefore improves
    prompts on every single generation, LLM or not.
  - Ollama reachability pre-check with a cached "down" state so an absent
    Ollama never stalls the GPU queue.
  - Task pruning + latest-task lookup by message id (fixes stale-task
    lookups after a retry).
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import threading
import time
import uuid
from typing import Any, Optional

from wan_inference import model as wan_model, GenerationCancelled

logger = logging.getLogger("task_manager")

# Resolve the output directory relative to this file so it works regardless
# of where the service is launched from.
VIDEOS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "videos")

# --- Ollama configuration ---------------------------------------------------
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:3b")
OLLAMA_TIMEOUT_S = float(os.environ.get("OLLAMA_TIMEOUT", "45"))
# How long to remember that Ollama is down (avoids stalling every job).
OLLAMA_DOWN_CACHE_S = 300.0

_ollama_down_until: float = 0.0

# Terminal task states.
_TERMINAL = ("ready", "failed")

# Age at which completed tasks are pruned from memory (2h).
_TASK_TTL_S = 2 * 60 * 60


# ---------------------------------------------------------------- RAG parsing
_PROTOCOL_MARKERS = ("---RAG_START---", "---RAG_END---", "USER_PROMPT:", "RAG_RULES:", "RAG_INSTRUCTION:")


def _free_of_markers(text: str) -> bool:
    """True if text contains none of the RAG payload protocol markers."""
    return not any(m in text for m in _PROTOCOL_MARKERS)


def _strip_markers(text: str) -> str:
    """Remove all protocol markers and non-printables from a broken payload."""
    out = text
    for marker in _PROTOCOL_MARKERS:
        out = out.replace(marker, " ")
    out = "".join(ch for ch in out if ch.isprintable() or ch in "\n\t")
    out = re.sub(r"[#*\x00-\x1f]+", " ", out)
    out = re.sub(r"\s+", " ", out).strip(" -")
    return out.strip()


def parse_rag_payload(raw: str) -> tuple[str, str]:
    """Split a ---RAG_START--- payload into (user_prompt, rag_rules).

    Never fails: if anything goes wrong the input is returned as-is in the
    user_prompt slot (minus obvious protocol markers) and rules are empty.
    """
    if "---RAG_START---" not in raw:
        return raw, ""

    # Strategy 1: USER_PROMPT ... RAG_RULES sections (canonical layout).
    # [ \t]*\n (not \s*\n) so an EMPTY section stays empty instead of the
    # regex swallowing the following section's header.
    m_user = re.search(r"USER_PROMPT:[ \t]*\n(.*?)(?=\n\s*RAG_RULES:|\n\s*RAG_INSTRUCTION:|\n\s*---RAG_END---|$)", raw, re.DOTALL)
    m_rules = re.search(r"RAG_RULES:[ \t]*\n(.*?)(?=\n\s*RAG_INSTRUCTION:|\n\s*---RAG_END---|$)", raw, re.DOTALL)
    if m_user:
        user = m_user.group(1).strip()
        rules = m_rules.group(1).strip() if m_rules else ""
        if user and _free_of_markers(user):
            # Rules that swallowed protocol text are dropped, not passed on.
            if rules and not _free_of_markers(rules):
                rules = ""
            return user, rules

    # Strategy 2: markers got mangled/truncated — strip protocol lines.
    lines = []
    for line in raw.splitlines():
        s = line.strip()
        if (
            not s
            or s.startswith("---RAG")
            or s in ("USER_PROMPT:", "RAG_RULES:", "RAG_INSTRUCTION:")
            or s.startswith("[Applied knowledge")
        ):
            continue
        lines.append(line)
    return "\n".join(lines).strip(), ""


def normalize_user_prompt(prompt: str) -> str:
    """Normalize user prompt for diffusion transformers (subject-first).

    1. Fix typos (e.g. 'shahehand' -> 'handshake').
    2. Re-order if camera descriptors were prepended before the subject
       (e.g. 'shot on 35mm ... . of a person giving handshake' -> 'A person giving handshake..., shot on 35mm...').
    3. Scale alignment: if humans / interactions are described, prevent
       accidental 'macro close-up' from zooming exclusively into hands/fingers
       and cropping out the people, converting to clear medium two-shot framing.
    """
    if not prompt or not prompt.strip():
        return prompt

    cleaned = prompt.strip()

    # 0. Strip conversational openers and fillers
    cleaned = re.sub(
        r"^(?:i\s+(?:imagine|want|would\s+like|visualize|picture)|can\s+you\s+(?:create|make|generate)|please\s+(?:create|make|generate|show)|imagine|picture|generate|create|make\s+a\s+video\s+of)\s+(?:something\s+)?(?:pretty,\s*|nice,\s*)?",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()
    if cleaned and cleaned[0].islower():
        cleaned = cleaned[0].upper() + cleaned[1:]

    # Strip subjective filler clauses at end
    cleaned = re.sub(
        r"[.,;]?\s*(?:the\s+view\s+is\s+aesthetic\s+and\s+beautiful|it\s+looks?\s+(?:aesthetic|beautiful|gorgeous|stunning|pretty|nice)|very\s+aesthetic|aesthetic\s+and\s+beautiful)\s*[.!]?$",
        ".",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()

    # 1. Common typos and ambiguous physics terms
    cleaned = re.sub(r"\bshahehand\b", "handshake", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bshaking\s+hand\b", "shaking hands", cleaned, flags=re.IGNORECASE)

    # Replace 'ball bearing' which triggers mechanical cogs/gears/tires with 'solid polished chrome steel sphere'
    cleaned = re.sub(r"\b(?:heavy\s+)?steel\s+ball\s+bearing\b", "heavy solid polished chrome steel sphere", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bball\s+bearing\b", "solid polished chrome steel sphere", cleaned, flags=re.IGNORECASE)

    # Stabilize rapid contradictory camera cuts in high-speed macro collision shots (prevents 3D-DiT rotational mirroring artifacts)
    cleaned = re.sub(
        r"CAMERA:\s*SNAP\s+ZOOM\s+IN\s+followed\s+by\s+a\s+SLOW\s+180-DEGREE\s+ORBIT[.,;]?\s*",
        "High-speed slow-motion macro cinematography with a subtle slow push-in: ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\b180-degree orbiting camera circling around\s*", "High-speed slow-motion macro shot: ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b180-degree orbit\s*", "slow-motion macro capture ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bAs the camera orbits,\s*", "Under dynamic lighting, ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^CAMERA:\s*", "", cleaned, flags=re.IGNORECASE)

    # Chess piece disambiguation (knight must be horse-head to prevent King/Queen default)
    cleaned = re.sub(r"\bglass knight piece\b", "carved glass horse-head knight chess piece", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bglass knight\b", "carved glass horse-head knight chess piece", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bshattered knight\b", "pulverized glass debris", cleaned, flags=re.IGNORECASE)

    # Physics fracture & destruction dynamics (anchors subject at t=0 and replaces solid body with complete debris cloud)
    cleaned = re.sub(r"\bthe unbroken glass pieces\b", "the sharp flying glass shards", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bunbroken glass\b", "fractured crystalline shards", cleaned, flags=re.IGNORECASE)

    if "carved glass horse-head knight chess piece" in cleaned and "drops from above" in cleaned:
        cleaned = re.sub(
            r"shattering a carved glass horse-head knight chess piece.*?(?=Thick|Dense|\.|$)",
            "The heavy solid polished chrome steel sphere slams with violent kinetic impact directly into a carved glass horse-head knight chess piece standing upright at the center of the chessboard, instantly pulverizing and shattering it into an explosive expanding radial cloud of hundreds of sharp flying crystalline splinters and razor-sharp glass shards blasting outward in ultra slow-motion, completely destroying the piece with zero intact solid body remaining",
            cleaned,
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(r"drops from above,\s*The heavy solid polished chrome steel sphere slams", "drops from above and slams", cleaned, flags=re.IGNORECASE)

    # Fluid chromatic binding: dense opaque fluorescent pigment overrides clear water prior
    cleaned = re.sub(
        r"\b(?:thick,?\s+)?glowing\s+neon-blue\s+liquid\s+explodes\b",
        "dense opaque fluorescent electric-blue luminous fluid and glowing cyan paint explode in high-velocity volumetric plumes and spray",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\bglowing neon-blue liquid\b", "dense opaque luminous electric-blue liquid", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bneon liquid\b", "glowing electric-blue fluid", cleaned, flags=re.IGNORECASE)

    # 2. Check if prompt starts with camera specs and ends with ". of [subject]"
    m = re.match(
        r"^(shot on|filmed on|cinematic|ultra-sharp|macro)[^.]*\.\s*(?:of\s+)?([a-z0-9\s,\-_]+)$",
        cleaned,
        flags=re.IGNORECASE,
    )
    if m:
        camera_part = cleaned[: cleaned.rfind(".")].strip()
        subject_part = m.group(2).strip()
        if subject_part:
            subject_part = subject_part[0].upper() + subject_part[1:]
            cleaned = f"{subject_part}, {camera_part}"

    # 3. If human subjects are mentioned, prevent macro close-up from cropping out their bodies/faces
    has_humans = bool(
        re.search(
            r"\b(person|people|man|woman|men|women|individual|individuals|someone|couple|friends)\b",
            cleaned,
            flags=re.IGNORECASE,
        )
    )
    explicit_hands_only = bool(
        re.search(
            r"\b(hands?\s+only|macro\s+hand|finger\s+macro|close-up\s+of\s+hands?)\b",
            cleaned,
            flags=re.IGNORECASE,
        )
    )

    if has_humans and not explicit_hands_only:
        cleaned = re.sub(
            r"ultra-sharp\s+macro\s+close-up",
            "medium two-shot with sharp focus showing upper bodies and faces",
            cleaned,
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(
            r"\bmacro\s+close-up\b",
            "medium shot showing subjects clearly",
            cleaned,
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(r"\bmacro\s+lens\b", "portrait lens", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\bmacro\s+photography\b", "cinematic portraiture", cleaned, flags=re.IGNORECASE)

    return cleaned


def sanitize_llm_output(text: str, fallback: str) -> str:
    """Clean an LLM prompt-rewrite so only the visual description remains.

    Small local models (llama3.2:3b) frequently wrap their answer in meta
    text. Anything suspicious → return the fallback (the clean user prompt)
    instead of feeding garbage to the video model.
    """
    if not text or not text.strip():
        return fallback

    out = text.strip()

    # If the model echoed the protocol, that's an automatic reject.
    if "---RAG_START---" in out or "USER_PROMPT:" in out or "RAG_RULES:" in out:
        return fallback

    # Conversational openers mean the model ANSWERED instead of writing the
    # description — reject outright (stripping the preamble used to leave
    # sentence fragments like "video project." behind).
    if re.match(r"^(here|sure|certainly|of course|i (will|can'|ve)|as requested)\b", out, re.IGNORECASE):
        return fallback

    # Remove surrounding quotes (single or double, possibly multiline).
    if len(out) >= 2 and out[0] in "\"'" and out[-1] == out[0]:
        out = out[1:-1].strip()

    # Drop common preamble lines.
    preamble = re.compile(
        r"^(here('| i)?s( the| your| an)? (rewritten |enhanced |final |improved )?(visual )?(description|prompt)[^:\n]{0,40}:?|"
        r"sure[,!][^:\n]{0,60}:?|"
        r"(enhanced |rewritten |final |improved )?prompt\s*[:\-]|"
        r"output\s*[:\-]|"
        r"prompt\s*[:\-])\s*",
        re.IGNORECASE,
    )
    out = preamble.sub("", out).strip()

    # Remove markdown emphasis wrappers.
    out = re.sub(r"^[*_`#>\-]+\s*", "", out).strip()
    if out.endswith("*") or out.endswith("`"):
        out = out.rstrip("*`").strip()

    # Reject outputs that still look like meta text or are lists.
    if re.match(r"^(here|sure|certainly|of course|i (will|can'|ve)|as requested)\b", out, re.IGNORECASE):
        return fallback
    lines = [l.strip() for l in out.splitlines() if l.strip()]
    list_markers = sum(1 for l in lines if re.match(r"^([-*•]|\d+[.)])\s+", l))
    # A good video prompt is one paragraph — bullet/numbered lists or many
    # short lines mean the model answered conversationally.
    if list_markers >= 2 or len(lines) > 4:
        return fallback

    # Length sanity: a good video prompt is a sentence or short paragraph.
    if len(out) < 12:
        return fallback
    if len(out) > 1500:
        out = out[:1500].rsplit(".", 1)[0] + "."

    return out or fallback


# ------------------------------------------------------------ Grounding check
# Words that carry no scene identity, so their absence from a rewrite is
# never evidence of hallucination. Includes conversational and subjective filler.
_GROUNDING_STOPWORDS = {
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "her",
    "was", "one", "our", "out", "his", "has", "have", "this", "that",
    "with", "from", "they", "will", "would", "there", "their", "what",
    "about", "which", "when", "your", "into", "very", "just", "some",
    "video", "clip", "generate", "create", "make", "please", "want",
    "need", "show", "like", "using", "scene", "shot", "footage",
    "imagine", "imagining", "something", "pretty", "peaceful", "aesthetic",
    "beautiful", "nice", "good", "cool", "gorgeous", "stunning", "awesome",
    "view", "looking", "look", "looks", "filling", "whole", "entire",
    "around", "set", "ambient", "atmosphere", "vibe", "vibes",
}


def content_words(text: str) -> list[str]:
    """Lowercase content-bearing words of a prompt (no stopwords)."""
    words = re.findall(r"[a-z0-9']+", text.lower())
    return [w for w in words if len(w) > 2 and w not in _GROUNDING_STOPWORDS]


def _word_matches(word: str, target_words: set[str]) -> bool:
    if word in target_words:
        return True
    for tw in target_words:
        if tw == word:
            return True
        if len(word) >= 4 and len(tw) >= 4:
            if tw.startswith(word[:4]) or word.startswith(tw[:4]):
                return True
        # specific common stems e.g. flying/flight, person/people
        if (word in ("flying", "fly") and "flight" in tw) or (tw in ("flying", "fly") and "flight" in word):
            return True
        if (word in ("birds", "bird") and "flock" in tw) or (tw in ("birds", "bird") and "flock" in word):
            return True
    return False


def grounding_ratio(user_prompt: str, rewritten: str) -> float:
    """Share of the user's content words that survive in the rewrite.

    1.0 = every subject/action word kept. 0.0 = the rewrite describes a
    completely different scene (hallucination).
    """
    uw = content_words(user_prompt)
    if not uw:
        return 1.0
    rw = set(content_words(rewritten))
    kept = sum(1 for w in uw if _word_matches(w, rw))
    return kept / len(uw)


def verify_prompt_grounding(user_prompt: str, rewritten: str) -> tuple[bool, float]:
    """Accept an LLM rewrite only if it stays on the user's subject.

    Short prompts (≤3 content words) demand a higher survival ratio —
    with so few anchors, losing even one changes the scene.
    """
    uw = content_words(user_prompt)
    ratio = grounding_ratio(user_prompt, rewritten)
    min_ratio = 0.28 if len(uw) > 3 else 0.50
    return ratio >= min_ratio, ratio


# ------------------------------------------------- Deterministic RAG enhance
# Quality tail appended when the prompt lacks quality vocabulary. These are
# the highest-value professional keywords from the knowledge base.
_QUALITY_TAIL = ("highly detailed", "crisp focus", "smooth stable motion")


def _normalise_phrase(p: str) -> str:
    return re.sub(r"\s+", " ", p).strip()


# Mutually exclusive weather/environment terms to prevent contradictory RAG phrases
_MUTUALLY_EXCLUSIVE_WEATHER = {
    "fog", "mist", "haze", "snow", "snowfall", "blizzard", "storm", "thunderstorm",
    "rain", "downpour", "cyclone", "overcast", "sunny", "night", "twilight"
}


def _is_phrase_compatible(phrase: str, user_prompt: str) -> bool:
    p_lower = phrase.lower()
    u_lower = user_prompt.lower()
    for w in _MUTUALLY_EXCLUSIVE_WEATHER:
        if w in p_lower and w not in u_lower:
            return False
    return True


def extract_style_phrases(
    rag_rules: str, user_prompt: str = "", limit: int = 4
) -> list[str]:
    """Pull usable style keywords out of retrieved RAG rules — no LLM needed.

    Sources, in priority order:
      1. Short quoted phrases: 'god rays', 'slow motion, 120fps' — the
         corpus marks ready-to-use prompt keywords with quotes.
      2. Bold labels: **Rack Focus** → 'rack focus' — category terms that
         also work as prompt keywords.

    Full example sentences (quoted text ending in a period) and phrases
    that mostly repeat words the prompt already has are skipped.
    Incompatible weather keywords (e.g. fog/snow when user didn't ask for them) are strictly filtered.
    """
    prompt_words = set(content_words(user_prompt))
    seen: set[str] = set()
    out: list[str] = []

    def _try_add(raw: str) -> None:
        raw = raw.strip()
        # Full example sentences end with a period — check BEFORE any
        # normalisation strips it away.
        if not raw or raw.endswith(".") or raw.count(" ") > 7:
            return
        p = _normalise_phrase(raw)
        if not p or len(p) > 48:
            return
        # Reject contradictory weather conditions not requested by the user
        if not _is_phrase_compatible(p, user_prompt):
            return
        key = p.lower()
        if key in seen:
            return
        words = [w for w in re.findall(r"[a-z0-9']+", key) if len(w) > 2]
        if not words:
            return
        # Skip phrases whose words are (mostly) already in the prompt —
        # they would only duplicate what the user wrote.
        if prompt_words:
            shared = sum(1 for w in words if w in prompt_words)
            if shared * 2 >= len(words):
                return
        seen.add(key)
        out.append(p)

    # 1) Quoted phrases (single and double quotes).
    for m in re.findall(r"'([^'\n]{3,60})'", rag_rules):
        _try_add(m)
    for m in re.findall(r'"([^"\n]{3,60})"', rag_rules):
        _try_add(m)

    # 2) Bold labels — take the first alternative of "A / B" labels.
    for m in re.findall(r"\*\*([^*\n]+)\*\*", rag_rules):
        _try_add(m.split("/")[0])

    return out[:limit]


def deterministic_enhance(
    user_prompt: str, rag_rules: str, max_total_chars: int = 1500
) -> str:
    """Merge RAG style keywords into the user prompt WITHOUT any LLM.

    Used when Ollama is down or its rewrite was rejected — the knowledge
    base still professionalizes the prompt on every generation.
    """
    user_prompt = normalize_user_prompt(user_prompt)
    if not rag_rules or not user_prompt:
        return user_prompt

    base = user_prompt.strip().rstrip()
    if base and base[-1] not in ".!?":
        base += "."

    parts: list[str] = []
    phrases = extract_style_phrases(rag_rules, user_prompt)
    if phrases:
        parts.append("Style: " + "; ".join(phrases) + ".")

    # Quality tail is checked against base AND style part together so
    # keywords are never repeated within the final prompt.
    combined = (base + " " + " ".join(parts)).lower()
    tail = [q for q in _QUALITY_TAIL if q not in combined]
    if tail:
        parts.append(" ".join(tail) + ".")

    if not parts:
        return base

    enhanced = (base + " " + " ".join(parts)).strip()
    return enhanced[:max_total_chars]


def _ollama_reachable() -> bool:
    """Quick reachability check with a negative cache."""
    global _ollama_down_until
    if time.time() < _ollama_down_until:
        return False
    import urllib.request

    try:
        req = urllib.request.Request(OLLAMA_URL + "/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=3):
            return True
    except Exception:
        _ollama_down_until = time.time() + OLLAMA_DOWN_CACHE_S
        logger.warning("Ollama not reachable at %s — skipping LLM rewrite for %d s", OLLAMA_URL, int(OLLAMA_DOWN_CACHE_S))
        return False


def rewrite_prompt_with_ollama(raw_payload: str) -> str:
    """Turn the RAG payload into the final model prompt.

    Path A: payload has RAG markers + Ollama is up → ask the LLM to
            merge the style rules into the prompt, then SANITIZE and
            verify GROUNDING (the rewrite must keep the user's
            subject/actions — otherwise it is a hallucination and is
            discarded).
    Path B: Ollama down / output rejected / grounding failed →
            DETERMINISTIC enhancement: RAG keywords are merged into
            the clean user prompt without any LLM.
    Path C: plain prompt (no markers) → unchanged.
    """
    if "---RAG_START---" not in raw_payload:
        return normalize_user_prompt(raw_payload)

    user_prompt, rag_rules = parse_rag_payload(raw_payload)
    if not user_prompt:
        # Nothing usable extracted — strip every protocol marker so garbage
        # NEVER reaches the video model; fall back to a neutral safe prompt
        # if nothing human-readable remains.
        cleaned = _strip_markers(raw_payload)
        return cleaned or "a calm cinematic establishing shot, smooth stable motion"

    user_prompt = normalize_user_prompt(user_prompt)

    if not rag_rules:
        return user_prompt

    if not _ollama_reachable():
        # RAG knowledge applies even without the LLM.
        enhanced = deterministic_enhance(user_prompt, rag_rules)
        logger.info("Ollama down — deterministic RAG enhancement applied.")
        return enhanced

    try:
        import urllib.request
        import json

        logger.info("Querying Ollama (%s) for RAG rewrite...", OLLAMA_MODEL)
        system_prompt = (
            "You are an expert cinematic director and AI video prompt engineer. Merge the user's prompt "
            "with the STYLE RULES into ONE cohesive, photorealistic visual description for a text-to-video diffusion model.\n"
            "Strict Guidelines:\n"
            "1. CONTINUOUS TEMPORAL PERSISTENCE (SUBJECTS NEVER VANISH): Every key moving subject (such as a flock of birds, animals, running people, moving vehicles) MUST remain continuously visible in frame throughout the ENTIRE duration of the shot from beginning to end. NEVER use exit or transient terms like 'glides across and exits', 'flies away', or 'disappears'. Always explicitly describe continuous in-frame motion.\n"
            "2. CAMERA STABILITY FOR HIGH-SPEED PHYSICS: For physical impacts, shattering, slow-motion splashes, or macro physics, NEVER use disorienting 180-degree orbits or snap-zooms (which trigger spatial mirroring artifacts and dumbbell mutations in 3D diffusion latents). Anchor the shot with high-speed slow-motion macro cinematography and a subtle slow push-in tracking the impact point.\n"
            "3. INITIAL SCENE ANCHOR (ESTABLISH SUBJECT AT T=0): The primary target object must be established standing firmly in place as the initial scene setup (e.g. 'At the center of a transparent glass chessboard on dark marble, an intricately carved glass horse-head knight chess piece stands upright').\n"
            "4. COMPLETE PHYSICAL OBLITERATION & DEBRIS DYNAMICS: A heavy solid polished chrome steel sphere drops from above and slams with violent kinetic impact directly into the target object. Upon violent impact, the target object completely obliterates and disintegrates into an explosive expanding radial cloud of hundreds of razor-sharp flying crystalline splinters, pulverized glass shards, and fracture debris blasting outward in ultra slow-motion. Zero solid pieces remain intact.\n"
            "5. DENSE OPAQUE FLUORESCENT FLUIDS (NO CLEAR WATER): Diffusion models heavily bias 'liquid' towards clear water. Always explicitly describe colored liquids as 'dense opaque fluorescent electric-blue luminous fluid and glowing cyan paint' erupting from the impact crater in volumetric self-luminous plumes and violently splattering glowing cyan droplets across the surface. Never describe the color as a mere surface reflection.\n"
            "6. TIME OF DAY & WEATHER RIGIDITY: Strictly adhere to requested time of day and lighting. NEVER inject contradictory weather.\n"
            "7. HUMAN & SCALE FIDELITY: When people are present, maintain eye-level medium shots or two-shots showing upper bodies and postures; never collapse into disembodied hands-only closeups.\n"
            "8. OPTICAL CLARITY: Specify crystal-clear focus, sharp defined silhouettes, zero motion ghosting, zero double-exposure, rich volumetric lighting, and steady cinematic motion.\n"
            "9. FORMAT & LENGTH: Output ONLY the visual description as a single unified paragraph between 50 and 80 words. No markdown, introductions, labels, or bullet points."
        )
        llm_input = f"USER PROMPT:\n{user_prompt}\n\nSTYLE RULES:\n{rag_rules}"

        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate",
            data=json.dumps({
                "model": OLLAMA_MODEL,
                "system": system_prompt,
                "prompt": llm_input,
                "stream": False,
                "options": {"temperature": 0.2},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT_S) as response:
            res_data = json.loads(response.read().decode())
            raw_out = res_data.get("response", "").strip()

        enhanced = sanitize_llm_output(raw_out, fallback=user_prompt)
        if enhanced == user_prompt:
            logger.info(
                "Ollama output rejected by sanitizer — deterministic RAG enhancement applied."
            )
            return deterministic_enhance(user_prompt, rag_rules)

        # Grounding firewall: the rewrite must still describe the
        # user's scene, not a hallucinated different one.
        grounded, ratio = verify_prompt_grounding(user_prompt, enhanced)
        if not grounded:
            logger.warning(
                "Grounding check FAILED (only %.0f%% of the original subject kept) "
                "— LLM rewrite discarded, deterministic enhancement applied.",
                ratio * 100,
            )
            return deterministic_enhance(user_prompt, rag_rules)

        # Apply deterministic normalization to guarantee no leaked polysemous tokens or conflicting camera cuts
        enhanced = normalize_user_prompt(enhanced)
        logger.info(
            "Ollama rewrite accepted (grounding %.0f%%): %s",
            ratio * 100, enhanced[:100] + "..."
        )
        return enhanced
    except Exception as e:
        logger.error(
            "Failed to rewrite prompt with Ollama: %s — deterministic enhancement applied.", e
        )
        return deterministic_enhance(user_prompt, rag_rules)


class TaskManager:
    # Initial guess for one generation (seconds) for 81 frames Wan 2.2 14B (~14.5 minutes).
    DEFAULT_GEN_SECONDS = 870.0

    def __init__(self) -> None:
        self._tasks: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()
        # FIFO of task_ids waiting for the GPU (not including the running one).
        self._waiting: list[str] = []
        self._running_id: Optional[str] = None
        self._running_started: float = 0.0
        self._avg_seconds: float = self.DEFAULT_GEN_SECONDS
        self._queue: Optional[asyncio.Queue[str]] = None
        self._worker: Optional[asyncio.Task] = None
        os.makedirs(VIDEOS_DIR, exist_ok=True)

    def _ensure_worker(self) -> None:
        """Lazily start the single GPU worker on the running event loop."""
        if self._queue is None:
            self._queue = asyncio.Queue()
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._worker_loop())

    async def _worker_loop(self) -> None:
        assert self._queue is not None
        while True:
            task_id = await self._queue.get()
            try:
                async with self._lock:
                    if task_id in self._waiting:
                        self._waiting.remove(task_id)
                    task = self._tasks.get(task_id)
                    if task is None or task.get("status") in _TERMINAL or task.get("cancelled"):
                        continue
                    self._running_id = task_id
                    self._running_started = time.time()
                    prompt = task["prompt"]
                    input_path = task.get("input_path")
                started = time.time()
                await self._run_generation(task_id, prompt, input_path)
                async with self._lock:
                    if self._tasks.get(task_id, {}).get("status") == "ready":
                        took = time.time() - started
                        # Exponential moving average of real generation time.
                        self._avg_seconds = 0.6 * self._avg_seconds + 0.4 * took
            except Exception:
                logger.exception("Worker crashed on task %s", task_id)
            finally:
                self._running_id = None
                self._queue.task_done()

    def _running_remaining(self, task: Optional[dict[str, Any]] = None) -> float:
        """Calculate accurate, phase-aware ETA countdown based on actual generation pipeline."""
        if self._running_id is None:
            return 0.0
        now = time.time()
        elapsed = max(0.0, now - self._running_started)
        if task is None:
            task = self._tasks.get(self._running_id)
        if not task:
            return max(5.0, self._avg_seconds - elapsed)

        progress = task.get("progress", 0)
        is_real = wan_model.mode == "real"
        if not is_real:
            return max(1.0, 8.0 * (1.0 - progress / 100.0))

        # Real Wan 2.2 14B stage-aware duration tracking (81 frames):
        # Phase 1 (0 -> 10%): Prompt rewrite & Text Encoder (~50s)
        # Phase 2 (10 -> 90%): 4 Diffusion steps (~710s, ~177.5s per step)
        # Phase 3 (90 -> 95%): GPU VAE Decode (~105s)
        # Phase 4 (95 -> 100%): Polish & MMAudio (~30s)
        if progress < 10:
            rem_p1 = max(5.0, 50.0 - elapsed)
            return rem_p1 + 710.0 + 105.0 + 30.0
        elif progress < 90:
            diff_fraction_left = (90.0 - progress) / 80.0
            return (diff_fraction_left * 710.0) + 105.0 + 30.0
        elif progress < 95:
            vae_fraction_left = (95.0 - progress) / 5.0
            return (vae_fraction_left * 105.0) + 30.0
        elif progress < 100:
            audio_fraction_left = (100.0 - progress) / 5.0
            return max(3.0, audio_fraction_left * 30.0)
        else:
            return 0.0

    async def queue_info(self) -> dict[str, Any]:
        async with self._lock:
            waiting = len(self._waiting)
            busy = self._running_id is not None
            curr_running = self._tasks.get(self._running_id) if self._running_id else None
            eta = self._running_remaining(curr_running) + waiting * self._avg_seconds
            return {
                "waiting": waiting,
                "running": busy,
                "avg_seconds": round(self._avg_seconds, 1),
                "wait_seconds": int(round(eta)),
            }

    # ----------------------------------------------------------- accessors
    async def create_task(
        self,
        prompt: str,
        enhanced_prompt: str,
        message_id: str,
        attachment_base64: Optional[str] = None,
        resolution: Optional[str] = None,
    ) -> str:
        """Register a new task and kick off generation in the background."""
        task_id = uuid.uuid4().hex[:16]
        prompt_to_use = (enhanced_prompt or prompt).strip() or prompt.strip()
        target_res = (resolution or os.environ.get("HANVID_RESOLUTION", "2k")).strip().lower()

        input_path = None
        if attachment_base64:
            try:
                import base64
                # format is usually "data:video/mp4;base64,AAAA..." or "data:image/jpeg;base64,..."
                header, data = attachment_base64.split(",", 1) if "," in attachment_base64 else ("", attachment_base64)
                ext = ".mp4" if "video" in header else ".jpg"
                os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads"), exist_ok=True)
                input_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", f"{task_id}_input{ext}")
                with open(input_path, "wb") as f:
                    f.write(base64.b64decode(data))
            except Exception as e:
                logger.error("Failed to decode attachment: %s", e)
                input_path = None

        async with self._lock:
            # Prune old terminal tasks so the registry can't grow forever.
            now = time.time()
            stale = [
                tid for tid, t in self._tasks.items()
                if t.get("status") in _TERMINAL and now - t.get("created_at", now) > _TASK_TTL_S
            ]
            for tid in stale:
                self._tasks.pop(tid, None)

            self._tasks[task_id] = {
                "status": "queued",
                "progress": 0,
                "video_path": None,
                "video_url": None,
                "width": None,
                "height": None,
                "duration": None,
                "error": None,
                "created_at": time.time(),
                "prompt": prompt_to_use,
                "message_id": message_id,
                "mode": wan_model.mode,
                "input_path": input_path,
                "resolution": target_res,
                "cancel_event": threading.Event(),
                "cancelled": False,
            }
            self._waiting.append(task_id)

        # Enqueue for the single GPU worker. Return immediately.
        self._ensure_worker()
        assert self._queue is not None
        await self._queue.put(task_id)
        logger.info(
            "Task %s queued (prompt len=%d, position=%d)",
            task_id, len(prompt_to_use), len(self._waiting),
        )
        return task_id

    async def cancel_by_message(self, message_id: str) -> bool:
        """Cancel tasks for a message and signal stop if currently generating."""
        found = False
        async with self._lock:
            for tid, task in self._tasks.items():
                if task.get("message_id") == message_id:
                    found = True
                    if task.get("status") not in _TERMINAL:
                        task["status"] = "failed"
                        task["cancelled"] = True
                        task["error"] = "Cancelled by user"
                        ev = task.get("cancel_event")
                        if ev:
                            ev.set()
                        if tid in self._waiting:
                            self._waiting.remove(tid)
                        logger.info("Task %s cancelled via message_id %s", tid, message_id)
        return found

    async def cancel_task(self, task_id: str) -> bool:
        """Cancel a single task by its task_id."""
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return False
            if task.get("status") not in _TERMINAL:
                task["status"] = "failed"
                task["cancelled"] = True
                task["error"] = "Cancelled by user"
                ev = task.get("cancel_event")
                if ev:
                    ev.set()
                if task_id in self._waiting:
                    self._waiting.remove(task_id)
                logger.info("Task %s cancelled via task_id", task_id)
            return True

    async def cancel_all(self) -> int:
        """Immediately cancel all queued and running tasks and clear the waiting queue."""
        count = 0
        async with self._lock:
            self._waiting.clear()
            for tid, task in self._tasks.items():
                if task.get("status") not in _TERMINAL:
                    task["status"] = "failed"
                    task["cancelled"] = True
                    task["error"] = "Cancelled by user"
                    ev = task.get("cancel_event")
                    if ev:
                        ev.set()
                    count += 1
            if self._running_id:
                logger.info("Active running task %s signalled to cancel", self._running_id)
        logger.info("Cancelled %d task(s)", count)
        return count

    async def get_task(self, task_id: str) -> Optional[dict[str, Any]]:
        """Return a serializable snapshot of a task."""
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return None
            return self._build_view(task_id, task)

    async def get_task_by_message(self, message_id: str) -> Optional[dict[str, Any]]:
        """Return the LATEST task for a message (retries create new tasks)."""
        async with self._lock:
            latest: Optional[tuple[str, dict[str, Any]]] = None
            for tid, t in self._tasks.items():
                if t.get("message_id") == message_id:
                    # Prefer a non-terminal task; otherwise the most recent.
                    if latest is None:
                        latest = (tid, t)
                    elif latest[1]["status"] in _TERMINAL and t["status"] not in _TERMINAL:
                        latest = (tid, t)
            if latest is None:
                return None
            return self._build_view(latest[0], latest[1])

    def _build_view(self, task_id: str, task: dict[str, Any]) -> dict[str, Any]:
        view = self._public_view(task)
        if task["status"] == "queued" and task_id in self._waiting:
            pos = self._waiting.index(task_id)  # 0-based among waiting
            view["queue_position"] = pos + 1
            view["queue_length"] = len(self._waiting)
            curr_running = self._tasks.get(self._running_id) if self._running_id else None
            view["eta_seconds"] = int(round(
                self._running_remaining(curr_running) + (pos + 1) * self._avg_seconds
            ))
        elif task["status"] == "generating":
            view["eta_seconds"] = int(round(self._running_remaining(task)))
        return view

    # --------------------------------------------------------------- helpers
    @staticmethod
    def _public_view(task: dict[str, Any]) -> dict[str, Any]:
        """Strip private fields and produce the /status payload."""
        view: dict[str, Any] = {
            "status": task["status"],
            "progress": task["progress"],
        }
        if task["status"] == "ready":
            view["video_url"] = task.get("video_url")
            view["task_id"] = task.get("task_id_hint") or None
            view["duration"] = task.get("duration")
            view["width"] = task.get("width")
            view["height"] = task.get("height")
            view["mode"] = task.get("mode")
        if task["status"] == "failed":
            view["error"] = task.get("error")
        return view

    async def _set(self, task_id: str, **fields: Any) -> None:
        async with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].update(fields)

    async def _set_progress(self, task_id: str, pct: int) -> None:
        await self._set(task_id, progress=int(max(0, min(100, pct))))

    # ------------------------------------------------------------ generation
    async def _run_generation(self, task_id: str, prompt: str, input_path: Optional[str] = None) -> None:
        logger.info("Task %s: starting generation (mode=%s)", task_id, wan_model.mode)

        try:
            loop = asyncio.get_running_loop()
            prompt = await loop.run_in_executor(None, rewrite_prompt_with_ollama, prompt)
            await self._set(task_id, prompt=prompt)  # Update the task with the clean prompt
        except Exception as e:
            logger.error("Error running Ollama wrapper: %s", e)

        try:
            task = self._tasks.get(task_id)
            if task and (task.get("status") in _TERMINAL or task.get("cancelled")):
                logger.info("Task %s was cancelled before generation — stopping.", task_id)
                return
            await self._set(task_id, status="generating", progress=5)
            if wan_model.loaded:
                await self._run_real(task_id, prompt, input_path)
            else:
                # Demo mode (no torch / GPU / weights): render an ffmpeg
                # placeholder so the web UI stays fully functional, instead
                # of failing every task with "model not loaded".
                await self._run_demo(task_id, prompt)

        except GenerationCancelled as exc:
            logger.info("Task %s generation cancelled: %s", task_id, exc)
            await self._set(task_id, status="failed", error="Cancelled by user")
        except Exception as exc:
            logger.exception("Task %s failed: %s", task_id, exc)
            await self._set(task_id, status="failed", error=str(exc))
        finally:
            if input_path and os.path.exists(input_path):
                try:
                    os.remove(input_path)
                except Exception as e:
                    logger.warning("Failed to delete input file %s: %s", input_path, e)

    async def _run_demo(self, task_id: str, prompt: str) -> None:
        """Placeholder generation for demo mode (see demo_generator.py)."""
        loop = asyncio.get_running_loop()
        output_path = os.path.join(VIDEOS_DIR, f"{task_id}.mp4")

        import demo_generator

        def _job() -> dict:
            # Show the *clean* user prompt (not the RAG protocol text).
            clean_prompt = parse_rag_payload(prompt)[0] or prompt
            return demo_generator.generate_demo_video(clean_prompt[:80], output_path)

        info = await loop.run_in_executor(None, _job)
        await self._set_progress(task_id, 60)

        await self._set(
            task_id,
            status="ready",
            progress=100,
            video_path=output_path,
            video_url=f"/video/{task_id}",
            task_id_hint=task_id,
            width=info["width"],
            height=info["height"],
            duration=info["duration"],
            mode="demo",
        )
        logger.info("Task %s READY (demo): %s", task_id, output_path)

    async def _run_real(self, task_id: str, prompt: str, input_path: Optional[str] = None) -> None:
        """Real Wan generation. Writes the MP4 via imageio if available,
        else falls back to ffmpeg.

        Whatever the path, `info` must contain width/height/duration.
        """
        if not wan_model.loaded or wan_model.pipeline is None:
            raise RuntimeError("model not loaded")

        loop = asyncio.get_running_loop()

        def _apply_progress(p: int) -> None:
            # Runs on the event-loop thread; the dict is only mutated here
            # or under the lock from coroutines on the same thread.
            t = self._tasks.get(task_id)
            if t is not None and t["status"] == "generating":
                t["progress"] = int(max(t.get("progress", 0), min(94, p)))

        def _on_progress(p: int) -> None:
            # Called from the inference worker thread.
            loop.call_soon_threadsafe(_apply_progress, p)

        task = self._tasks.get(task_id)
        cancel_event = task.get("cancel_event") if task else None

        def _is_cancelled() -> bool:
            if cancel_event and cancel_event.is_set():
                return True
            t = self._tasks.get(task_id)
            return t is None or t.get("status") in _TERMINAL or t.get("cancelled", False)

        # Run inference in a worker thread so we don't block the loop.
        info = await loop.run_in_executor(
            None,
            lambda: wan_model.generate(
                prompt,
                input_path=input_path,
                on_progress=_on_progress,
                is_cancelled=_is_cancelled,
            ),
        )

        # Free VRAM for audio generation.
        await loop.run_in_executor(None, lambda: wan_model.unload())

        await self._set_progress(task_id, 95)

        # Write MP4 from frames. Prefer imageio, fall back to ffmpeg.
        output_path = os.path.join(VIDEOS_DIR, f"{task_id}.mp4")
        await loop.run_in_executor(
            None,
            lambda: self._export_mp4(info["frames"], output_path, info),
        )

        # ------------------------------------------------------------
        # RTX 5070 "anti-disturbance" pass (video_polish.py):
        #   temporal denoise (hqdn3d) + deflicker + unsharp + gentle color
        #   lift — runs on the CPU via ffmpeg, costs a few seconds, uses no
        #   VRAM, and removes the frame-to-frame noise/pulsing that reads as
        #   "disturbed" output. Runs BEFORE audio muxing so MMAudio sees the
        #   final visuals. Never raises; polish failures keep the original.
        # ------------------------------------------------------------
        await self._set_progress(task_id, 96)
        try:
            import video_polish

            task_res = self._tasks.get(task_id, {}).get("resolution") or os.environ.get("HANVID_RESOLUTION", "2k")
            result = await loop.run_in_executor(
                None, lambda: video_polish.polish_video(output_path, resolution=task_res)
            )
            if result.get("polished"):
                if result.get("width") and result.get("height"):
                    info["width"] = result["width"]
                    info["height"] = result["height"]
                logger.info(
                    "Task %s polished & upscaled (%s → %s %dx%d): %s",
                    task_id, result.get("strength"), result.get("resolution", "2k"),
                    info["width"], info["height"], result.get("note"),
                )
            else:
                logger.info("Task %s polish skipped: %s", task_id, result.get("note"))
        except Exception as e:
            logger.warning("Polish stage unavailable for %s: %s", task_id, e)

        try:
            import audio_generator
            duration = info["num_frames"] / info["fps"]
            # MMAudio is conditioned on the clean prompt too.
            clean_prompt = parse_rag_payload(prompt)[0] or prompt
            await loop.run_in_executor(
                None,
                lambda: audio_generator.add_audio_to_video(output_path, clean_prompt, duration)
            )
            # Unload MMAudio to free VRAM for the next Wan run
            await loop.run_in_executor(None, lambda: audio_generator.unload())
        except Exception as e:
            logger.warning("Failed to generate audio for %s: %s", task_id, e)

        await self._set(
            task_id,
            status="ready",
            progress=100,
            video_path=output_path,
            video_url=f"/video/{task_id}",
            task_id_hint=task_id,
            width=info["width"],
            height=info["height"],
            duration=info["num_frames"] / info["fps"],
        )
        logger.info("Task %s READY (real): %s", task_id, output_path)

    # ------------------------------------------------------------ mp4 export
    @staticmethod
    def _export_mp4(frames: list, output_path: str, info: dict) -> None:
        """Export an in-memory frame list to MP4 using imageio if available,
        otherwise via ffmpeg subprocess. Never raises silently — any error
        bubbles up to the caller which marks the task as failed."""
        fps = info.get("fps", 16)
        w = info["width"]
        h = info["height"]

        try:
            import imageio.v2 as imageio  # type: ignore

            writer = imageio.get_writer(
                output_path, fps=fps, codec="libx264",
                quality=9, macro_block_size=1,
                # yuv420p is required for browser/QuickTime playback - the
                # default pix_fmt can look distorted or fail to play.
                pixelformat="yuv420p",
                ffmpeg_params=["-movflags", "+faststart"],
            )
            for frame in frames:
                writer.append_data(frame)
            writer.close()
            return
        except ImportError:
            pass

        # Fallback: write PNGs to a temp dir and stitch with ffmpeg.
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            try:
                from PIL import Image  # type: ignore
                import numpy as np  # type: ignore

                for i, frame in enumerate(frames):
                    arr = np.array(frame) if not hasattr(frame, "convert") else np.array(frame.convert("RGB"))
                    img = Image.fromarray(arr.astype("uint8"))
                    img.save(os.path.join(tmp, f"f{i:05d}.png"))
            except ImportError:
                # Last resort: dump raw and hope ffmpeg can read.
                raise RuntimeError(
                    "Neither imageio nor Pillow is installed; cannot export MP4"
                )

            # Stitch PNGs with ffmpeg.
            import subprocess

            ffmpeg_bin = os.environ.get("FFMPEG_BIN")
            if not ffmpeg_bin:
                try:
                    import imageio_ffmpeg  # type: ignore

                    ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
                except Exception:
                    ffmpeg_bin = "ffmpeg"

            cmd = [
                ffmpeg_bin,
                "-y",
                "-framerate", str(fps),
                "-i", os.path.join(tmp, "f%05d.png"),
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                "-loglevel", "error",
                output_path,
            ]
            subprocess.run(cmd, check=True, capture_output=True)


# Module-level singleton — server.py imports this.
task_manager = TaskManager()
