import type { VercelRequest, VercelResponse } from "@vercel/node";

// Vision OCR proxy. Keeps GOOGLE_VISION_API_KEY server-side.
//   GET  → { configured: boolean }  (client probes this to decide proxy vs BYO-key)
//   POST { requests } → { responses }  (thin pass-through to images:annotate)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.GOOGLE_VISION_API_KEY;

  if (req.method === "GET") {
    res.status(200).json({ configured: !!key });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  if (!key) {
    res.status(501).json({ error: "GOOGLE_VISION_API_KEY not configured", configured: false });
    return;
  }

  try {
    const requests = (req.body?.requests ?? []) as unknown[];
    if (!Array.isArray(requests) || requests.length === 0) {
      res.status(400).json({ error: "missing requests" });
      return;
    }
    const mod = await import("../lib/vision-ocr.js");
    const responses = await mod.callVisionAnnotate(key, requests as never);
    res.status(200).json({ responses });
  } catch (e) {
    console.error("[api/ocr] failed:", e);
    const err = e instanceof Error ? e : new Error(String(e));
    res.status(500).json({ error: err.message });
  }
}
