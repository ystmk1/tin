import { load as yamlLoad } from "js-yaml";
import { BookNote } from "./types";
import { parseBookContent } from "./parser-core";

// Vite bundles every md in notes/ as raw string at build time.
const modules = import.meta.glob("../notes/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function basenameOf(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? path;
  return last.replace(/\.md$/i, "");
}

export function loadBooks(): BookNote[] {
  const out: BookNote[] = [];
  for (const [path, raw] of Object.entries(modules)) {
    const title = basenameOf(path);
    try {
      const note = parseBookContent(raw, path, title, (s) => yamlLoad(s) as Record<string, unknown>);
      out.push(note);
    } catch (e) {
      console.warn("parse failed", path, e);
    }
  }
  return out;
}
