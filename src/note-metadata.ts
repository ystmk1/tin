// Per-note bibliographic info chosen by the user from book search.
//
// Two storage backends, transparently selected:
//   - Signed in + Supabase configured → cloud table `note_selections`
//     (synced across devices, per-user via RLS)
//   - Otherwise → localStorage (device-only, original behavior)
//
// A synchronous in-memory cache fronts both so the render path
// (getMetadata) stays sync. Writes update the cache immediately, then
// persist to the active backend in the background. On sign-in, any
// device-local entries are migrated up to the cloud once.

import { NlBookResult } from "./nl-api";
import { supabase } from "./supabase";
import { getUser } from "./auth";

const LOCAL_KEY = "dokki:note-metadata:v1";

export interface NoteMetadata {
  controlNo: string;
  title: string;
  author?: string;
  publisher?: string;
  pubYear?: string;
  isbn?: string;
  coverUrl?: string;
  coverColor?: string; // "r,g,b" sampled from the cover, cached (computed once)
  detailLink?: string;
  source?: string;
  selectedAt: string; // ISO date
}

type Store = Record<string, NoteMetadata>;

let cache: Store = {};

// ---------- public sync API (used by the render path) ----------

export function getMetadata(filePath: string): NoteMetadata | null {
  return cache[filePath] ?? null;
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
    source: result.source,
    selectedAt: new Date().toISOString(),
  };
  cache[filePath] = meta;
  writeLocal(cache); // always mirror locally for offline / fallback
  void persistCloud(filePath, meta);
  return meta;
}

export function clearMetadata(filePath: string): void {
  delete cache[filePath];
  writeLocal(cache);
  void deleteCloud(filePath);
}

/** Cache the cover-derived tint color once and persist it. */
export function setCoverColor(filePath: string, color: string): void {
  const meta = cache[filePath];
  if (!meta) return;
  meta.coverColor = color;
  writeLocal(cache);
  void persistCloud(filePath, meta);
}

// ---------- lifecycle ----------

/**
 * Load the cache from the active backend. Call on app start and whenever
 * auth state changes. When transitioning into a signed-in state, local
 * entries are migrated to the cloud first so nothing is lost.
 */
export async function initMetadata(): Promise<void> {
  const user = getUser();
  if (supabase && user) {
    await migrateLocalToCloud(user.id);
    const { data, error } = await supabase
      .from("note_selections")
      .select("*")
      .eq("user_id", user.id);
    if (error) {
      console.warn("[note-metadata] cloud load failed, using local:", error.message);
      cache = readLocal();
      return;
    }
    const next: Store = {};
    for (const row of data ?? []) next[row.note_path] = rowToMeta(row);
    cache = next;
    writeLocal(cache);
  } else {
    cache = readLocal();
  }
}

// ---------- cloud helpers ----------

async function persistCloud(filePath: string, meta: NoteMetadata): Promise<void> {
  const user = getUser();
  if (!supabase || !user) return;
  const { error } = await supabase.from("note_selections").upsert(
    { ...metaToRow(meta), user_id: user.id, note_path: filePath },
    { onConflict: "user_id,note_path" },
  );
  if (error) console.warn("[note-metadata] cloud upsert failed:", error.message);
}

async function deleteCloud(filePath: string): Promise<void> {
  const user = getUser();
  if (!supabase || !user) return;
  const { error } = await supabase
    .from("note_selections")
    .delete()
    .eq("user_id", user.id)
    .eq("note_path", filePath);
  if (error) console.warn("[note-metadata] cloud delete failed:", error.message);
}

async function migrateLocalToCloud(userId: string): Promise<void> {
  if (!supabase) return;
  const local = readLocal();
  const paths = Object.keys(local);
  if (paths.length === 0) return;
  const rows = paths.map((p) => ({
    ...metaToRow(local[p]),
    user_id: userId,
    note_path: p,
  }));
  // ignoreDuplicates: don't clobber cloud entries the user already curated
  const { error } = await supabase
    .from("note_selections")
    .upsert(rows, { onConflict: "user_id,note_path", ignoreDuplicates: true });
  if (error) console.warn("[note-metadata] migrate failed:", error.message);
}

// ---------- row <-> meta mapping ----------

interface Row {
  note_path: string;
  control_no: string | null;
  title: string | null;
  author: string | null;
  publisher: string | null;
  pub_year: string | null;
  isbn: string | null;
  cover_url: string | null;
  cover_color: string | null;
  detail_link: string | null;
  source: string | null;
  updated_at?: string | null;
}

function rowToMeta(row: Row): NoteMetadata {
  return {
    controlNo: row.control_no ?? "",
    title: row.title ?? "",
    author: row.author ?? undefined,
    publisher: row.publisher ?? undefined,
    pubYear: row.pub_year ?? undefined,
    isbn: row.isbn ?? undefined,
    coverUrl: row.cover_url ?? undefined,
    coverColor: row.cover_color ?? undefined,
    detailLink: row.detail_link ?? undefined,
    source: row.source ?? undefined,
    selectedAt: row.updated_at ?? new Date().toISOString(),
  };
}

function metaToRow(meta: NoteMetadata): Omit<Row, "note_path"> {
  return {
    control_no: meta.controlNo || null,
    title: meta.title || null,
    author: meta.author ?? null,
    publisher: meta.publisher ?? null,
    pub_year: meta.pubYear ?? null,
    isbn: meta.isbn ?? null,
    cover_url: meta.coverUrl ?? null,
    cover_color: meta.coverColor ?? null,
    detail_link: meta.detailLink ?? null,
    source: meta.source ?? null,
  };
}

// ---------- localStorage backend ----------

function readLocal(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeLocal(store: Store): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
  } catch {
    /* quota or disabled — ignore */
  }
}
