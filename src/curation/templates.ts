// The three modernist layout templates. Each takes a book + palette and
// returns a fully-built <article>. All text is set via textContent; only the
// generated SVG object is injected as markup.

import type { Book } from "./data";
import type { Palette } from "./palette";
import { generativeObject } from "./object";
import type { Template } from "./compose";

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function objectBox(book: Book, palette: Palette, cls: string, solid: boolean): HTMLElement {
  const box = el("div", cls);
  box.innerHTML = generativeObject(book.id, palette, { solid });
  return box;
}

function applyVars(card: HTMLElement, palette: Palette): void {
  card.style.setProperty("--key", palette.key);
  card.style.setProperty("--contrast", palette.contrast);
  card.style.setProperty("--accent", palette.accent);
}

// ─── Template A · Swiss Punk ──────────────────────────────────────────────
// One enormous keyword tears across the key-colour field; the excerpt is set
// in tiny type, tucked into the negative space; the object crops off a corner.
function templateA(book: Book, palette: Palette): HTMLElement {
  const card = el("article", "card card--a");
  applyVars(card, palette);
  card.dataset.tpl = "A";

  card.appendChild(objectBox(book, palette, "a__object", false));

  const word = el("div", "a__keyword", book.keyword);
  word.setAttribute("data-text", book.keyword);
  card.appendChild(word);

  card.appendChild(el("p", "a__excerpt", book.excerpt.replace(/\n+/g, " ")));

  const meta = el("footer", "a__meta");
  meta.appendChild(el("span", "a__page", `p.${book.page}`));
  meta.appendChild(el("span", "a__credit", `${book.title} · ${book.author}`));
  card.appendChild(meta);

  return card;
}

// ─── Template B · Emil Ruder Grid ─────────────────────────────────────────
// The frame is split into four quadrants by hairlines: oversized folio, a
// squared-off object, the justified excerpt, and a dry colophon.
function templateB(book: Book, palette: Palette): HTMLElement {
  const card = el("article", "card card--b");
  applyVars(card, palette);
  card.dataset.tpl = "B";

  const grid = el("div", "b__grid");

  const q1 = el("div", "b__q b__q1");
  const folio = el("div", "b__folio");
  folio.appendChild(el("span", "b__folio-p", "p."));
  folio.appendChild(el("span", "b__folio-n", String(book.page)));
  q1.appendChild(folio);

  const q2 = el("div", "b__q b__q2");
  q2.appendChild(objectBox(book, palette, "b__object", true));

  const q3 = el("div", "b__q b__q3");
  const body = el("div", "b__body");
  for (const para of book.excerpt.split(/\n{2,}/)) {
    body.appendChild(el("p", "b__para", para.trim()));
  }
  q3.appendChild(body);

  const q4 = el("div", "b__q b__q4");
  const colo = el("div", "b__colophon");
  colo.appendChild(el("span", "b__title", book.title));
  colo.appendChild(el("span", "b__author", book.author));
  if (book.publisher) colo.appendChild(el("span", "b__pub", book.publisher));
  q4.appendChild(colo);

  grid.append(q1, q2, q3, q4);
  card.appendChild(grid);
  return card;
}

// ─── Template C · Classic Poster Cinema ───────────────────────────────────
// Deep charcoal; a lit frame holds the object; the excerpt runs as a wide,
// tracked subtitle; a studio-mark sits up top.
function templateC(book: Book, palette: Palette): HTMLElement {
  const card = el("article", "card card--c");
  applyVars(card, palette);
  card.dataset.tpl = "C";

  const mark = el("header", "c__mark");
  mark.appendChild(el("span", "c__brand", "tin"));
  mark.appendChild(el("span", "c__sn", "Sn · 50"));
  card.appendChild(mark);

  const stage = el("div", "c__stage");
  const frame = el("div", "c__frame");
  frame.appendChild(objectBox(book, palette, "c__object", false));
  stage.appendChild(frame);
  stage.appendChild(el("h1", "c__title", book.title));
  card.appendChild(stage);

  const sub = el("p", "c__subtitle", book.excerpt.replace(/\n+/g, "  /  "));
  card.appendChild(sub);

  card.appendChild(
    el(
      "footer",
      "c__credit",
      [book.author, book.publisher, `p.${book.page}`].filter(Boolean).join("   ·   "),
    ),
  );
  return card;
}

export function renderTemplate(tpl: Template, book: Book, palette: Palette): HTMLElement {
  if (tpl === "A") return templateA(book, palette);
  if (tpl === "B") return templateB(book, palette);
  return templateC(book, palette);
}
