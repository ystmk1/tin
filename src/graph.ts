import { BookNote, GraphBasis, GraphLink, GraphNode } from "./types";
import { tagLeafOf } from "./parser-core";

// Build the relationship graph. Two books connect when they share an author
// and/or a tag-leaf, depending on `basis`:
//   "both" (default) — author OR tag-leaf
//   "author"         — shared author only
//   "tag"            — shared tag-leaf only
//   "off"            — no links (isolated stars)
export function buildGraph(
  books: BookNote[],
  basis: GraphBasis = "both",
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = books.map((b) => ({
    id: b.filePath,
    title: b.title,
    author: b.frontmatter.author,
    tagLeaf: pickLeafTag(b),
    degree: 0,
    filePath: b.filePath,
  }));

  const links: GraphLink[] = [];
  const groups = new Map<string, string[]>();

  // Dedupe edges — author+tag overlap would otherwise emit the same pair twice.
  const seen = new Set<string>();
  const sigOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  // 1) Explicit `[[Book]]` / `![[Book]]` references — one note pointing at
  //    another is the strongest relationship there is, so add these first
  //    (and mark them so author/tag won't re-emit the pair as a weaker link).
  if (basis !== "off") {
    const byTitle = new Map<string, string>();
    const paths = new Set<string>();
    for (const b of books) {
      byTitle.set(b.title, b.filePath);
      paths.add(b.filePath);
    }
    const resolve = (name: string): string | undefined =>
      byTitle.get(name) ?? (paths.has(name) ? name : paths.has(`${name}.md`) ? `${name}.md` : undefined);

    for (const b of books) {
      for (const name of linkTargets(b)) {
        const target = resolve(name);
        if (!target || target === b.filePath) continue;
        const sig = sigOf(b.filePath, target);
        if (seen.has(sig)) continue;
        seen.add(sig);
        links.push({ source: b.filePath, target, basis: "ref" });
      }
    }
  }

  if (basis !== "off") {
    for (const b of books) {
      for (const k of keysFor(b, basis)) {
        if (!k) continue;
        const list = groups.get(k) ?? [];
        list.push(b.filePath);
        groups.set(k, list);
      }
    }
  }

  for (const [key, ids] of groups) {
    if (ids.length < 2) continue;
    const cap = Math.min(ids.length, 12);
    const basis: GraphLink["basis"] = key.startsWith("author:") ? "author" : "tag-leaf";
    for (let i = 0; i < cap; i++) {
      for (let j = i + 1; j < cap; j++) {
        const a = ids[i];
        const b = ids[j];
        const sig = sigOf(a, b);
        if (seen.has(sig)) continue;
        seen.add(sig);
        links.push({ source: a, target: b, basis });
      }
    }
  }

  const degree = new Map<string, number>();
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  for (const n of nodes) n.degree = degree.get(n.id) ?? 0;
  return { nodes, links };
}

// Tags that are too broad to make a meaningful graph link — connecting on
// "소설" or "문학" links almost everything. We connect on the more specific
// level instead (한국문학 / 중국문학 / 프랑스문학 …). Edit this set to taste.
const GENERIC_TAGS = new Set([
  "문학", "소설", "시", "에세이", "산문", "수필", "희곡", "장편소설", "단편소설",
  "단편집", "소설집", "만화", "그래픽노블",
  // demo-note tags
  "안내", "사용법", "속성",
]);

// Note names referenced via `[[Name]]` or `![[Name]]` (alias/heading stripped).
const WIKILINK = /!?\[\[([^[\]]+)\]\]/g;
function linkTargets(b: BookNote): Set<string> {
  const text = [b.externalQuote ?? "", ...b.pages.map((p) => p.body)].join("\n");
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  WIKILINK.lastIndex = 0;
  while ((m = WIKILINK.exec(text)) !== null) {
    const name = m[1].split("|")[0].split("#")[0].trim();
    if (name) out.add(name);
  }
  return out;
}

function keysFor(b: BookNote, basis: GraphBasis): string[] {
  const keys: string[] = [];
  if (basis !== "tag" && b.frontmatter.author) keys.push(`author:${b.frontmatter.author}`);
  if (basis !== "author") {
    const leaves = new Set<string>();
    for (const t of b.frontmatter.tags) {
      const leaf = tagLeafOf(t);
      if (GENERIC_TAGS.has(leaf)) continue; // skip over-broad tags
      leaves.add(leaf);
    }
    for (const leaf of leaves) keys.push(`tag:${leaf}`);
  }
  return keys;
}

function pickLeafTag(b: BookNote): string | undefined {
  if (!b.frontmatter.tags.length) return undefined;
  let best = b.frontmatter.tags[0];
  let bestDepth = best.split("/").length;
  for (const t of b.frontmatter.tags) {
    const d = t.split("/").length;
    if (d > bestDepth) {
      best = t;
      bestDepth = d;
    }
  }
  return tagLeafOf(best);
}
