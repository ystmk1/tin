// Sync only the notes that actually changed.
//
// Strategy: keep a {filename → sha256} map in plugin data. On sync we
//   1. hash every .md in the configured folder,
//   2. compare with the stored map,
//   3. batch-upsert the new + changed ones,
//   4. (optionally) delete cloud rows whose files no longer exist locally,
//   5. write the new hash map.
// No reads from the cloud during normal sync ⇒ Supabase egress stays near zero.

import { App, TFile, Notice } from "obsidian";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SyncHashes {
  // filename → hex sha256 of the file content
  [filename: string]: string;
}

export interface SyncOptions {
  /** "" = whole vault, else a folder path (matches Obsidian's TFile.path prefix). */
  folder: string;
  /**
   * Files inside this folder (relative to the vault root) sync as 조각글 —
   * the cloud row gets `is_fragment = true` and the web shows them in the
   * non-fiction strip instead of the book stack. Empty = no fragment folder.
   */
  fragmentFolder: string;
  /** Delete cloud rows whose local file has disappeared. Off by default — safer. */
  deleteRemoved: boolean;
}

export interface SyncResult {
  uploaded: number;
  removed: number;
  unchanged: number;
  skipped: number;
  newHashes: SyncHashes;
  errors: string[];
}

/** Returns the SHA-256 of `content` as lower-case hex. */
async function sha256Hex(content: string): Promise<string> {
  const buf = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

/** Gather .md files in the configured folder (or the whole vault when empty). */
function listMarkdown(app: App, folder: string): TFile[] {
  const all = app.vault.getMarkdownFiles();
  const prefix = folder.trim().replace(/^\/+|\/+$/g, "");
  if (!prefix) return all;
  const withSlash = prefix + "/";
  return all.filter((f) => f.path === prefix || f.path.startsWith(withSlash));
}

/** Filename only — matches what the web upload stores in `notes.filename`. */
function nameOf(f: TFile): string {
  return f.name;
}

/** Does `f`'s vault path sit inside `folder` (or equal it)? */
function inFolder(f: TFile, folder: string): boolean {
  const prefix = folder.trim().replace(/^\/+|\/+$/g, "");
  if (!prefix) return false;
  return f.path === prefix || f.path.startsWith(prefix + "/");
}

export async function runSync(
  app: App,
  supabase: SupabaseClient,
  userId: string,
  storedHashes: SyncHashes,
  opts: SyncOptions,
): Promise<SyncResult> {
  const result: SyncResult = {
    uploaded: 0,
    removed: 0,
    unchanged: 0,
    skipped: 0,
    newHashes: { ...storedHashes },
    errors: [],
  };

  // Filename-only roll call of cloud rows. Pulling just `filename` keeps the
  // egress at ~50 B per note (no content). This is what lets us notice that
  // a note was deleted in the web app and needs to be re-uploaded — without
  // it, sync would trust the local hash cache and report "변경없음".
  const cloudSet = new Set<string>();
  const { data: cloudRows, error: listErr } = await supabase
    .from("notes")
    .select("filename")
    .eq("user_id", userId);
  if (listErr) {
    // Soft-fail: proceed with the old cache-only behavior so a transient
    // outage doesn't block the sync entirely.
    result.errors.push(`클라우드 목록 조회 실패: ${listErr.message}`);
  } else {
    for (const r of cloudRows ?? []) cloudSet.add(r.filename as string);
  }
  const cloudListOk = !listErr;

  const files = listMarkdown(app, opts.folder);
  const rowsToUpsert: Array<{
    user_id: string;
    filename: string;
    content: string;
    is_fragment: boolean;
  }> = [];
  // Track which filenames we saw this run, so the local hash map can be
  // pruned and (optionally) cloud rows can be deleted.
  const seen = new Set<string>();

  for (const f of files) {
    const filename = nameOf(f);
    if (seen.has(filename)) {
      // Two files share a basename — the cloud schema can only store one
      // (notes.filename is unique per user). Skip the duplicate; the user
      // can resolve by renaming.
      result.skipped++;
      result.errors.push(`중복 파일명: ${filename} (${f.path})`);
      continue;
    }
    seen.add(filename);

    let content: string;
    try {
      content = await app.vault.read(f);
    } catch (e) {
      result.skipped++;
      result.errors.push(`읽기 실패: ${f.path} — ${(e as Error).message}`);
      continue;
    }

    const hash = await sha256Hex(content);
    const isFragment = inFolder(f, opts.fragmentFolder);
    // Cache key encodes the fragment flag: moving a file in/out of the 조각
    // folder must re-upload it (so the cloud row's is_fragment flips) even
    // when the content hash is unchanged. `f:` prefix is the only marker;
    // old plain-hash entries keep matching non-fragment notes after upgrade.
    const cacheKey = isFragment ? `f:${hash}` : hash;
    const inCloud = cloudListOk ? cloudSet.has(filename) : true; // fall back to cache only
    if (inCloud && storedHashes[filename] === cacheKey) {
      result.unchanged++;
      continue;
    }
    rowsToUpsert.push({ user_id: userId, filename, content, is_fragment: isFragment });
    result.newHashes[filename] = cacheKey;
  }

  // Single batch upsert — one HTTP round-trip for N changed notes.
  if (rowsToUpsert.length) {
    const { error } = await supabase
      .from("notes")
      .upsert(rowsToUpsert, { onConflict: "user_id,filename" });
    if (error) {
      // Don't update the local hash map for files whose upload failed; they'll
      // retry next run.
      for (const row of rowsToUpsert) delete result.newHashes[row.filename];
      result.errors.push(`업로드 실패: ${error.message}`);
    } else {
      result.uploaded = rowsToUpsert.length;
    }
  }

  // Prune local hash entries for files that no longer exist locally — and
  // optionally delete the cloud rows too.
  const missingLocally = Object.keys(result.newHashes).filter((name) => !seen.has(name));
  for (const name of missingLocally) delete result.newHashes[name];
  if (opts.deleteRemoved && missingLocally.length) {
    const { error } = await supabase
      .from("notes")
      .delete()
      .eq("user_id", userId)
      .in("filename", missingLocally);
    if (error) result.errors.push(`삭제 실패: ${error.message}`);
    else result.removed = missingLocally.length;
  }

  return result;
}

/** Pretty one-line summary suitable for a Notice. */
export function formatSyncSummary(r: SyncResult): string {
  const parts = [`업로드 ${r.uploaded}`, `삭제 ${r.removed}`, `변경없음 ${r.unchanged}`];
  if (r.skipped) parts.push(`건너뜀 ${r.skipped}`);
  let line = parts.join(" · ");
  if (r.errors.length) line += ` · 오류 ${r.errors.length}`;
  return line;
}

export function showSyncResult(r: SyncResult): void {
  new Notice(`DoKKi 동기화: ${formatSyncSummary(r)}`);
  if (r.errors.length) {
    console.warn("[DoKKi sync] errors:", r.errors);
  }
}
