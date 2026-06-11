// Aladin TTB (Open API) book search.
// Used by api/book-search.ts (combined with NL Korea results) and by
// vite.config.ts dev middleware. Aladin provides bibliographic data AND
// cover URLs, which solves NL Korea's missing-cover problem.
//
// API: http://www.aladin.co.kr/ttb/api/ItemSearch.aspx
// Doc: https://blog.aladin.co.kr/openapi

import type { NlBookResult } from "./nl-search.js";
import { formatAuthor } from "./author-format.js";

const ALADIN_SEARCH_URL = "https://www.aladin.co.kr/ttb/api/ItemSearch.aspx";

interface AladinItem {
  title?: string;
  link?: string;
  author?: string;
  pubDate?: string;
  description?: string;
  isbn?: string;
  isbn13?: string;
  cover?: string;
  publisher?: string;
  categoryName?: string;
}

interface AladinResponse {
  totalResults?: number;
  startIndex?: number;
  itemsPerPage?: number;
  item?: AladinItem[];
}

export async function searchAladinBooks(
  query: string,
  ttbKey: string,
  maxResults = 12,
): Promise<{ total: number; results: NlBookResult[] }> {
  if (!query.trim()) return { total: 0, results: [] };
  if (!ttbKey) throw new Error("missing Aladin TTB key");

  const url = new URL(ALADIN_SEARCH_URL);
  url.searchParams.set("ttbkey", ttbKey);
  url.searchParams.set("Query", query);
  url.searchParams.set("QueryType", "Keyword");
  url.searchParams.set("MaxResults", String(maxResults));
  url.searchParams.set("start", "1");
  url.searchParams.set("SearchTarget", "Book");
  url.searchParams.set("output", "js");
  url.searchParams.set("Version", "20131101");
  url.searchParams.set("Cover", "Big");

  const res = await fetch(url.toString(), {
    headers: {
      // Some Korean APIs return HTML to Node's default UA — set a
      // browser-like UA so we get JSON consistently from edge runtimes.
      "User-Agent":
        "Mozilla/5.0 (tin book search; +https://github.com/ystmk1/tin)",
      Accept: "application/json, text/javascript;q=0.9, */*;q=0.5",
    },
  });
  if (!res.ok) throw new Error(`Aladin API HTTP ${res.status}`);

  const text = (await res.text()).trim();

  // If we got an HTML doc (rate-limit, IP block, login wall, error page),
  // surface a clear error so the upstream catch can log it cleanly.
  if (text.startsWith("<")) {
    throw new Error(
      `Aladin returned HTML (status ${res.status}); first 120: ${text.slice(0, 120)}`,
    );
  }

  let data: AladinResponse;
  try {
    data = JSON.parse(text);
  } catch {
    // Aladin occasionally embeds raw control characters inside description
    // fields, which breaks JSON.parse. Strip them and try once more.
    const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, " ");
    try {
      data = JSON.parse(cleaned);
    } catch {
      throw new Error(`Aladin returned non-JSON; first 120: ${text.slice(0, 120)}`);
    }
  }

  const items = data.item ?? [];
  const results: NlBookResult[] = items.map((it) => {
    const isbn = pickIsbn(it.isbn13, it.isbn);
    return {
      source: "aladin",
      controlNo: isbn ?? it.link ?? "",
      title: stripHtml(it.title) ?? "",
      author: formatAuthor(stripHtml(it.author)),
      publisher: stripHtml(it.publisher),
      pubYear: extractYear(it.pubDate),
      isbn,
      detailLink: it.link,
      coverUrl: it.cover && it.cover.startsWith("http") ? it.cover : undefined,
    };
  });
  return { total: data.totalResults ?? results.length, results };
}

function pickIsbn(...candidates: Array<string | undefined>): string | undefined {
  for (const c of candidates) {
    if (!c) continue;
    const digits = String(c).replace(/[^0-9Xx]/g, "");
    if (digits.length === 13 || digits.length === 10) return digits;
  }
  return undefined;
}

function stripHtml(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return t || undefined;
}

function extractYear(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/(\d{4})/);
  return m ? m[1] : undefined;
}
