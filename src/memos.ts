// Per-bold-excerpt user memos.
//
// Keyed by (filePath, canonical bold text). Two storage backends, transparently
// selected (same pattern as note-metadata / wishlist):
//   - Signed in + Supabase configured → cloud `memos` table (RLS, per-user)
//   - Otherwise → localStorage (device-only)
//
// A synchronous in-memory cache fronts both so reads (getMemo / memoBolds)
// stay sync from the render path. Cloud writes are debounced so typing every
// keystroke isn't a round trip.

import { supabase } from "./supabase";
import { getUser } from "./auth";

interface Memo {
  filePath: string;
  /** Canonical key: whitespace-collapsed, trimmed bold text. */
  boldText: string;
  text: string;
}

const LOCAL_KEY = "dokki:memos:v1";
let cache: Memo[] = readLocal();

function canon(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ---------- public sync API ----------

export function getMemo(filePath: string, boldText: string): string {
  const k = canon(boldText);
  return cache.find((m) => m.filePath === filePath && m.boldText === k)?.text ?? "";
}

export function setMemo(filePath: string, boldText: string, text: string): void {
  const k = canon(boldText);
  const idx = cache.findIndex((m) => m.filePath === filePath && m.boldText === k);
  if (text.trim() === "") {
    if (idx >= 0) {
      cache.splice(idx, 1);
      writeLocal(cache);
      scheduleCloudDelete(filePath, k);
    }
    return;
  }
  if (idx >= 0) cache[idx].text = text;
  else cache.push({ filePath, boldText: k, text });
  writeLocal(cache);
  scheduleCloudUpsert({ filePath, boldText: k, text });
}

/** Canonical-key set of bold texts in this note that already have a memo. */
export function memoBolds(filePath: string): Set<string> {
  const out = new Set<string>();
  for (const m of cache) {
    if (m.filePath === filePath && m.text.trim()) out.add(m.boldText);
  }
  return out;
}

// ---------- lifecycle ----------

/**
 * Load the cache from the active backend. Call on app start and on every
 * auth change. Transitioning into a signed-in state migrates any device-
 * local memos up to the cloud first.
 */
export async function initMemos(): Promise<void> {
  const user = getUser();
  if (supabase && user) {
    await migrateLocalToCloud(user.id);
    const { data, error } = await supabase
      .from("memos")
      .select("file_path, bold_key, text")
      .eq("user_id", user.id);
    if (error) {
      console.warn("[memos] cloud load failed, using local:", error.message);
      cache = readLocal();
      return;
    }
    const cloud = (data ?? []).map(rowToMemo);
    // Merge cloud over local: cloud is the source of truth, but keep any
    // local-only entries that never managed to persist (a future sync will
    // push them up).
    const seen = new Set(cloud.map(rowKey));
    const localOnly = readLocal().filter((m) => !seen.has(rowKey(m)));
    cache = [...cloud, ...localOnly];
    writeLocal(cache);
  } else {
    cache = readLocal();
  }
}

// ---------- debounced cloud writes ----------

const pendingUpserts = new Map<string, ReturnType<typeof setTimeout>>();
const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 500;

function scheduleCloudUpsert(m: Memo): void {
  const id = rowKey(m);
  const prev = pendingUpserts.get(id);
  if (prev) clearTimeout(prev);
  pendingUpserts.set(
    id,
    setTimeout(() => {
      pendingUpserts.delete(id);
      void persistCloud(m);
    }, DEBOUNCE_MS),
  );
}

function scheduleCloudDelete(filePath: string, boldKey: string): void {
  const id = filePath + "" + boldKey;
  // Drop any pending upsert for this key — the delete supersedes it.
  const u = pendingUpserts.get(id);
  if (u) {
    clearTimeout(u);
    pendingUpserts.delete(id);
  }
  const prev = pendingDeletes.get(id);
  if (prev) clearTimeout(prev);
  pendingDeletes.set(
    id,
    setTimeout(() => {
      pendingDeletes.delete(id);
      void deleteCloud(filePath, boldKey);
    }, DEBOUNCE_MS),
  );
}

async function persistCloud(m: Memo): Promise<void> {
  const user = getUser();
  if (!supabase || !user) return;
  const { error } = await supabase.from("memos").upsert(
    { user_id: user.id, file_path: m.filePath, bold_key: m.boldText, text: m.text },
    { onConflict: "user_id,file_path,bold_key" },
  );
  if (error) console.warn("[memos] cloud upsert failed:", error.message);
}

async function deleteCloud(filePath: string, boldKey: string): Promise<void> {
  const user = getUser();
  if (!supabase || !user) return;
  const { error } = await supabase
    .from("memos")
    .delete()
    .eq("user_id", user.id)
    .eq("file_path", filePath)
    .eq("bold_key", boldKey);
  if (error) console.warn("[memos] cloud delete failed:", error.message);
}

async function migrateLocalToCloud(userId: string): Promise<void> {
  if (!supabase) return;
  const local = readLocal();
  if (!local.length) return;
  const rows = local.map((m) => ({
    user_id: userId,
    file_path: m.filePath,
    bold_key: m.boldText,
    text: m.text,
  }));
  // ignoreDuplicates: don't clobber cloud-side edits the user already made.
  const { error } = await supabase
    .from("memos")
    .upsert(rows, { onConflict: "user_id,file_path,bold_key", ignoreDuplicates: true });
  if (error) console.warn("[memos] migrate failed:", error.message);
}

// ---------- row <-> memo mapping ----------

interface Row {
  file_path: string;
  bold_key: string;
  text: string | null;
}

function rowToMemo(row: Row): Memo {
  return { filePath: row.file_path, boldText: row.bold_key, text: row.text ?? "" };
}

function rowKey(m: Memo): string {
  return m.filePath + "" + m.boldText;
}

// ---------- localStorage backend ----------

function readLocal(): Memo[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Memo[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(memos: Memo[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(memos));
  } catch {
    /* quota or disabled — ignore */
  }
}
