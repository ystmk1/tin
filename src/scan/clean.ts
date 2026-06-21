// Gemini "AI 정리" orchestration: chunk by paragraphs (~4000 chars to amortise
// the prompt overhead), refine each chunk, stream the result back as it lands.
// When using direct browser calls, rotates through multiple user keys on 429.

import { cleanChunk } from "./api";

const CHUNK_TARGET = 4000;
const refinedCache = new Map<string, string>();

export interface CleanOpts {
  useProxy: boolean;
  userKeys?: string[]; // BYO-key mode may hold several keys, rotated on 429
  model?: string;
  customPrompt?: string;
  onChunk?: (joinedSoFar: string, done: number, total: number) => void;
}

function chunkByParagraph(text: string): string[] {
  const paras = text.split(/\n\n+/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur.length + p.length > CHUNK_TARGET && cur !== "") {
      chunks.push(cur);
      cur = p;
    } else {
      cur = cur === "" ? p : cur + "\n\n" + p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export async function cleanText(text: string, opts: CleanOpts): Promise<string> {
  if (!text.trim()) return text;

  const cached = refinedCache.get(text);
  if (cached !== undefined) {
    opts.onChunk?.(cached, 1, 1);
    return cached;
  }

  const keys = opts.userKeys?.filter(Boolean) ?? [];
  let keyIdx = 0;

  const refineOne = async (chunk: string): Promise<string> => {
    // Proxy mode: one call, server handles the key.
    if (opts.useProxy) {
      return cleanChunk(chunk, { useProxy: true, model: opts.model, customPrompt: opts.customPrompt });
    }
    // Direct mode: try each key, rotating on 429.
    let attempts = 0;
    while (attempts <= keys.length) {
      const userKey = keys[keyIdx % keys.length];
      try {
        return await cleanChunk(chunk, {
          useProxy: false,
          userKey,
          model: opts.model,
          customPrompt: opts.customPrompt,
        });
      } catch (e) {
        const is429 = /429|한도/.test(e instanceof Error ? e.message : "");
        if (is429 && keys.length > 1 && attempts < keys.length - 1) {
          keyIdx++;
          attempts++;
          continue;
        }
        throw e;
      }
    }
    return chunk;
  };

  const chunks = chunkByParagraph(text);
  const result: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    // Let errors propagate so the UI can surface *why* the AI step failed
    // (bad/expired model, missing key, quota) instead of silently leaving the
    // un-refined text in place — which reads as "AI cleanup did nothing".
    const refined = await refineOne(chunks[i]);
    result.push(refined);
    opts.onChunk?.(result.join("\n\n"), i + 1, chunks.length);
  }

  const joined = result.join("\n\n");
  refinedCache.set(text, joined);
  return joined;
}
