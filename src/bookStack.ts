import { BookNote } from "./types";

export function renderBookStack(
  container: HTMLElement,
  books: BookNote[],
  onOpen: (path: string) => void,
) {
  const list = container.createDiv({ cls: "dokki-stack" });
  if (!books.length) {
    list.createDiv({ cls: "dokki-stack-empty", text: "표시할 책이 없습니다." });
    return;
  }

  // Most recent on top: sort by endDate desc, fallback startDate desc, fallback title.
  const sorted = [...books].sort((a, b) => recencyKey(b) - recencyKey(a));

  for (const b of sorted) {
    const row = list.createDiv({ cls: "dokki-spine" });
    row.dataset.status = b.status;
    const inner = row.createDiv({ cls: "dokki-spine-inner" });
    inner.createDiv({ cls: "dokki-spine-title", text: b.title });
    const meta = inner.createDiv({ cls: "dokki-spine-meta" });
    if (b.frontmatter.author) {
      meta.createSpan({ cls: "dokki-spine-author", text: b.frontmatter.author });
    }
    if (b.frontmatter.publisher) {
      if (b.frontmatter.author) {
        meta.createSpan({ cls: "dokki-spine-sep", text: " · " });
      }
      meta.createSpan({ cls: "dokki-spine-publisher", text: b.frontmatter.publisher });
    }
    // Reading status is conveyed by the spine's color (via data-status in CSS),
    // not a variable-width text column — that kept the author column aligned.
    row.addEventListener("click", () => onOpen(b.filePath));
  }
}

function recencyKey(b: BookNote): number {
  const d = parseDate(b.frontmatter.endDate) ?? parseDate(b.frontmatter.startDate);
  if (d) return d.getTime();
  return 0;
}

function parseDate(s?: string): Date | null {
  if (!s) return null;
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t);
  const m = s.match(/(\d{4})[.\-\/년]\s*(\d{1,2})[.\-\/월]?\s*(\d{1,2})?/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1));
  return null;
}

