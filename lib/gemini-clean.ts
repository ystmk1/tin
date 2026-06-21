// Gemini post-processing — environment-agnostic. The prompt is an OCR
// proofreader that stays faithful to the author's original wording and only
// repairs OCR damage. Shared by the serverless proxy (api/gemini-clean.ts),
// the dev middleware, and the browser client (direct calls with a user key).
//
// Crucially it preserves "##### Np." page markers verbatim — the exact page
// marker format tin notes use — so refined output drops straight into a note.

export const DEFAULT_MODEL = "gemini-1.5-flash";

/** Build the proofreader prompt with the (already provided) text inlined. */
export function buildCleanPrompt(text: string, customPrompt = ""): string {
  const extra = customPrompt.trim()
    ? `\nADDITIONAL BOOK-SPECIFIC INSTRUCTIONS (follow these, but they must not override the core principle of staying faithful to the original):\n${customPrompt.trim()}\n`
    : "";
  return `You are a careful OCR proofreader for Korean text. Your job is ONLY to repair errors introduced by the OCR process. Preserve the original text EXACTLY as the author wrote it.

CORE PRINCIPLE: Stay as faithful to the original as possible. Only fix damage caused by OCR (broken/garbled characters, noise, wrongly split or merged words). When in doubt, leave the text unchanged.

DO NOT:
- Do NOT correct or normalize dialect/사투리, slang, or colloquial speech. Keep the author's exact wording (e.g., do not turn "됐대" into "됐대요" or standardize regional speech).
- Do NOT add, remove, or "fix" quotation marks. If the author intentionally wrote dialogue without quotes (e.g., 수술은 잘됐대), keep it exactly that way — never add " " around it.
- Do NOT rephrase, paraphrase, or change the author's word choices, tone, or style.
- Do NOT change punctuation that the author intended.

DO (only OCR-level repairs):
1. Fix obvious OCR typos and broken/garbled characters where the intended word is clear from context.
2. Fix spacing only where OCR clearly split or joined words incorrectly.
3. Merge lines that OCR broke mid-sentence back into the same paragraph.
4. Separate distinct paragraphs (dialogue/narration) with double newlines, following the original layout.
5. Keep page markers EXACTLY as-is, including the "##### " prefix (e.g., "##### 256p."), as clear headers at the top of their respective sections. Never remove or alter the "#####" prefix.
6. Output ONLY the resulting Korean text without any explanation.
7. NEVER ask for the text or respond conversationally. The text is already provided below. If the input is empty, output nothing.
${extra}
Text to refine:
${text}`;
}

/**
 * Detect when the model returned a meta/conversational reply ("please provide
 * the text…") instead of doing the work — so the caller can keep the original.
 */
export function isMetaResponse(out: string): boolean {
  if (!out) return true;
  const lower = out.toLowerCase();
  const patterns = [
    /please provide the text/,
    /provide the (ocr|text|content)/,
    /paste the (ocr|text|content)/,
    /once you (paste|provide)/,
    /i will apply the rules/,
    /i('m| am) ready to/,
    /텍스트를 (입력|제공|붙여)/,
    /원문을 (입력|제공|붙여)/,
  ];
  return patterns.some((re) => re.test(lower));
}

function normalizeModel(model: string): string {
  const m = model.trim() || DEFAULT_MODEL;
  return m.startsWith("models/") ? m : `models/${m}`;
}

export interface GeminiCleanArgs {
  apiKey: string;
  text: string;
  customPrompt?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Refine one chunk of OCR text. Returns the refined text, or the original
 * unchanged when the input is blank or the model goes meta. Throws on API
 * errors (including 429 — rate-limit handling/rotation is the caller's job).
 */
export async function callGeminiClean({
  apiKey,
  text,
  customPrompt = "",
  model = DEFAULT_MODEL,
  fetchImpl = fetch,
}: GeminiCleanArgs): Promise<string> {
  if (!text || !text.trim()) return text;

  const url = `https://generativelanguage.googleapis.com/v1beta/${normalizeModel(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildCleanPrompt(text, customPrompt) }] }],
      generationConfig: { temperature: 0.1, topP: 0.95 },
    }),
  });

  if (res.status === 429) {
    const e = new Error("Gemini API 한도 도달 (429)");
    (e as Error & { code?: number }).code = 429;
    throw e;
  }
  if (!res.ok) {
    let detail = String(res.status);
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      /* non-JSON */
    }
    throw new Error(`Gemini API 오류: ${detail}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const out = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (out == null) throw new Error("AI 응답을 받지 못했습니다.");
  return isMetaResponse(out) ? text : out;
}
