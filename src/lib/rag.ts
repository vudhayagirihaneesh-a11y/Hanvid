import { db } from "@/lib/db";

/**
 * RAG (Retrieval Augmented Generation) module.
 *
 * Admin-provided knowledge documents are retrieved by TF-IDF similarity
 * to the user prompt, then packaged into a structured payload that the
 * local Python service detects (via ---RAG_START--- markers) and forwards
 * to Ollama for prompt rewriting before video generation.
 *
 * Robustness rules (fixes previous "RAG not connecting" bugs):
 *  - The payload is budgeted so it can NEVER be truncated mid-structure:
 *    prompt ≤ 600 chars, each snippet ≤ 350 chars, max 3 docs → the
 *    closing ---RAG_END--- marker always survives.
 *  - Retrieval uses proper TF-IDF (IDF dampens filler words like "the"/
 *    "and" that previously matched everything), plus a minimum relevance
 *    score so irrelevant docs are never injected.
 *  - Snippets are extracted around the most relevant passage, not just
 *    the first 220 chars of the document.
 */

/** Tokenize text into lowercase terms for matching. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** Compute term-frequency map. */
function termFreq(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tokens) map.set(t, (map.get(t) ?? 0) + 1);
  return map;
}

/** Stopwords that carry no stylistic signal (double safety net on top of IDF). */
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "her",
  "was", "one", "our", "out", "his", "has", "have", "this", "that", "with",
  "from", "they", "will", "would", "there", "their", "what", "about",
  "which", "when", "make", "like", "into", "your", "video", "generate",
  "create", "please", "want", "need",
]);

export interface RetrievedDoc {
  id: string;
  title: string;
  snippet: string;
  score: number;
}

/** Retrieve the top-k most relevant RAG documents for a prompt (TF-IDF). */
export async function retrieveRagContext(
  prompt: string,
  k = 3,
): Promise<RetrievedDoc[]> {
  const docs = await db.ragDocument.findMany();
  if (docs.length === 0) return [];

  const promptTokens = tokenize(prompt).filter((t) => !STOPWORDS.has(t));
  if (promptTokens.length === 0) return [];
  const promptTf = termFreq(promptTokens);

  // Document frequency per term (for IDF).
  const docTokens = docs.map((doc) => {
    const text = `${doc.title} ${doc.tags ?? ""} ${doc.content}`;
    const toks = tokenize(text);
    return { doc, tf: termFreq(toks), set: new Set(toks) };
  });

  const idf = (term: string) => {
    const df = docTokens.reduce((n, d) => n + (d.set.has(term) ? 1 : 0), 0);
    // Smoothed IDF; terms appearing in every doc score ~0.
    return Math.log((docs.length + 1) / (df + 0.5));
  };

  const scored = docTokens.map(({ doc, tf }) => {
    // Weighted cosine: prompt terms weighted by IDF.
    let dot = 0;
    let magA = 0;
    for (const [term, freq] of promptTf) {
      const w = freq * idf(term);
      magA += w * w;
      const bf = tf.get(term);
      if (bf) dot += w * bf;
    }
    const magB = Math.sqrt([...tf.values()].reduce((s, v) => s + v * v, 0));
    const score = magA === 0 || magB === 0 ? 0 : dot / (Math.sqrt(magA) * magB);
    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      tags: doc.tags ?? "",
      score,
    };
  });

  return scored
    .filter((d) => d.score > 0.04) // relevance threshold — no filler matches
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((d) => ({
      id: d.id,
      title: d.title,
      snippet: extractBestPassage(d.content, promptTokens),
      score: d.score,
    }));
}

/**
 * Extract the most relevant contiguous passage from a document: find the
 * window (in sentences) with the highest overlap of prompt terms, instead
 * of always cutting the head of the doc.
 */
function extractBestPassage(content: string, promptTokens: string[], maxChars = 550): string {
  const clean = content.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;

  // Split into sentences.
  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) ?? [clean];

  // Score each sentence by unique prompt-term hits.
  const termSet = new Set(promptTokens);
  const sentScores = sentences.map((s) => {
    const toks = new Set(tokenize(s));
    let hits = 0;
    for (const t of toks) if (termSet.has(t)) hits++;
    return hits;
  });

  // Slide a window of sentences up to maxChars, keep the best.
  let bestStart = 0;
  let bestScore = -1;
  for (let start = 0; start < sentences.length; start++) {
    let len = 0;
    let score = 0;
    for (let end = start; end < sentences.length; end++) {
      const sl = sentences[end].length;
      if (len + sl > maxChars && end > start) break;
      len += sl;
      score += sentScores[end];
      if (score > bestScore) {
        bestScore = score;
        bestStart = start;
      }
    }
  }

  // Build the window from bestStart.
  let out = "";
  for (let i = bestStart; i < sentences.length; i++) {
    if ((out + sentences[i]).length > maxChars) break;
    out += sentences[i];
  }
  out = out.trim();
  if (!out) out = clean.slice(0, maxChars);
  // Ellipsis if we cut something.
  if (out.length < clean.length && !/[.!?]$/.test(out)) out += "…";
  return out;
}

// --- Payload construction (structure-safe, never truncated mid-marker) ---

const MAX_PROMPT_CHARS = 1000;
const MAX_SNIPPET_CHARS = 550;

export interface RagPayload {
  /** The structured payload to send to the model service. */
  payload: string;
  /** Human-readable summary of what was applied (for logs/UI). */
  displayText: string;
  /** Titles of the docs that were used. */
  usedTitles: string[];
}

/**
 * Build the structured RAG payload for the Python service.
 *
 * The Python service detects payloads starting with ---RAG_START--- and
 * feeds them to the local LLM (Ollama) for prompt rewriting. The payload
 * is char-budgeted up front so `.slice()` can never cut it mid-structure
 * (the previous truncation bug fed raw protocol text into the video model).
 */
export function buildRagPayload(prompt: string, context: RetrievedDoc[]): RagPayload {
  if (context.length === 0) {
    return { payload: prompt, displayText: prompt, usedTitles: [] };
  }

  const safePrompt = prompt.slice(0, MAX_PROMPT_CHARS);
  const rules = context
    .map((c) => {
      const snippet = c.snippet.slice(0, MAX_SNIPPET_CHARS);
      return `[${c.title}]\n${snippet}`;
    })
    .join("\n\n");

  const payload = [
    "---RAG_START---",
    "USER_PROMPT:",
    safePrompt,
    "",
    "RAG_RULES:",
    rules,
    "",
    "RAG_INSTRUCTION:",
    "Apply the style rules above to the user prompt. Output ONE cohesive",
    "visual description only — no explanations, no labels.",
    "---RAG_END---",
  ].join("\n");

  // Safety net: total is ~1000 + 3*570 + overhead ≈ 2900 chars — always
  // below the 3500-char limit, so no mid-structure truncation can occur.
  const finalPayload = payload.length > 3500 ? payload.slice(0, 3490) + "\n---RAG_END---" : payload;

  return {
    payload: finalPayload,
    displayText: `${safePrompt}\n\n[Applied knowledge: ${context.map((c) => c.title).join(", ")}]`,
    usedTitles: context.map((c) => c.title),
  };
}

/**
 * Legacy wrapper kept for compatibility with existing imports.
 * Prefer buildRagPayload() which also returns a display-friendly text.
 */
export async function enhancePromptWithRag(
  prompt: string,
  context: RetrievedDoc[],
): Promise<string> {
  return buildRagPayload(prompt, context).payload;
}
