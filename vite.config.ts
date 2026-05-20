import { defineConfig, loadEnv, type Plugin } from "vite";
import { searchBooksCombined } from "./lib/book-search";

function bookSearchDevPlugin(nlKey: string | undefined, aladinKey: string | undefined): Plugin {
  return {
    name: "dokki-book-search-dev",
    configureServer(server) {
      server.middlewares.use("/api/nl-search", async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(body));
        };
        try {
          const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
          const q = (url.searchParams.get("q") ?? "").trim();
          if (!q) return send(400, { error: "missing q" });
          if (!nlKey && !aladinKey) {
            return send(500, {
              error: "No NL_API_KEY or ALADIN_TTB_KEY in .env.local",
            });
          }
          const payload = await searchBooksCombined(q, { nlKey, aladinKey });
          return send(200, payload);
        } catch (e) {
          return send(502, { error: e instanceof Error ? e.message : String(e) });
        }
      });

      // Cover image proxy (CORS) so the client can sample pixels in dev too.
      const ALLOWED = /(^|\.)aladin\.co\.kr$|(^|\.)nl\.go\.kr$/i;
      server.middlewares.use("/api/img-proxy", async (req, res) => {
        try {
          const u = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
          const target = u.searchParams.get("url") ?? "";
          const parsed = new URL(target);
          if (!ALLOWED.test(parsed.host)) {
            res.statusCode = 403;
            return res.end("host not allowed");
          }
          const r = await fetch(parsed.toString());
          const buf = Buffer.from(await r.arrayBuffer());
          res.statusCode = r.status;
          res.setHeader("Content-Type", r.headers.get("content-type") ?? "image/jpeg");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(buf);
        } catch (e) {
          res.statusCode = 502;
          res.end(e instanceof Error ? e.message : "fetch failed");
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    root: ".",
    publicDir: "public",
    plugins: [bookSearchDevPlugin(env.NL_API_KEY, env.ALADIN_TTB_KEY)],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: false,
      target: "es2020",
    },
    server: { port: 5180 },
  };
});
