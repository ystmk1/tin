import { BookNote, BookFrontmatter, PageExcerpt, BoldFragment, ReadingStatus } from "./types";

// Page marker: "##### 24" or "##### 24p" or "##### 24p." or "##### 24쪽" etc.
const PAGE_HEADER = /^#####\s+(\d+)\s*(?:p\.?|쪽|page)?\s*$/i;
const BOLD_PATTERN = /\*\*([^*\n]+?)\*\*/g;
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
  const { externalQuote, pages } = parseBody(body);
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
  pages: PageExcerpt[];
}

function parseBody(body: string): ParsedBody {
  const lines = body.split(/\r?\n/);
  const externalQuoteLines: string[] = [];
  const pages: PageExcerpt[] = [];

  let current: { page: number; buf: string[] } | null = null;
  let inExternalQuote = true;

  for (const line of lines) {
    const pm = line.match(PAGE_HEADER);
    if (pm) {
      if (current) pages.push(finalizePage(current.page, current.buf));
      current = { page: parseInt(pm[1], 10), buf: [] };
      inExternalQuote = false;
      continue;
    }
    if (current) {
      current.buf.push(line);
    } else if (inExternalQuote) {
      if (/^\s*>/.test(line)) {
        externalQuoteLines.push(line.replace(/^\s*>\s?/, ""));
      } else if (externalQuoteLines.length && line.trim() === "") {
        externalQuoteLines.push("");
      } else if (externalQuoteLines.length === 0 && line.trim() === "") {
        // skip leading blanks
      } else if (externalQuoteLines.length > 0) {
        inExternalQuote = false;
      }
    }
  }
  if (current) pages.push(finalizePage(current.page, current.buf));

  const externalQuote = trimBlankEdges(externalQuoteLines).join("\n") || undefined;
  return { externalQuote, pages };
}

function finalizePage(page: number, lines: string[]): PageExcerpt {
  const body = trimBlankEdges(lines).join("\n");
  const bolds: string[] = [];
  const re = new RegExp(BOLD_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const t = m[1].trim();
    if (t) bolds.push(t);
  }
  return { page, body, boldFragments: bolds };
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
