// Suggests/normalises page markers to DoKKi's canonical form: "##### 29p.".
//
// The parser accepts "##### 29", "##### 29p", "##### 29쪽" etc., but notes are
// often jotted with a bare number ("29"), a leading dot ("· 29"), or "p.29".
// This module rewrites all those onto one consistent "##### Np." line so the
// excerpt parser reliably picks pages up. Pure (no Obsidian deps) so it's easy
// to test and reuse.

export interface PageFix {
  line: number; // 0-based line index
  from: string;
  to: string;
}

// Patterns that mean "this whole line is a page number". Order matters: the
// heading form is tried first so an existing "##### 29" is recognised before
// the bare-number rule. Each captures the page number in group 1.
const PAGE_LINE_PATTERNS: RegExp[] = [
  /^#{1,6}\s+(\d{1,4})\s*(?:p\.?|pp\.?|쪽|페이지|page)?\s*$/i, // heading-style (any level)
  /^p\.?\s*(\d{1,4})\s*$/i, // p.29 / p 29
  /^(\d{1,4})\s*(?:p\.?|pp\.?|쪽|페이지|page)\s*$/i, // 29p / 29쪽 / 29 page
  /^[.\-·•*]?\s*(\d{1,4})\s*$/, // bare number, optional leading bullet/dot ("· 29")
];

const CANONICAL = (n: number) => `##### ${n}p.`;

/** Index range [start, end) of lines that belong to YAML frontmatter (skip). */
function frontmatterRange(lines: string[]): [number, number] {
  if (lines[0]?.trim() !== "---") return [0, 0];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return [0, i + 1];
  }
  return [0, 0]; // no closing fence — treat as none
}

function matchPage(line: string): number | null {
  for (const re of PAGE_LINE_PATTERNS) {
    const m = line.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n <= 9999) return n;
    }
  }
  return null;
}

/** List the lines that would change (already-canonical lines are skipped). */
export function findPageFixes(text: string): PageFix[] {
  const lines = text.split("\n");
  const [, fmEnd] = frontmatterRange(lines);
  const fixes: PageFix[] = [];
  for (let i = fmEnd; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    const n = matchPage(raw);
    if (n === null) continue;
    const to = CANONICAL(n);
    if (raw === to) continue; // already canonical
    fixes.push({ line: i, from: raw, to });
  }
  return fixes;
}

/** Apply every page-marker fix and return the new document text. */
export function applyPageFixes(text: string): string {
  const lines = text.split("\n");
  for (const fix of findPageFixes(text)) lines[fix.line] = fix.to;
  return lines.join("\n");
}
