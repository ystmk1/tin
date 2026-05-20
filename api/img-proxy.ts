import type { VercelRequest, VercelResponse } from "@vercel/node";

// Same-origin image proxy so the client can read cover pixels on a <canvas>
// (extract a spine tint color) without cross-origin tainting. Host-allowlisted
// to avoid being an open proxy.
const ALLOWED_HOST = /(^|\.)aladin\.co\.kr$|(^|\.)nl\.go\.kr$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = String(req.query.url ?? "");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).end("bad url");
    return;
  }
  if (!/^https?:$/.test(parsed.protocol) || !ALLOWED_HOST.test(parsed.host)) {
    res.status(403).end("host not allowed");
    return;
  }
  try {
    const r = await fetch(parsed.toString());
    if (!r.ok) {
      res.status(502).end("upstream error");
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") ?? "image/jpeg");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.status(200).end(buf);
  } catch (e) {
    res.status(502).end(e instanceof Error ? e.message : "fetch failed");
  }
}
