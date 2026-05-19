// Shared National Library of Korea search handler.
// Used by:
//   - api/nl-search.ts          (Vercel serverless, production)
//   - vite.config.ts middleware (local dev)
// API doc: https://www.nl.go.kr/NL/contents/N31101000000.do (openAPI 자료검색)

import { formatAuthor } from "./author-format";

const NL_API_URL = "https://www.nl.go.kr/NL/search/openApi/search.do";

export type BookSource = "nl" | "aladin";

export interface NlBookResult {
  source: BookSource;
  controlNo: string;
  title: string;
  author?: string;
  publisher?: string;
  pubYear?: string;
  isbn?: string;
  typeName?: string;
  callNo?: string;
  detailLink?: string;
  coverUrl?: string;
}

export interface NlSearchResponse {
  total: number;
  results: NlBookResult[];
}

const UNKNOWN_RE = /^\s*(?:알\s*수\s*없음|unknown|미상|n\/a|-)\s*$/i;

export function isJunkResult(r: NlBookResult): boolean {
  if (!r.title || UNKNOWN_RE.test(r.title)) return true;
  // tighten: no cover AND no author AND no isbn → drop
  if (!r.coverUrl && !r.author && !r.isbn) return true;
  return false;
}

export async function searchNlBooks(query: string, key: string): Promise<NlSearchResponse> {
  if (!query.trim()) return { total: 0, results: [] };
  if (!key) throw new Error("missing API key");

  const url = new URL(NL_API_URL);
  url.searchParams.set("key", key);
  url.searchParams.set("kwd", query);
  url.searchParams.set("apiType", "json");
  url.searchParams.set("srchTarget", "total");
  url.searchParams.set("category", "도서");
  url.searchParams.set("pageNum", "1");
  url.searchParams.set("pageSize", "12");
  url.searchParams.set("sort", "ititle");
  url.searchParams.set("order", "asc");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`NL API ${res.status}`);

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`NL API non-JSON response (first 120 chars: ${text.slice(0, 120)})`);
  }

  const items = extractItems(data);
  const results = items.map(normalizeItem);
  const total = Number(getField(data, "total") ?? results.length);
  return { total, results };
}

function extractItems(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  // Known shapes used by NL Korea over the years:
  //   { result: [...] }
  //   { item: [...] }
  //   { channel: { item: [...] } }
  //   { docs: [...] }
  const candidates: unknown[] = [
    d.result,
    d.item,
    (d.channel as Record<string, unknown> | undefined)?.item,
    d.docs,
    d.items,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as Record<string, unknown>[];
    if (c && typeof c === "object") return [c as Record<string, unknown>];
  }
  return [];
}

function getField(data: unknown, ...keys: string[]): unknown {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  for (const k of keys) if (d[k] !== undefined) return d[k];
  return undefined;
}

function normalizeItem(item: Record<string, unknown>): NlBookResult {
  const title = clean(String(item.title_info ?? item.title ?? ""));
  const author = formatAuthor(optional(item.author_info ?? item.author));
  const publisher = optional(item.pub_info ?? item.publisher);
  const pubYear = extractYear(item.pub_year_info ?? item.pub_year);
  const isbn = pickIsbn(item.isbn);
  const controlNo = String(item.control_no ?? item.id ?? "");
  const detailLink = optional(item.detail_link);
  return {
    source: "nl",
    controlNo,
    title: title || "",
    author,
    publisher,
    pubYear,
    isbn,
    typeName: optional(item.type_name),
    callNo: optional(item.call_no),
    detailLink: detailLink ? absolutize(detailLink) : undefined,
    // NL Korea doesn't return cover URLs and Open Library has poor Korean coverage;
    // we now rely on Aladin for covers. Leave undefined here so the merger can
    // borrow Aladin's cover via ISBN dedup, or render the letter-placeholder.
    coverUrl: undefined,
  };
}

function clean(s: string): string {
  // strip HTML highlight wrappers the API sometimes embeds
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function optional(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = clean(String(v));
  return s ? s : undefined;
}

function extractYear(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const m = String(v).match(/(\d{4})/);
  return m ? m[1] : undefined;
}

function pickIsbn(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  // ISBN field can be "9788932473901 (양장)" or "9788932473901;9788932473918"
  const candidates = String(v).split(/[;,\s]+/);
  for (const c of candidates) {
    const digits = c.replace(/[^0-9Xx]/g, "");
    if (digits.length === 13 || digits.length === 10) return digits;
  }
  return undefined;
}

function absolutize(link: string): string {
  if (/^https?:\/\//i.test(link)) return link;
  if (link.startsWith("/")) return `https://www.nl.go.kr${link}`;
  return `https://www.nl.go.kr/${link}`;
}
