/**
 * seed_rag.mjs — Sync the professional RAG knowledge base into the app.
 *
 * The `rag-data/` folder is the single source of truth for the video
 * production knowledge base. This script reads EVERY .md file in it and
 * syncs the documents into the app's RAG database via the admin API:
 *
 *   - New documents        → POST   /api/admin/rag
 *   - Changed documents    → PUT    /api/admin/rag/[id]   (matched by title)
 *   - Identical documents  → skipped
 *   - Stale docs (in DB but not in rag-data/) → deleted only with --prune
 *
 * Re-running is always safe (idempotent, no duplicates).
 *
 * File format (front-matter):
 *   ---
 *   title: Shot Types & Composition
 *   tags: shot, composition, framing
 *   ---
 *   ...markdown content...
 *
 * Usage:
 *   node seed_rag.mjs             # sync against http://localhost:3000
 *   node seed_rag.mjs --dry-run   # show what would change, change nothing
 *   node seed_rag.mjs --prune     # also delete DB docs missing from rag-data/
 *   BASE_URL=http://myhost:3000 ADMIN_KEY=secret node seed_rag.mjs
 */

import fs from "node:fs";
import path from "node:path";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const ADMIN_KEY = process.env.ADMIN_KEY || "wan2-admin-secret";
const RAG_DIR = path.join(process.cwd(), "rag-data");
const DRY_RUN = process.argv.includes("--dry-run");
const PRUNE = process.argv.includes("--prune");

/** Parse one .md file into { title, tags, content }. */
function parseDoc(file) {
  const raw = fs.readFileSync(file, "utf-8");
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) {
    // Fallback: derive title from the first markdown heading.
    const content = raw.trim();
    const title = (content.match(/^#\s+(.+)$/m) || [])[1]?.trim() || path.basename(file, ".md");
    return { title, tags: "", content };
  }
  const meta = m[1];
  const content = m[2].trim();
  const title = (meta.match(/^title:\s*(.+)$/m) || [])[1]?.trim() || path.basename(file, ".md");
  const tags = ((meta.match(/^tags:\s*(.+)$/m) || [])[1] || "").trim();
  if (!title || !content) throw new Error(`Invalid document: ${file}`);
  return { title, tags, content };
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "x-admin-key": ADMIN_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const files = fs.readdirSync(RAG_DIR).filter((f) => f.endsWith(".md")).sort();
  if (files.length === 0) {
    console.error(`No .md files found in ${RAG_DIR}`);
    process.exit(1);
  }

  const corpus = files.map((f) => parseDoc(path.join(RAG_DIR, f)));
  console.log(`Loaded ${corpus.length} knowledge documents from rag-data/`);
  corpus.forEach((d) => console.log(`  - ${d.title} (${d.content.length} chars)`));

  // Fetch current DB state (fail fast with a clear message if app is down).
  let existing;
  try {
    existing = await api("GET", `${BASE_URL}/api/admin/rag`);
  } catch (e) {
    console.error(`\nCannot reach the app at ${BASE_URL}: ${e.message}`);
    console.error("Start the app first (npm run dev) or set BASE_URL.");
    process.exit(1);
  }
  const byTitle = new Map(existing.docs.map((d) => [d.title, d]));
  console.log(`\nServer has ${existing.docs.length} documents.`);

  let created = 0, updated = 0, skipped = 0, deleted = 0;

  for (const doc of corpus) {
    const cur = byTitle.get(doc.title);
    if (!cur) {
      console.log(`CREATE: ${doc.title}`);
      if (!DRY_RUN) await api("POST", `${BASE_URL}/api/admin/rag`, doc);
      created++;
    } else if (cur.content !== doc.content || (cur.tags || "") !== doc.tags) {
      console.log(`UPDATE: ${doc.title}`);
      if (!DRY_RUN) await api("PUT", `${BASE_URL}/api/admin/rag/${cur.id}`, doc);
      updated++;
    } else {
      skipped++;
    }
  }

  if (PRUNE) {
    const corpusTitles = new Set(corpus.map((d) => d.title));
    for (const d of existing.docs) {
      if (!corpusTitles.has(d.title)) {
        console.log(`DELETE (prune): ${d.title}`);
        if (!DRY_RUN) await api("DELETE", `${BASE_URL}/api/admin/rag/${d.id}`);
        deleted++;
      }
    }
  }

  console.log(
    `\n${DRY_RUN ? "[DRY RUN] " : ""}Done: ${created} created, ${updated} updated, ${skipped} unchanged${PRUNE ? `, ${deleted} pruned` : ""}.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
