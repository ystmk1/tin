export interface NlBookResult {
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

export async function searchBooks(query: string, signal?: AbortSignal): Promise<NlSearchResponse> {
  const url = `/api/nl-search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  const body = await res.json().catch(() => ({ error: "invalid JSON from server" }));
  if (!res.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
  }
  return body as NlSearchResponse;
}
