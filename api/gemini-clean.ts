import type { VercelRequest, VercelResponse } from "@vercel/node";

// Gemini post-processing proxy. Keeps GEMINI_API_KEY server-side and the
// proofreader prompt on the server.
//   GET  → { configured: boolean }
//   POST { text, customPrompt?, model? } → { text }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL; // optional override

  if (req.method === "GET") {
    res.status(200).json({ configured: !!key });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  if (!key) {
    res.status(501).json({ error: "GEMINI_API_KEY not configured", configured: false });
    return;
  }

  try {
    const text = String(req.body?.text ?? "");
    const customPrompt = String(req.body?.customPrompt ?? "");
    const reqModel = String(req.body?.model ?? "").trim();
    const mod = await import("../lib/gemini-clean.js");
    const refined = await mod.callGeminiClean({
      apiKey: key,
      text,
      customPrompt,
      model: reqModel || model || mod.DEFAULT_MODEL,
    });
    res.status(200).json({ text: refined });
  } catch (e) {
    console.error("[api/gemini-clean] failed:", e);
    const err = e instanceof Error ? e : new Error(String(e));
    const code = (e as { code?: number }).code === 429 ? 429 : 500;
    res.status(code).json({ error: err.message });
  }
}
