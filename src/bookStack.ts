import { BookNote } from "./types";

export interface BookStackOpts {
  /** Right-click a spine → context menu (filePath + cursor position). */
  onContextMenu?: (filePath: string, x: number, y: number) => void;
  /** Cover-derived tint ("r,g,b") to wash the spine background, very lightly. */
  tintFor?: (filePath: string) => string | undefined;
}

export function renderBookStack(
  container: HTMLElement,
  books: BookNote[],
  onOpen: (path: string) => void,
  opts?: BookStackOpts,
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
    row.dataset.path = b.filePath;
    const tint = opts?.tintFor?.(b.filePath);
    if (tint) {
      row.addClass("dokki-spine-tinted");
      row.style.setProperty("--spine-tint", tint);
    }
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
    // Status + date on the right (desktop). Hidden on mobile via CSS; the
    // colored left border conveys status there. Columns are fr-based so the
    // author stays aligned regardless of status-text length.
    const status = inner.createDiv({ cls: "dokki-spine-status" });
    status.setText(statusLabel(b));
    row.addEventListener("click", () => onOpen(b.filePath));
    if (opts?.onContextMenu) {
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        opts.onContextMenu!(b.filePath, e.clientX, e.clientY);
      });
    }
  }
}

function statusLabel(b: BookNote): string {
  switch (b.status) {
    case "reading":
      return "읽는 중";
    case "stopped":
      return b.frontmatter.stoppedAtPage ? `p.${b.frontmatter.stoppedAtPage} 중단` : "중단";
    case "finished":
      return b.frontmatter.endDate ? `완독 · ${b.frontmatter.endDate}` : "완독";
    default:
      return b.frontmatter.rawStatus ?? "";
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

