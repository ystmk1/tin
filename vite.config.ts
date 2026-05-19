import { defineConfig, loadEnv, type Plugin } from "vite";
import { searchNlBooks } from "./lib/nl-search";

function nlSearchDevPlugin(apiKey: string | undefined): Plugin {
  return {
    name: "nl-search-dev",
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
          if (!apiKey) return send(500, { error: "NL_API_KEY not in .env.local" });
          const payload = await searchNlBooks(q, apiKey);
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
    plugins: [nlSearchDevPlugin(env.NL_API_KEY)],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: false,
      target: "es2020",
    },
    server: { port: 5180 },
  };
});
