"""test_guardrails.py — verifies the anti-hallucination layers of the pipeline.

Covers, layer by layer:
  1. parse_rag_payload        — RAG payload always yields the CLEAN user prompt.
  2. sanitize_llm_output      — meta text / protocol echo / lists never reach
                                the video model.
  3. grounding firewall       — LLM rewrites that drop the user's subject are
                                rejected (the hallucination killer).
  4. deterministic enhance    — RAG keywords apply even with NO LLM at all.
  5. rewrite_prompt_with_ollama — end-to-end paths A/B/C with a fake Ollama.

Run:  python -m pytest test_guardrails.py -v
(no GPU, no Ollama, no network required)
"""

from __future__ import annotations

import json
import re
import urllib.request

import pytest

import task_manager as tm


# ---------------------------------------------------------------- helpers
def make_payload(user_prompt: str, rules: str) -> str:
    """Build a canonical ---RAG_START--- payload like the web app does."""
    return (
        "---RAG_START---\n"
        "USER_PROMPT:\n"
        f"{user_prompt}\n"
        "\n"
        "RAG_RULES:\n"
        f"{rules}\n"
        "\n"
        "RAG_INSTRUCTION:\n"
        "Apply the style rules above to the user prompt.\n"
        "---RAG_END---"
    )


LIGHTING_RULES = (
    "[Cinematic Lighting Guide]\n"
    "- **Golden Hour**: 'golden hour light'.\n"
    "- **Volumetric Lighting**: Use 'god rays' or 'volumetric lighting'.\n"
    "- **Rim Lighting**: A bright outline around the subject.\n"
    "Use these to ensure professional-grade cinematography."
)

CAMERA_RULES = (
    "[Camera Movements & Angles]\n"
    "- **Tracking Shot**: 'Camera tracks alongside the running subject.'\n"
    "- **Drone Shot / Aerial View**: 'Aerial drone footage sweeping over the forest.'\n"
    "- **Slow Motion**: 'Slow motion, 120fps, highly detailed'.\n"
    "- **Rack Focus**: Focus shifts from foreground to background."
)

QUALITY_RULES = (
    "[Quality Enhancers]\n"
    "- **Resolution & Detail**: 'highly detailed, 8k resolution, masterpiece, crisp focus'.\n"
    "- **Stability**: 'stable camera, tripod shot, smooth stable motion'."
)


class FakeOllamaResponse:
    """Duck-typed stand-in for urllib's HTTP response."""

    def __init__(self, llm_output: str):
        self._data = json.dumps({"response": llm_output}).encode("utf-8")

    def read(self) -> bytes:
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


@pytest.fixture
def ollama_up(monkeypatch):
    """Make Ollama appear reachable; returns a setter for the LLM output."""
    monkeypatch.setattr(tm, "_ollama_reachable", lambda: True)
    holder = {"output": ""}

    def set_output(text: str) -> None:
        holder["output"] = text

    def fake_urlopen(req, timeout=None):
        return FakeOllamaResponse(holder["output"])

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    return set_output


@pytest.fixture
def ollama_down(monkeypatch):
    monkeypatch.setattr(tm, "_ollama_reachable", lambda: False)


# ============================================================ 1. RAG parsing
class TestParseRagPayload:
    def test_canonical_payload(self):
        payload = make_payload("A cat running in the garden", LIGHTING_RULES)
        user, rules = tm.parse_rag_payload(payload)
        assert user == "A cat running in the garden"
        assert "Golden Hour" in rules
        assert "---RAG_START---" not in user and "---RAG_END---" not in user

    def test_plain_prompt_untouched(self):
        assert tm.parse_rag_payload("just a normal prompt") == ("just a normal prompt", "")

    def test_mangled_payload_still_yields_clean_prompt(self):
        # No USER_PROMPT: header → Strategy 2 line-filter must still keep
        # the user's text and drop every protocol marker.
        raw = (
            "---RAG_START---\nA dog surfing a wave\n"
            "RAG_RULES:\n[Some Doc] keep waves cinematic\n"
            "RAG_INSTRUCTION:\napply rules"
        )
        user, _rules = tm.parse_rag_payload(raw)
        assert "A dog surfing a wave" in user
        for marker in ("---RAG", "USER_PROMPT:", "RAG_RULES:", "RAG_INSTRUCTION:"):
            assert marker not in user

    def test_protocol_lines_never_leak_into_prompt(self):
        raw = "---RAG_START---\nUSER_PROMPT:\nRAG_RULES:\nsome rules\n---RAG_END---"
        user, _ = tm.parse_rag_payload(raw)
        for marker in ("---RAG", "USER_PROMPT:", "RAG_RULES:"):
            assert marker not in user


# ========================================================= 2. Sanitization
class TestSanitizeLlmOutput:
    FALLBACK = "A cat running in the garden"

    def test_clean_rewrite_passes(self):
        out = "A cat running through a sunlit garden, golden hour rim light, tracked by a slow dolly camera."
        assert tm.sanitize_llm_output(out, self.FALLBACK) == out

    def test_preamble_stripped(self):
        out = "Here is the enhanced prompt: A cat running in a garden at golden hour."
        cleaned = tm.sanitize_llm_output(out, self.FALLBACK)
        assert cleaned.startswith("A cat")

    def test_protocol_echo_rejected(self):
        out = "---RAG_START--- USER_PROMPT: A cat ---RAG_END---"
        assert tm.sanitize_llm_output(out, self.FALLBACK) == self.FALLBACK

    def test_bullet_list_rejected(self):
        out = "Here is your prompt:\n- A cat\n- Golden hour\n- Running"
        assert tm.sanitize_llm_output(out, self.FALLBACK) == self.FALLBACK

    def test_too_short_rejected(self):
        assert tm.sanitize_llm_output("cat", self.FALLBACK) == self.FALLBACK

    def test_empty_rejected(self):
        assert tm.sanitize_llm_output("   ", self.FALLBACK) == self.FALLBACK

    def test_surrounding_quotes_stripped(self):
        out = '"A cat running in a garden, warm golden hour light."'
        cleaned = tm.sanitize_llm_output(out, self.FALLBACK)
        assert cleaned.startswith("A cat") and not cleaned.startswith('"')

    def test_conversational_opening_rejected(self):
        out = "Sure! I'd be happy to describe a beautiful garden scene for your video project."
        assert tm.sanitize_llm_output(out, self.FALLBACK) == self.FALLBACK

    def test_overlong_output_truncated_at_sentence(self):
        sentence = "A cat runs through the garden in warm light. "
        out = sentence * 40  # ~2400 chars
        cleaned = tm.sanitize_llm_output(out, self.FALLBACK)
        assert len(cleaned) <= 1500
        assert cleaned.endswith(".")


# ======================================================= 3. Grounding check
class TestGroundingFirewall:
    def test_faithful_rewrite_accepted(self):
        user = "A cat running in the garden at sunset"
        rewrite = (
            "A cat running through a garden at sunset, warm golden hour backlight, "
            "slow tracking camera, highly detailed, sharp focus."
        )
        ok, ratio = tm.verify_prompt_grounding(user, rewrite)
        assert ok and ratio >= 0.8

    def test_hallucinated_scene_rejected(self):
        user = "A cat running in the garden at sunset"
        hallucinated = (
            "A robot dancing on a neon spaceship bridge, cyberpunk lighting, "
            "wide angle shot, cinematic atmosphere."
        )
        ok, ratio = tm.verify_prompt_grounding(user, hallucinated)
        assert not ok and ratio < 0.34

    def test_short_prompt_high_standard(self):
        # Only 2 content words — losing one changes the scene.
        user = "dancing woman"
        drift = "an old man dancing alone in the rain"
        ok, _ = tm.verify_prompt_grounding(user, drift)
        assert not ok  # 'woman' gone → reject even though 'dancing' kept

    def test_short_prompt_kept_intact(self):
        user = "dancing woman"
        rewrite = "a joyful woman dancing in a bright kitchen, morning light"
        ok, _ = tm.verify_prompt_grounding(user, rewrite)
        assert ok

    def test_empty_content_words_pass(self):
        ok, ratio = tm.verify_prompt_grounding("video", "anything at all")
        assert ok and ratio == 1.0

    def test_ratio_bounds(self):
        assert tm.grounding_ratio("cat garden", "cat garden") == 1.0
        assert tm.grounding_ratio("cat garden", "dog beach") == 0.0


# ============================================== 4. Deterministic enhancement
class TestDeterministicEnhance:
    def test_style_and_quality_appended(self):
        out = tm.deterministic_enhance("A cat running in the garden", LIGHTING_RULES)
        assert out.startswith("A cat running in the garden.")
        assert "Style:" in out
        assert "golden hour light" in out or "god rays" in out or "volumetric lighting" in out
        for q in tm._QUALITY_TAIL:
            assert q in out

    def test_no_rules_unchanged(self):
        assert tm.deterministic_enhance("A cat", "") == "A cat"

    def test_quality_tail_not_duplicated(self):
        prompt = "A cat running, highly detailed, crisp focus, smooth stable motion"
        out = tm.deterministic_enhance(prompt, CAMERA_RULES)
        assert out.count("highly detailed") == 1

    def test_punctuation_normalized(self):
        out = tm.deterministic_enhance("A cat running", QUALITY_RULES)
        assert "A cat running." in out

    def test_full_sentence_quotes_not_extracted(self):
        # 'Camera tracks alongside the running subject.' is an example
        # SENTENCE — it must not be glued in as a style keyword.
        out = tm.deterministic_enhance("A dog surfing", CAMERA_RULES)
        assert "Camera tracks alongside" not in out

    def test_prompt_substring_phrases_skipped(self):
        # If the prompt already says "golden hour", the lighting doc phrase
        # 'golden hour' must not be repeated, but 'rim lighting' is new.
        phrases = tm.extract_style_phrases("Use 'golden hour' and 'rim lighting'.", "use golden hour")
        assert "golden hour" not in [p.lower() for p in phrases]
        assert "rim lighting" in [p.lower() for p in phrases]

    def test_bold_labels_extracted(self):
        phrases = tm.extract_style_phrases(CAMERA_RULES, "a forest")
        lowered = [p.lower() for p in phrases]
        assert "tracking shot" in lowered or "drone shot" in lowered or "slow motion" in lowered

    def test_limit_respected(self):
        assert len(tm.extract_style_phrases(CAMERA_RULES, "x", limit=2)) <= 2

    def test_budget_respected(self):
        long_prompt = "A very long cinematic scene description. " * 40  # ~1400 chars
        out = tm.deterministic_enhance(long_prompt[:900], QUALITY_RULES)
        assert len(out) <= 1100


# ================================================== 5. End-to-end rewrite
class TestRewritePaths:
    def test_plain_prompt_unchanged(self):
        assert tm.rewrite_prompt_with_ollama("A plain prompt") == "A plain prompt"

    def test_no_rules_returns_clean_user_prompt(self):
        raw = (
            "---RAG_START---\nUSER_PROMPT:\nA lone cyclist\n\n"
            "RAG_RULES:\n\nRAG_INSTRUCTION:\nnone\n---RAG_END---"
        )
        assert tm.rewrite_prompt_with_ollama(raw) == "A lone cyclist"

    def test_ollama_down_still_applies_rag(self, ollama_down):
        """The old bug: Ollama down → RAG silently skipped. Now: keywords applied."""
        raw = make_payload("A cat running in the garden", LIGHTING_RULES)
        out = tm.rewrite_prompt_with_ollama(raw)
        assert out.startswith("A cat running in the garden")
        assert "Style:" in out  # deterministic enhancement happened
        assert "---RAG" not in out

    def test_ollama_faithful_rewrite_accepted(self, ollama_up):
        ollama_up(
            "A cat running through a garden at sunset with warm golden hour "
            "rim light and a slow tracking camera, highly detailed."
        )
        raw = make_payload("A cat running in the garden at sunset", LIGHTING_RULES)
        out = tm.rewrite_prompt_with_ollama(raw)
        assert out.startswith("A cat")
        assert "---RAG" not in out and "Style:" not in out  # LLM path, not fallback

    def test_ollama_meta_output_falls_back_deterministic(self, ollama_up):
        ollama_up("Sure! Here is your enhanced prompt:\n- a cat\n- garden\n- lighting")
        raw = make_payload("A cat running in the garden", LIGHTING_RULES)
        out = tm.rewrite_prompt_with_ollama(raw)
        assert out.startswith("A cat running in the garden")
        assert "Style:" in out  # deterministic fallback applied

    def test_ollama_hallucination_blocked(self, ollama_up):
        """THE hallucination test: LLM invents a different scene → blocked."""
        ollama_up(
            "A chrome robot serving drinks in a neon-lit space station bar, "
            "cyberpunk volumetric lighting, cinematic wide shot."
        )
        raw = make_payload("A cat running in the garden at sunset", LIGHTING_RULES)
        out = tm.rewrite_prompt_with_ollama(raw)
        # Output must still be about the USER's scene:
        assert "cat" in out.lower()
        assert "garden" in out.lower()
        assert "robot" not in out.lower()
        assert "Style:" in out  # deterministic enhancement used instead

    def test_ollama_crash_falls_back_deterministic(self, ollama_up, monkeypatch):
        def exploding_urlopen(req, timeout=None):
            raise ConnectionError("ollama exploded")

        monkeypatch.setattr(urllib.request, "urlopen", exploding_urlopen)
        raw = make_payload("A cat running in the garden", LIGHTING_RULES)
        out = tm.rewrite_prompt_with_ollama(raw)
        assert out.startswith("A cat running in the garden")
        assert "Style:" in out

    def test_output_never_contains_protocol(self, ollama_up, ollama_down):
        for llm_out in (
            "---RAG_START--- A cat ---RAG_END---",
            "USER_PROMPT: A cat in a garden with beautiful light.",
        ):
            ollama_up(llm_out)
            raw = make_payload("A cat in a garden", LIGHTING_RULES)
            out = tm.rewrite_prompt_with_ollama(raw)
            for marker in ("---RAG_START---", "---RAG_END---", "USER_PROMPT:", "RAG_RULES:"):
                assert marker not in out

    def test_unparseable_garbage_never_reaches_model(self, ollama_down):
        """A payload with markers but nothing extractable must not leak the
        raw protocol garbage into the video model (disturbing-output bug)."""
        for garbage in (
            "---RAG_START--- garbage ### USER_PROMPT: broken \x00 ##",
            "---RAG_START--- ---RAG_END---",
            "---RAG_START---\x00\x01---RAG_END---",
        ):
            out = tm.rewrite_prompt_with_ollama(garbage)
            for marker in ("---RAG_START---", "---RAG_END---", "USER_PROMPT:", "RAG_RULES:", "\x00"):
                assert marker not in out
            assert len(out) >= 10  # always a usable prompt


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
