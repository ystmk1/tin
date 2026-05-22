// "읽고 싶은 도서" — a lightweight want-to-read list. These are NOT notes:
// no body, no graph, no excerpts — just a title/author bookmark you can search
// for and stash.
//
// Two storage backends, transparently selected (same pattern as note-metadata):
//   - Signed in + Supabase configured → cloud table `wishlist`
//     (synced across devices, per-user via RLS)
//   - Otherwise → localStorage (device-only)
//
// A synchronous in-memory cache fronts both so the render path (getWishlist)
// stays sync. Writes update the cache immediately, then persist to the active
// backend in the background. On sign-in, device-local entries are migrated up.

import { supabase } from "./supabase";
import { getUser } from "./auth";

export interface WishItem {
  id: string;
  title: string;
  author?: string;
}

const KEY = "dokki:wishlist:v1";

let cache: WishItem[] = readLocal();

// ---------- public sync API (used by the render path) ----------

export function getWishlist(): WishItem[] {
  return cache;
}

/** Add to the front; ignores duplicates (by id). Returns the new list. */
export function addWishlist(item: WishItem): WishItem[] {
  cache = [item, ...cache.filter((w) => w.id !== item.id)];
  writeLocal(cache);
  void persistCloud(item);
  return cache;
}

export function removeWishlist(id: string): WishItem[] {
  cache = cache.filter((w) => w.id !== id);
  writeLocal(cache);
  void deleteCloud(id);
  return cache;
}

// ---------- lifecycle ----------

/**
 * Load the cache from the active backend. Call on app start and whenever auth
 * state changes. When transitioning into a signed-in state, local entries are
 * migrated to the cloud first so nothing is lost.
 */
export async function initWishlist(): Promise<void> {
  const user = getUser();
  if (supabase && user) {
    await migrateLocalToCloud(user.id);
    const { data, error } = await supabase
      .from("wishlist")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("[wishlist] cloud load failed, using local:", error.message);
      cache = readLocal();
      return;
    }
    const cloud = (data ?? []).map(rowToItem);
    // Merge cloud over local by id: cloud is source of truth, but keep any
    // local-only entries that haven't managed to persist yet.
    const seen = new Set(cloud.map((w) => w.id));
    const localOnly = readLocal().filter((w) => !seen.has(w.id));
    cache = [...cloud, ...localOnly];
    writeLocal(cache);
  } else {
    cache = readLocal();
  }
}

// ---------- cloud helpers ----------

async function persistCloud(item: WishItem): Promise<void> {
  const user = getUser();
  if (!supabase || !user) return;
  const { error } = await supabase.from("wishlist").upsert(
    { user_id: user.id, wish_id: item.id, title: item.title, author: item.author ?? null },
    { onConflict: "user_id,wish_id" },
  );
  if (error) console.warn("[wishlist] cloud upsert failed:", error.message);
}

async function deleteCloud(id: string): Promise<void> {
  const user = getUser();
  if (!supabase || !user) return;
  const { error } = await supabase
    .from("wishlist")
    .delete()
    .eq("user_id", user.id)
    .eq("wish_id", id);
  if (error) console.warn("[wishlist] cloud delete failed:", error.message);
}

async function migrateLocalToCloud(userId: string): Promise<void> {
  if (!supabase) return;
  const local = readLocal();
  if (local.length === 0) return;
  const rows = local.map((w) => ({
    user_id: userId,
    wish_id: w.id,
    title: w.title,
    author: w.author ?? null,
  }));
  // ignoreDuplicates: don't clobber entries the user already curated in the cloud.
  const { error } = await supabase
    .from("wishlist")
    .upsert(rows, { onConflict: "user_id,wish_id", ignoreDuplicates: true });
  if (error) console.warn("[wishlist] migrate failed:", error.message);
}

// ---------- row <-> item mapping ----------

interface Row {
  wish_id: string;
  title: string | null;
  author: string | null;
}

function rowToItem(row: Row): WishItem {
  return { id: row.wish_id, title: row.title ?? "", author: row.author ?? undefined };
}

// ---------- localStorage backend ----------

function readLocal(): WishItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as WishItem[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(items: WishItem[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* quota or disabled — ignore */
  }
}
