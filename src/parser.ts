import { TFile, App, parseYaml } from "obsidian";
import { BookNote } from "./types";
import { parseBookContent } from "./parser-core";

export { tagLeafOf } from "./parser-core";

export async function parseAllBooks(app: App, folder?: string): Promise<BookNote[]> {
  const files = app.vault.getMarkdownFiles().filter((f) => {
    if (!folder) return true;
    return f.path.startsWith(folder + "/") || f.path === folder;
  });
  const out: BookNote[] = [];
  for (const f of files) {
    try {
      const note = await parseBookFile(app, f);
      if (note) out.push(note);
    } catch (e) {
      console.warn("DoKKi parse failed:", f.path, e);
    }
  }
  return out;
}

export async function parseBookFile(app: App, file: TFile): Promise<BookNote | null> {
  const raw = await app.vault.cachedRead(file);
  return parseBookContent(raw, file.path, file.basename, (s) => parseYaml(s) as Record<string, unknown>);
}
