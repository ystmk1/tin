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
