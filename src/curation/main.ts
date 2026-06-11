// Curation prototype bootstrap. Holds a tiny bit of state — which sample,
// which theme, and whether the template is auto-chosen or pinned — and
// re-renders the full-viewport card on every change.

import "./curation.css";
import { BOOKS } from "./data";
import { buildPalette } from "./palette";
import { chooseTemplate, TEMPLATE_NAMES, type Template } from "./compose";
import { renderTemplate } from "./templates";

type Override = "auto" | Template;

const params = new URLSearchParams(location.search);
const qi = Number(params.get("i"));
const qt = (params.get("t") || "").toUpperCase();

const state = {
  index: Number.isFinite(qi) && qi >= 1 && qi <= BOOKS.length ? qi - 1 : 0,
  theme: params.get("theme") === "dark" ? "dark" : ("light" as "light" | "dark"),
  override: (["A", "B", "C"].includes(qt) ? qt : "auto") as Override,
};

const plate = document.getElementById("plate")!;
const controls = document.getElementById("controls")!;

function activeTemplate(): Template {
  const book = BOOKS[state.index];
  return state.override === "auto" ? chooseTemplate(book) : state.override;
}

function render(): void {
  const book = BOOKS[state.index];
  const palette = buildPalette(book.cover);
  const tpl = activeTemplate();

  document.documentElement.dataset.theme = state.theme;

  plate.replaceChildren(renderTemplate(tpl, book, palette));
  // Trigger the entrance transition on the fresh card.
  const card = plate.firstElementChild as HTMLElement | null;
  if (card) requestAnimationFrame(() => card.classList.add("is-in"));

  renderControls(tpl);
}

function renderControls(tpl: Template): void {
  const auto = chooseTemplate(BOOKS[state.index]);
  const tplBtns = (["auto", "A", "B", "C"] as Override[])
    .map((o) => {
      const on = state.override === o;
      const label = o === "auto" ? `auto · ${auto}` : o;
      return `<button class="ctl__tpl${on ? " is-on" : ""}" data-tpl="${o}">${label}</button>`;
    })
    .join("");

  controls.innerHTML = `
    <div class="ctl__group ctl__nav">
      <button class="ctl__btn" data-act="prev" aria-label="이전">‹</button>
      <span class="ctl__idx">${String(state.index + 1).padStart(2, "0")}<i>/</i>${String(BOOKS.length).padStart(2, "0")}</span>
      <button class="ctl__btn" data-act="next" aria-label="다음">›</button>
    </div>
    <div class="ctl__group ctl__tpls">${tplBtns}</div>
    <div class="ctl__group">
      <span class="ctl__name">${TEMPLATE_NAMES[tpl]}</span>
      <button class="ctl__btn ctl__theme" data-act="theme" aria-label="라이트/다크">${state.theme === "light" ? "◐" : "◑"}</button>
    </div>`;
}

function go(delta: number): void {
  state.index = (state.index + delta + BOOKS.length) % BOOKS.length;
  render();
}

controls.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest("button");
  if (!t) return;
  const act = t.dataset.act;
  if (act === "prev") go(-1);
  else if (act === "next") go(1);
  else if (act === "theme") {
    state.theme = state.theme === "light" ? "dark" : "light";
    render();
  } else if (t.dataset.tpl) {
    state.override = t.dataset.tpl as Override;
    render();
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") go(-1);
  else if (e.key === "ArrowRight") go(1);
  else if (e.key === "t" || e.key === "T") {
    state.theme = state.theme === "light" ? "dark" : "light";
    render();
  } else if (["a", "b", "c", "A", "B", "C"].includes(e.key)) {
    state.override = e.key.toUpperCase() as Template;
    render();
  } else if (e.key === "0") {
    state.override = "auto";
    render();
  }
});

render();
