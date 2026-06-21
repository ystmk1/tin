import { defineConfig, loadEnv, type Plugin } from "vite";
import { searchBooksCombined } from "./lib/book-search";
import { callVisionAnnotate } from "./lib/vision-ocr";
import { callGeminiClean } from "./lib/gemini-clean";

// Dev mirror of the api/ocr.ts + api/gemini-clean.ts serverless functions so
// the scan page works under `npm run dev`. Keys come from .env.local; if a key
// is absent the endpoint reports { configured: false } and the client falls
// back to a browser-entered key.
function readJsonBody(req: import("http").IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function scanDevPlugin(visionKey?: string, geminiKey?: string, geminiModel?: string): Plugin {
  return {
    name: "tin-scan-dev",
    configureServer(server) {
      const json = (res: import("http").ServerResponse, status: number, body: unknown) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(body));
      };

      server.middlewares.use("/api/ocr", async (req, res) => {
        if (req.method === "GET") return json(res, 200, { configured: !!visionKey });
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        if (!visionKey) return json(res, 501, { error: "GOOGLE_VISION_API_KEY 미설정", configured: false });
        try {
          const body = await readJsonBody(req);
          const responses = await callVisionAnnotate(visionKey, body.requests ?? []);
          return json(res, 200, { responses });
        } catch (e) {
          return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });

      server.middlewares.use("/api/gemini-clean", async (req, res) => {
        if (req.method === "GET") return json(res, 200, { configured: !!geminiKey });
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        if (!geminiKey) return json(res, 501, { error: "GEMINI_API_KEY 미설정", configured: false });
        try {
          const body = await readJsonBody(req);
          const text = await callGeminiClean({
            apiKey: geminiKey,
            text: String(body.text ?? ""),
            customPrompt: String(body.customPrompt ?? ""),
            // Empty → callGeminiClean auto-detects the newest flash model.
            model: (body.model && String(body.model)) || geminiModel || "",
          });
          return json(res, 200, { text });
        } catch (e) {
          return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}

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
    plugins: [
      bookSearchDevPlugin(env.NL_API_KEY, env.ALADIN_TTB_KEY),
      scanDevPlugin(env.GOOGLE_VISION_API_KEY, env.GEMINI_API_KEY, env.GEMINI_MODEL),
    ],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: false,
      target: "es2020",
      rollupOptions: {
        input: {
          main: "index.html",
          curation: "curation.html",
          scan: "scan.html",
        },
      },
    },
    server: { port: 5180 },
  };
});
