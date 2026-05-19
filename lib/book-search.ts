// Combined search across NL Korea + Aladin. The two are called in parallel,
// junk NL items (e.g. "알 수 없음" titles) are dropped, and entries sharing
// an ISBN are deduped — when both APIs return the same book, we keep Aladin
// (which carries the cover) and graft NL's call number / detail link onto it.

import { isJunkResult, NlBookResult, searchNlBooks } from "./nl-search";
import { searchAladinBooks } from "./aladin-search";

export async function searchBooksCombined(
  query: string,
  keys: { nlKey?: string; aladinKey?: string },
): Promise<{ total: number; results: NlBookResult[]; warnings: string[] }> {
  const q = query.trim();
  const warnings: string[] = [];
  if (!q) return { total: 0, results: [], warnings };

  const nlPromise = keys.nlKey
    ? searchNlBooks(q, keys.nlKey).catch((e: unknown) => {
        warnings.push(`NL: ${errMsg(e)}`);
        return { total: 0, results: [] };
      })
    : Promise.resolve({ total: 0, results: [] });

  const aladinPromise = keys.aladinKey
    ? searchAladinBooks(q, keys.aladinKey).catch((e: unknown) => {
        warnings.push(`Aladin: ${errMsg(e)}`);
        return { total: 0, results: [] };
      })
    : Promise.resolve({ total: 0, results: [] });

  const [nl, aladin] = await Promise.all([nlPromise, aladinPromise]);

  // Aladin first (covers); dedupe NL extras by ISBN; drop junk NL.
  const byIsbn = new Map<string, NlBookResult>();
  const ordered: NlBookResult[] = [];

  for (const r of aladin.results) {
    if (r.isbn) byIsbn.set(r.isbn, r);
    ordered.push(r);
  }
  for (const r of nl.results) {
    if (isJunkResult(r)) continue;
    if (r.isbn && byIsbn.has(r.isbn)) {
      // Merge NL extras (call no / detail link) onto the existing Aladin entry.
      const existing = byIsbn.get(r.isbn)!;
      if (!existing.callNo && r.callNo) existing.callNo = r.callNo;
      if (!existing.detailLink && r.detailLink) existing.detailLink = r.detailLink;
      if (!existing.typeName && r.typeName) existing.typeName = r.typeName;
      continue;
    }
    if (r.isbn) byIsbn.set(r.isbn, r);
    ordered.push(r);
  }

  return {
    total: (aladin.total ?? 0) + (nl.total ?? 0),
    results: ordered,
    warnings,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
