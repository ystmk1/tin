// Routes OCR + Gemini calls through the serverless proxy when the deployment
// has the keys configured, and falls back to direct browser calls with a
// user-supplied key otherwise. The client probes /api/* once on load.

import {
  buildVisionRequest,
  callVisionAnnotate,
  type VisionMode,
  type VisionRequest,
} from "../../lib/vision-ocr";
import { callGeminiClean } from "../../lib/gemini-clean";

export interface ServerConfig {
  vision: boolean;
  gemini: boolean;
}

export { buildVisionRequest };
export type { VisionMode, VisionRequest };

export async function probeConfig(): Promise<ServerConfig> {
  const ask = async (path: string): Promise<boolean> => {
    try {
      const r = await fetch(path, { method: "GET" });
      if (!r.ok) return false;
      return !!(await r.json()).configured;
    } catch {
      return false;
    }
  };
  const [vision, gemini] = await Promise.all([ask("/api/ocr"), ask("/api/gemini-clean")]);
  return { vision, gemini };
}

/** Run a batch of Vision requests via proxy (server key) or direct (user key). */
export async function annotate(
  requests: VisionRequest[],
  opts: { useProxy: boolean; userKey?: string },
): Promise<unknown[]> {
  if (opts.useProxy) {
    const r = await fetch("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `OCR 프록시 오류 ${r.status}`);
    return (await r.json()).responses || [];
  }
  if (!opts.userKey) throw new Error("Vision API 키를 입력해주세요.");
  return callVisionAnnotate(opts.userKey, requests);
}

/** Refine one chunk via proxy (server key) or direct (user key). */
export async function cleanChunk(
  text: string,
  opts: { useProxy: boolean; userKey?: string; model?: string; customPrompt?: string },
): Promise<string> {
  if (opts.useProxy) {
    const r = await fetch("/api/gemini-clean", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, model: opts.model, customPrompt: opts.customPrompt }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Gemini 프록시 오류 ${r.status}`);
    return (await r.json()).text ?? text;
  }
  if (!opts.userKey) throw new Error("Gemini API 키를 입력해주세요.");
  return callGeminiClean({
    apiKey: opts.userKey,
    text,
    model: opts.model,
    customPrompt: opts.customPrompt,
  });
}
