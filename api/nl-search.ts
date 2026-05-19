import type { VercelRequest, VercelResponse } from "@vercel/node";
import { searchBooksCombined } from "../lib/book-search";

// Endpoint name kept as /api/nl-search for backwards compat with the
// existing client. Internally it now runs NL Korea + Aladin in parallel
// and returns a merged, deduped, junk-filtered list.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.status(400).json({ error: "missing q" });
    return;
  }
  const nlKey = process.env.NL_API_KEY;
  const aladinKey = process.env.ALADIN_TTB_KEY;
  if (!nlKey && !aladinKey) {
    res.status(500).json({ error: "No NL_API_KEY or ALADIN_TTB_KEY configured" });
    return;
  }
  try {
    const payload = await searchBooksCombined(q, { nlKey, aladinKey });
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: message });
  }
}
