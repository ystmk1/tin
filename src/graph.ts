import { BookNote, GraphLink, GraphNode } from "./types";
import { tagLeafOf } from "./parser-core";

// Build the relationship graph. Two books connect when they share an author
// OR share a tag-leaf — the same dimensions the filter popover exposes,
// just combined. The basis-toggle UI is gone (the graph reflects the unified
// search + filter state instead).
export function buildGraph(books: BookNote[]): { nodes: GraphNode[]; links: GraphLink[] } {
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

  for (const b of books) {
    for (const k of keysFor(b)) {
      if (!k) continue;
      const list = groups.get(k) ?? [];
      list.push(b.filePath);
      groups.set(k, list);
    }
  }

  // Dedupe edges — author+tag overlap would otherwise emit the same pair twice.
  const seen = new Set<string>();
  for (const [key, ids] of groups) {
    if (ids.length < 2) continue;
    const cap = Math.min(ids.length, 12);
    const basis: GraphLink["basis"] = key.startsWith("author:") ? "author" : "tag-leaf";
    for (let i = 0; i < cap; i++) {
      for (let j = i + 1; j < cap; j++) {
        const a = ids[i];
        const b = ids[j];
        const sig = a < b ? `${a}|${b}` : `${b}|${a}`;
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

function keysFor(b: BookNote): string[] {
  const keys: string[] = [];
  if (b.frontmatter.author) keys.push(`author:${b.frontmatter.author}`);
  const leaves = new Set<string>();
  for (const t of b.frontmatter.tags) leaves.add(tagLeafOf(t));
  for (const leaf of leaves) keys.push(`tag:${leaf}`);
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
