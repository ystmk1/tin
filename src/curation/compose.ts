// Auto-composition: given an excerpt, decide which of the three modernist
// templates best fits. Length and paragraph count drive the choice; mood only
// breaks ties. The result is deterministic, so a book always composes the same
// way unless the user overrides it.

import type { Book } from "./data";

export type Template = "A" | "B" | "C";

export interface Metrics {
  chars: number;
  paragraphs: number;
  sentences: number;
}

export function measure(excerpt: string): Metrics {
  const text = excerpt.trim();
  const chars = [...text.replace(/\s+/g, " ")].length;
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim()).length || 1;
  const sentences = (text.match(/[.!?。…]|다\.|다$/g) || []).length || 1;
  return { chars, paragraphs, sentences };
}

export const TEMPLATE_NAMES: Record<Template, string> = {
  A: "Swiss Punk",
  B: "Grid Matrix",
  C: "Poster Cinema",
};

/**
 * - Short and punchy  → A (one huge word, the excerpt buried in tiny type).
 * - Long or multi-para → B (the strict 4-quadrant grid for book-print reading).
 * - In between / lyrical → C (the cinematic poster).
 */
export function chooseTemplate(book: Book): Template {
  const m = measure(book.excerpt);

  if (m.paragraphs >= 2 || m.chars >= 220) return "B";
  if (m.chars <= 70 && m.paragraphs === 1) {
    // Very short: punk by default, but a lyrical short line earns the poster.
    return book.mood === "literary" ? "C" : "A";
  }
  // Mid-length single paragraph.
  if (book.mood === "punk") return "A";
  return "C";
}
