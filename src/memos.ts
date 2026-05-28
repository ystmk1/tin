// Per-bold-excerpt user memos.
//
// Keyed by (filePath, boldText) — the text of the bold passage is what we
// have at hand and it survives page reordering, while a positional index
// would not. Stored in localStorage for now (same pattern as the wishlist);
// cloud sync can be layered on later.

interface Memo {
  filePath: string;
  boldText: string;
  text: string;
}

const KEY = "dokki:memos:v1";

function readAll(): Memo[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Memo[]) : [];
  } catch {
    return [];
  }
}

function writeAll(memos: Memo[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(memos));
  } catch {
    /* quota or disabled — ignore */
  }
}

// Canonical key: trim and collapse internal whitespace so the same passage
// always lands on the same memo regardless of incidental whitespace drift.
function key(boldText: string): string {
  return boldText.replace(/\s+/g, " ").trim();
}

export function getMemo(filePath: string, boldText: string): string {
  const k = key(boldText);
  return readAll().find((m) => m.filePath === filePath && key(m.boldText) === k)?.text ?? "";
}

/** Write the memo (empty text removes the row). */
export function setMemo(filePath: string, boldText: string, text: string): void {
  const k = key(boldText);
  const memos = readAll();
  const i = memos.findIndex((m) => m.filePath === filePath && key(m.boldText) === k);
  if (text.trim() === "") {
    if (i >= 0) {
      memos.splice(i, 1);
      writeAll(memos);
    }
    return;
  }
  if (i >= 0) memos[i].text = text;
  else memos.push({ filePath, boldText: k, text });
  writeAll(memos);
}

/** Canonical-key set of bold texts in this note that already have a memo. */
export function memoBolds(filePath: string): Set<string> {
  const out = new Set<string>();
  for (const m of readAll()) {
    if (m.filePath === filePath && m.text.trim()) out.add(key(m.boldText));
  }
  return out;
}
