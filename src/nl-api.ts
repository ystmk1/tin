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
  warnings?: string[];
}

export async function searchBooks(query: string, signal?: AbortSignal): Promise<NlSearchResponse> {
  const url = `/api/nl-search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  let body: { error?: string; total?: number; results?: NlBookResult[]; warnings?: string[] } | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON response — usually means the serverless function didn't run
    // (Vercel fell through to index.html or a 404/500 page). Surface enough
    // detail so the operator can tell whether it's a missing function,
    // missing env var, or upstream API failure.
    const head = text.replace(/\s+/g, " ").slice(0, 240).trim();
    throw new Error(
      `서버가 JSON이 아닌 응답을 반환 (HTTP ${res.status}, content-type ${contentType || "없음"}). ` +
        `Vercel 함수가 배포되지 않았거나 env 변수가 누락되었을 수 있음. ` +
        `응답 첫 부분: ${head || "(빈 응답)"}`,
    );
  }
  if (!res.ok) {
    const errMsg = typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(errMsg);
  }
  return body as NlSearchResponse;
}
