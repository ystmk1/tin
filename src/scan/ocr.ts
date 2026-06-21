// Extract pipeline: OCR the images (batched + cached), detect sequential page
// numbers across pages, and reflow each page into clean text with "##### Np."
// markers. PDF pages skip OCR (text already extracted).

import { annotate, buildVisionRequest, type VisionMode } from "./api";
import { extractFullText } from "../../lib/vision-ocr";
import { fingerprint, toBase64, type ScanItem } from "./files";
import { processBookText, type ReflowMode } from "./reflow";

const BATCH = 16; // max images per Vision images:annotate call
const visionCache = new Map<string, string>();

export interface ExtractOpts {
  mode: VisionMode;
  lang: string; // e.g. "ko+en"
  reflow: ReflowMode;
  useProxy: boolean;
  userKey?: string;
  onProgress?: (pct: number, label: string) => void;
}

export interface ExtractResult {
  text: string;
  badge: string;
}

export async function runExtract(items: ScanItem[], opts: ExtractOpts): Promise<ExtractResult> {
  const progress = opts.onProgress ?? (() => {});
  const n = items.length;
  const raw: { text: string; source: string }[] = new Array(n);

  // Phase 1 — resolve PDF + cached, collect the rest for Vision.
  const todo: { idx: number; item: ScanItem; fp: string }[] = [];
  for (let i = 0; i < n; i++) {
    const item = items[i];
    if (item.extractedText != null) {
      raw[i] = { text: item.extractedText, source: "pdf" };
      continue;
    }
    const fp = fingerprint(item, opts.mode, opts.lang);
    if (visionCache.has(fp)) {
      raw[i] = { text: visionCache.get(fp)!, source: "vision-cached" };
      continue;
    }
    todo.push({ idx: i, item, fp });
  }

  // Phase 2 — Vision in batches.
  if (todo.length > 0) {
    const langHints = opts.lang.split("+");
    for (let bs = 0; bs < todo.length; bs += BATCH) {
      const batch = todo.slice(bs, bs + BATCH);
      const range = todo.length > BATCH ? `(${bs + 1}–${bs + batch.length}/${todo.length})` : `(${batch.length}장)`;
      progress(Math.round((bs / todo.length) * 50), `OCR 인식 중… ${range}`);

      const requests = await Promise.all(
        batch.map(async (b) => buildVisionRequest(await toBase64(b.item.file!), opts.mode, langHints)),
      );
      const responses = await annotate(requests, { useProxy: opts.useProxy, userKey: opts.userKey });
      responses.forEach((resp, j) => {
        const text = extractFullText(resp);
        visionCache.set(batch[j].fp, text);
        raw[batch[j].idx] = { text, source: "vision" };
      });
    }
  }

  // Phase 3 — page-number tracking + reflow, in order.
  const out: string[] = [];
  let lastPage: number | null = null;
  for (let i = 0; i < n; i++) {
    const text = raw[i]?.text || "";
    if (!text) continue;

    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    let confirmed: number | null = null;
    let jump = false;
    const candidates: number[] = [];
    if (lines.length) {
      const top = lines[0].match(/^\d+$/);
      const bot = lines[lines.length - 1].match(/^\d+$/);
      if (top) candidates.push(parseInt(top[0]));
      if (bot) candidates.push(parseInt(bot[0]));
    }
    for (const num of candidates) {
      if (lastPage === null || num === lastPage + 1) {
        jump = false;
      } else {
        jump = true;
      }
      lastPage = num;
      confirmed = num;
      break;
    }

    if (jump && out.length > 0) out.push("\n\n\n");
    out.push(processBookText(text, opts.reflow, confirmed));
    progress(50 + Math.round(((i + 1) / n) * 50), `정리 중… (${i + 1}/${n})`);
  }

  // Badge.
  const sources = raw.map((r) => r?.source || "unknown");
  let badge = "대기중";
  if (sources.includes("vision")) badge = sources.includes("vision-cached") ? "Vision API (+캐시)" : "Google Vision API";
  else if (sources.includes("vision-cached")) badge = "Vision API (전부 캐시)";
  else if (sources.includes("pdf")) badge = "PDF 직접 텍스트";

  return { text: out.join("\n\n").trim() || "텍스트를 찾을 수 없습니다.", badge };
}
