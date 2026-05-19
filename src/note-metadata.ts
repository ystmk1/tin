// Per-note bibliographic info chosen by the user from NL Korea search.
// Persists in localStorage. Keyed by note file path.

import { NlBookResult } from "./nl-api";

const KEY = "dokki:note-metadata:v1";

export interface NoteMetadata {
  controlNo: string;
  title: string;
  author?: string;
  publisher?: string;
  pubYear?: string;
  isbn?: string;
  coverUrl?: string;
  detailLink?: string;
  selectedAt: string; // ISO date
}

type Store = Record<string, NoteMetadata>;

function read(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // quota or disabled — silent
  }
}

export function getMetadata(filePath: string): NoteMetadata | null {
  return read()[filePath] ?? null;
}

export function setMetadata(filePath: string, result: NlBookResult): NoteMetadata {
  const meta: NoteMetadata = {
    controlNo: result.controlNo,
    title: result.title,
    author: result.author,
    publisher: result.publisher,
    pubYear: result.pubYear,
    isbn: result.isbn,
    coverUrl: result.coverUrl,
    detailLink: result.detailLink,
    selectedAt: new Date().toISOString(),
  };
  const store = read();
  store[filePath] = meta;
  write(store);
  return meta;
}

export function clearMetadata(filePath: string): void {
  const store = read();
  delete store[filePath];
  write(store);
}
