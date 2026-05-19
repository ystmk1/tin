import type { VercelRequest, VercelResponse } from "@vercel/node";

// Endpoint kept as /api/nl-search for backwards-compat with the existing
// client. Internally runs NL Korea + Aladin in parallel and returns a
// merged, deduped, junk-filtered list.
//
// The body is wrapped in a single try/catch and uses a dynamic import for
// the shared library so even module-load failures surface as a JSON
// payload to the client — otherwise Vercel returns a generic
// FUNCTION_INVOCATION_FAILED text page and the operator has nothing to
// work with.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) {
      res.status(400).json({ error: "missing q" });
      return;
    }
    const nlKey = process.env.NL_API_KEY;
    const aladinKey = process.env.ALADIN_TTB_KEY;
    if (!nlKey && !aladinKey) {
      res.status(500).json({
        error: "No NL_API_KEY or ALADIN_TTB_KEY configured on this deployment",
      });
      return;
    }

    // Dynamic import keeps any module-load error inside the try/catch.
    const mod = await import("../lib/book-search");
    const payload = await mod.searchBooksCombined(q, { nlKey, aladinKey });

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json(payload);
  } catch (e) {
    // Log to Vercel function logs AND return JSON so the client diagnostic
    // surfaces something concrete.
    console.error("[api/nl-search] failed:", e);
    const err = e instanceof Error ? e : new Error(String(e));
    res.status(500).json({
      error: `function crashed: ${err.message}`,
      stack: err.stack?.split("\n").slice(0, 4).join(" | "),
    });
  }
}
