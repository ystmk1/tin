import { BookNote, BookFrontmatter, PageExcerpt, BoldFragment, ReadingStatus } from "./types";

// Page marker: "##### 24" or "##### 24p" or "##### 24p." or "##### 24쪽" etc.
const PAGE_HEADER = /^#####\s+(\d+)\s*(?:p\.?|쪽|page)?\s*$/i;
// Bold span. Content allows newlines (multi-line bold) and inner single `*`
// (a nested *italic* inside the bold) — only a `**` ends it. Standalone
// `*…*` italics are not matched on their own (italics aren't excerpts).
const BOLD_PATTERN = /\*\*((?:[^*]|\*(?!\*))+?)\*\*/g;
const STAR_TAG = /^[★☆✦✧⭐]+$/;

export type YamlParser = (raw: string) => Record<string, unknown> | null | undefined;

export function parseBookContent(
  rawContent: string,
  filePath: string,
  title: string,
  parseYaml: YamlParser,
): BookNote {
  const { fm, body } = splitFrontmatter(rawContent, parseYaml);
  const frontmatter = normalizeFrontmatter(fm);
  const { externalQuote, preamble, pages } = parseBody(body);
  const allBolds: BoldFragment[] = [];
  for (const p of pages) {
    for (const b of p.boldFragments) {
      allBolds.push({
        text: b,
        page: p.page,
        bookTitle: title,
        author: frontmatter.author,
        filePath,
      });
    }
  }
  return {
    filePath,
    title,
    frontmatter,
    externalQuote,
    preamble,
    pages,
    allBolds,
    status: deriveStatus(frontmatter),
  };
}

function splitFrontmatter(
  raw: string,
  parseYaml: YamlParser,
): { fm: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) return { fm: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { fm: {}, body: raw };
  const yaml = raw.slice(3, end).replace(/^\s*\n/, "");
  const body = raw.slice(end + 4).replace(/^\s*\n/, "");
  let fm: Record<string, unknown> = {};
  try {
    fm = (parseYaml(yaml) || {}) as Record<string, unknown>;
  } catch (e) {
    console.warn("yaml parse error", e);
  }
  return { fm, body };
}

function normalizeFrontmatter(fm: Record<string, unknown>): BookFrontmatter {
  const get = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (fm[k] !== undefined && fm[k] !== null && fm[k] !== "") return fm[k];
    }
    return undefined;
  };
  const tagsRaw = get("tags", "tag", "태그");
  let rawTags: string[] = [];
  if (Array.isArray(tagsRaw)) {
    rawTags = tagsRaw.map((t) => String(t).trim()).filter(Boolean);
  } else if (typeof tagsRaw === "string") {
    rawTags = tagsRaw.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
  }
  // Strip leading # (Obsidian inline-tag style) on every value
  rawTags = rawTags.map((t) => t.replace(/^#+/, "").trim()).filter(Boolean);

  // Pull star ratings out of tags. e.g. ☆☆☆☆ → rating 4
  let rating: number | undefined;
  const tags: string[] = [];
  for (const t of rawTags) {
    if (STAR_TAG.test(t)) {
      const count = [...t].length; // unicode-aware codepoint count
      if (rating === undefined || count > rating) rating = count;
    } else {
      tags.push(t);
    }
  }
  if (rating !== undefined) rating = Math.max(0, Math.min(5, rating));

  const status = String(get("status", "현재 상태", "현재상태", "상태") ?? "").trim() || undefined;
  const stoppedAtPage = extractStoppedPage(status);
  return {
    author: strOrUndef(get("author", "저자")),
    status,
    rawStatus: status,
    stoppedAtPage,
    startDate: strOrUndef(get("start_date", "startDate", "start", "시작일", "읽기 시작한 날짜", "읽기시작한날짜")),
    endDate: strOrUndef(get("end_date", "endDate", "finish", "종료일", "다 읽은 날짜", "다읽은날짜", "완독일")),
    tags,
    rating,
    publisher: strOrUndef(get("publisher", "출판사")),
    comment: strOrUndef(get("comment", "코멘트", "내가 작성한 코멘트")),
  };
}

function strOrUndef(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  // js-yaml parses ISO timestamps (e.g. `2026-04-23`) as Date instances.
  // Coercing those via String() yields long locale strings like
  // "Thu Apr 23 2026 00:00:00 GMT+0900 (KST)" — collapse to YYYY-MM-DD.
  if (v instanceof Date && !isNaN(v.getTime())) return formatDate(v);
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function extractStoppedPage(status?: string): number | undefined {
  if (!status) return undefined;
  const m = status.match(/(\d+)\s*(?:페이지|p|pp|쪽|page)/i);
  return m ? parseInt(m[1], 10) : undefined;
}

function deriveStatus(fm: BookFrontmatter): ReadingStatus {
  const s = (fm.rawStatus ?? "").toLowerCase();
  if (!s) return fm.endDate ? "finished" : fm.startDate ? "reading" : "unknown";
  if (/완독|완료|finished|done/.test(s)) return "finished";
  if (/중단|stop|보류|paused/.test(s) || /\d+\s*(페이지|p|쪽).*중단/.test(s)) return "stopped";
  if (/읽는|reading|진행/.test(s)) return "reading";
  return "unknown";
}

interface ParsedBody {
  externalQuote?: string;
  /** Content after the 서평 quote but before the first page marker (a `###`
   *  heading and/or a few body lines). Kept verbatim; not a page. */
  preamble?: string;
  pages: PageExcerpt[];
}

function parseBody(body: string): ParsedBody {
  const lines = body.split(/\r?\n/);
  const externalQuoteLines: string[] = [];
  const preambleLines: string[] = [];
  const pages: PageExcerpt[] = [];

  let current: { page: number; buf: string[] } | null = null;
  // Before the first page marker: first the leading `>` quote ("quote"), then
  // any other lines ("preamble"). After a marker we're in "pages".
  let phase: "quote" | "preamble" = "quote";

  for (const line of lines) {
    const pm = line.match(PAGE_HEADER);
    if (pm) {
      if (current) pages.push(finalizePage(current.page, current.buf));
      current = { page: parseInt(pm[1], 10), buf: [] };
      continue;
    }
    if (current) {
      current.buf.push(line);
      continue;
    }
    if (phase === "quote") {
      if (/^\s*>/.test(line)) {
        externalQuoteLines.push(line.replace(/^\s*>\s?/, ""));
        continue;
      }
      if (line.trim() === "") {
        if (externalQuoteLines.length) externalQuoteLines.push(""); // trailing blank, trimmed later
        continue; // a blank line doesn't end the quote phase
      }
      phase = "preamble"; // first non-blank, non-quote line → preamble begins
    }
    preambleLines.push(line);
  }
  if (current) pages.push(finalizePage(current.page, current.buf));

  const externalQuote = trimBlankEdges(externalQuoteLines).join("\n") || undefined;
  const preamble = fixStrayBold(trimBlankEdges(preambleLines).join("\n")) || undefined;
  return { externalQuote, preamble, pages };
}

function finalizePage(page: number, lines: string[]): PageExcerpt {
  const body = fixStrayBold(trimBlankEdges(lines).join("\n"));
  return { page, body, boldFragments: extractBolds(body) };
}

/**
 * Repair a paragraph bolded on only ONE side by mistake — a single stray `**`
 * at the very start or very end of a (often multi-line) paragraph. We add the
 * missing marker so it becomes a normal **…** span, which then renders bold
 * and counts as one excerpt. Newlines (incl. blank-line skips) are preserved
 * exactly; the .md file on disk is never touched.
 */
function fixStrayBold(body: string): string {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i++;
      continue;
    }
    let j = i; // paragraph spans [i, j)
    while (j < lines.length && lines[j].trim() !== "") j++;
    const para = lines.slice(i, j);
    const count = (para.join("\n").match(/\*\*/g) ?? []).length;
    if (count === 1) {
      const startsBold = /^\s*\*\*/.test(para[0]);
      const endsBold = /\*\*\s*$/.test(para[para.length - 1]);
      if (startsBold && !endsBold) lines[j - 1] = lines[j - 1].replace(/\s*$/, "") + "**";
      else if (endsBold && !startsBold) lines[i] = lines[i].replace(/^(\s*)/, "$1**");
    }
    i = j;
  }
  return lines.join("\n");
}

// Whitespace with exactly one newline (= consecutive lines, no blank line).
const SINGLE_BREAK = /^[^\S\n]*\n[^\S\n]*$/;

/**
 * Excerpt candidates from a page's **bold** text. Line breaks are preserved so
 * multi-line passages read as one quote. Two shapes both merge into one:
 *   - one **…** span wrapping several lines, and
 *   - separate **…** lines stacked with NO blank line between them.
 * A blank line (or any non-whitespace text) between spans starts a new excerpt.
 * Short fragments (< 5 non-space chars) are skipped; italics aren't matched.
 * The body's own bold highlighting is rendered separately and unaffected.
 */
function extractBolds(body: string): string[] {
  const out: string[] = [];
  let parts: string[] = [];
  let prevEnd = -1;
  const flush = () => {
    if (parts.length) {
      const merged = parts.join("\n").trim();
      const chars = merged.replace(/\s/g, "").length;
      const words = merged.split(/\s+/).filter(Boolean).length;
      // Skip tiny emphases — need at least 6 chars and 2 words to be an excerpt.
      if (chars >= 6 && words >= 2) out.push(merged);
      parts = [];
    }
  };
  for (const m of body.matchAll(BOLD_PATTERN)) {
    const start = m.index ?? 0;
    const between = prevEnd >= 0 ? body.slice(prevEnd, start) : "";
    const content = m[1].replace(/\*/g, ""); // drop inner *italic* markers
    if (parts.length && SINGLE_BREAK.test(between)) {
      parts.push(content); // adjacent bold line → keep in the same excerpt
    } else {
      flush();
      parts.push(content);
    }
    prevEnd = start + m[0].length;
  }
  flush();
  return out;
}

function trimBlankEdges(lines: string[]): string[] {
  let s = 0;
  let e = lines.length;
  while (s < e && lines[s].trim() === "") s++;
  while (e > s && lines[e - 1].trim() === "") e--;
  return lines.slice(s, e);
}

export function tagLeafOf(tag: string): string {
  const parts = tag.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? tag;
}
