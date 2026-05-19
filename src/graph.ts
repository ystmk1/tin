import { BookNote, GraphLink, GraphLinkBasis, GraphNode } from "./types";
import { tagLeafOf } from "./parser-core";

export function buildGraph(
  books: BookNote[],
  basis: GraphLinkBasis,
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

  for (const b of books) {
    const keys = keysFor(b, basis);
    for (const k of keys) {
      if (!k) continue;
      const list = groups.get(k) ?? [];
      list.push(b.filePath);
      groups.set(k, list);
    }
  }

  for (const [, ids] of groups) {
    if (ids.length < 2) continue;
    // star within group: connect every pair (but cap to avoid n^2 visual mess)
    const cap = Math.min(ids.length, 12);
    for (let i = 0; i < cap; i++) {
      for (let j = i + 1; j < cap; j++) {
        links.push({ source: ids[i], target: ids[j], basis });
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

function keysFor(b: BookNote, basis: GraphLinkBasis): string[] {
  if (basis === "author") return [b.frontmatter.author ?? ""].filter(Boolean) as string[];
  // tag-leaf: every leaf of every tag path
  const leaves = new Set<string>();
  for (const t of b.frontmatter.tags) leaves.add(tagLeafOf(t));
  return [...leaves];
}

function pickLeafTag(b: BookNote): string | undefined {
  if (!b.frontmatter.tags.length) return undefined;
  // pick the deepest path's leaf
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
