// File intake: images become OCR candidates; PDFs are split into per-page
// text items (pdf.js, loaded from CDN in scan.html — no embedded OCR needed).

declare const pdfjsLib: any;

const PDF_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

export interface ScanItem {
  name: string;
  /** Present for image inputs (sent to Vision OCR). */
  file?: File;
  /** Present for PDF pages — text already extracted, no OCR needed. */
  extractedText?: string;
}

export function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function fingerprint(item: ScanItem, mode: string, lang: string): string {
  const f = item.file;
  const base = f ? `${f.name}|${f.size}|${f.lastModified}` : `pdf|${item.name}`;
  return `${base}|${mode}|${lang}`;
}

async function extractPdf(file: File): Promise<ScanItem[]> {
  if (typeof pdfjsLib === "undefined") throw new Error("PDF 라이브러리를 불러오지 못했습니다.");
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  } catch {
    /* already set */
  }
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: ScanItem[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it: { str: string }) => it.str).join(" ");
    pages.push({ name: `${file.name} (page ${i})`, extractedText: text });
  }
  return pages;
}

/** Turn a dropped/selected FileList into an ordered list of scan items. */
export async function intake(files: FileList | File[]): Promise<ScanItem[]> {
  const out: ScanItem[] = [];
  for (const file of Array.from(files)) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      out.push(...(await extractPdf(file)));
    } else if (file.type.startsWith("image/")) {
      out.push({ name: file.name, file });
    }
  }
  return out;
}
