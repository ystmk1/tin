// Google Cloud Vision OCR — environment-agnostic helpers shared by the
// serverless proxy (api/ocr.ts), the Vite dev middleware, and the browser
// client (direct calls when no server key is configured). Uses the global
// `fetch`, available both on Vercel's Node 18+ runtime and in the browser.

const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

export type VisionMode = "DOCUMENT_TEXT_DETECTION" | "TEXT_DETECTION";

export interface VisionRequest {
  image: { content: string };
  features: { type: VisionMode }[];
  imageContext?: { languageHints: string[] };
}

/** Build one annotate request from a base64 image (no data: prefix). */
export function buildVisionRequest(
  base64: string,
  mode: VisionMode,
  langHints: string[],
): VisionRequest {
  return {
    image: { content: base64 },
    features: [{ type: mode }],
    imageContext: { languageHints: langHints },
  };
}

/** Pull the full document text out of a single annotate response. */
export function extractFullText(resp: unknown): string {
  const r = resp as { fullTextAnnotation?: { text?: string } } | null;
  return (r && r.fullTextAnnotation && r.fullTextAnnotation.text) || "";
}

/**
 * POST a batch of requests to images:annotate and return the `responses`
 * array. Vision allows up to 16 images per call — batching is the caller's
 * responsibility.
 */
export async function callVisionAnnotate(
  apiKey: string,
  requests: VisionRequest[],
  fetchImpl: typeof fetch = fetch,
): Promise<unknown[]> {
  const res = await fetchImpl(`${VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) {
    let detail = String(res.status);
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`Vision API 오류: ${detail}`);
  }
  const data = (await res.json()) as { responses?: unknown[] };
  return data.responses || [];
}
