import type { VercelRequest, VercelResponse } from "@vercel/node";
import { searchNlBooks } from "../lib/nl-search";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.status(400).json({ error: "missing q" });
    return;
  }
  const key = process.env.NL_API_KEY;
  if (!key) {
    res.status(500).json({ error: "NL_API_KEY not configured on this deployment" });
    return;
  }
  try {
    const payload = await searchNlBooks(q, key);
    // 1 day at the edge, 7 day SWR — same book search → same result, ok to cache hard.
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: message });
  }
}
