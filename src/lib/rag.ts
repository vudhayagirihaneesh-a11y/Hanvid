import { db } from "@/lib/db";

/**
 * RAG (Retrieval Augmented Generation) module.
 *
 * Admin-provided knowledge documents are retrieved by keyword/TF-IDF similarity
 * to the user prompt, then incorporated into the prompt before sending it to
 * the Wan2.1 video model.
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

/** Cosine similarity between two TF maps (simplified TF-IDF via document frequency). */
function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let dot = 0;
  for (const [term, freq] of a) {
    const bf = b.get(term);
    if (bf) dot += freq * bf;
  }
  const magA = Math.sqrt([...a.values()].reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt([...b.values()].reduce((s, v) => s + v * v, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

export interface RetrievedDoc {
  id: string;
  title: string;
  snippet: string;
  score: number;
}

/** Retrieve the top-k most relevant RAG documents for a prompt. */
export async function retrieveRagContext(
  prompt: string,
  k = 3,
): Promise<RetrievedDoc[]> {
  const docs = await db.ragDocument.findMany();
  if (docs.length === 0) return [];

  const promptTokens = tokenize(prompt);
  const promptTf = termFreq(promptTokens);

  const scored = docs.map((doc) => {
    const docText = `${doc.title} ${doc.tags} ${doc.content}`;
    const docTf = termFreq(tokenize(docText));
    const score = cosineSimilarity(promptTf, docTf);
    const snippet =
      doc.content.length > 220 ? doc.content.slice(0, 220) + "…" : doc.content;
    return { id: doc.id, title: doc.title, snippet, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((d) => d.score > 0);
}

/**
 * Enhance a user prompt using retrieved RAG context.
 * Appends relevant context snippets to the prompt directly.
 * (LLM-based rewriting removed — configure your own LLM if needed.)
 */
export async function enhancePromptWithRag(
  prompt: string,
  context: RetrievedDoc[],
): Promise<string> {
  if (context.length === 0) return prompt;

  const contextBlock = context
    .map((c) => c.snippet)
    .join(" ");

  // Simple concatenation: append the most relevant context to the prompt.
  return `${prompt}. Style reference: ${contextBlock}`.slice(0, 500);
}

