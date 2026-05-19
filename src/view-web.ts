import { BookNote, GraphLinkBasis } from "./types";
import { renderGraph } from "./graphView";
import { renderBookStack } from "./bookStack";
import { tagLeafOf } from "./parser-core";
import { searchBooks, NlBookResult } from "./nl-api";
import { getMetadata, setMetadata, clearMetadata, NoteMetadata } from "./note-metadata";

export interface WebViewOptions {
  books: BookNote[];
  mount: HTMLElement;
}

export function mountWebView({ books, mount }: WebViewOptions): void {
  const state = {
    basis: "author" as GraphLinkBasis,
    filterAuthor: null as string | null,
    filterTag: null as string | null,
    filterStatus: null as string | null,
    search: "",
  };
  let graphCleanup: (() => void) | null = null;

  mount.classList.add("dokki-root");
  mount.innerHTML = "";

  const header = document.createElement("header");
  header.className = "dokki-page-header";
  const brand = document.createElement("a");
  brand.className = "dokki-brand";
  brand.href = "/";
  const brandImg = document.createElement("img");
  brandImg.src = "/android-chrome-192x192.png";
  brandImg.alt = "DoKKi";
  brandImg.width = 28;
  brandImg.height = 28;
  brand.appendChild(brandImg);
  const brandName = document.createElement("span");
  brandName.textContent = "A book must be the axe for the frozen sea within us.";
  brand.appendChild(brandName);
  header.appendChild(brand);
  const repoLink = document.createElement("a");
  repoLink.className = "dokki-repo-link";
  repoLink.href = "https://github.com/ystmk1/DoKKi";
  repoLink.target = "_blank";
  repoLink.rel = "noopener";
  repoLink.textContent = "GitHub →";
  header.appendChild(repoLink);
  mount.appendChild(header);

  const excerptWrap = document.createElement("div");
  excerptWrap.className = "dokki-excerpt";
  mount.appendChild(excerptWrap);
  renderExcerpt(excerptWrap, books, (b) => openNote(b));

  const controls = renderControls(state, books, {
    onSearchOrFilter: () => renderStack(),
    onBasisChange: () => renderGraphSection(),
  });
  mount.appendChild(controls);

  const graphWrap = document.createElement("div");
  graphWrap.className = "dokki-graph-wrap";
  mount.appendChild(graphWrap);

  const stackWrap = document.createElement("div");
  stackWrap.className = "dokki-stack-wrap";
  mount.appendChild(stackWrap);

  const panel = document.createElement("aside");
  panel.className = "dokki-panel";
  panel.innerHTML = `<div class="dokki-panel-inner"></div>`;
  mount.appendChild(panel);
  const panelBackdrop = document.createElement("div");
  panelBackdrop.className = "dokki-panel-backdrop";
  panelBackdrop.addEventListener("click", () => closePanel());
  mount.appendChild(panelBackdrop);

  function openNote(b: BookNote) {
    const inner = panel.querySelector(".dokki-panel-inner") as HTMLElement;
    inner.innerHTML = "";
    const close = document.createElement("button");
    close.className = "dokki-panel-close";
    close.textContent = "×";
    close.addEventListener("click", () => closePanel());
    inner.appendChild(close);

    const head = document.createElement("div");
    head.className = "dokki-panel-head";
    inner.appendChild(head);
    renderHead(head, b);

    const meta = document.createElement("div");
    meta.className = "dokki-panel-meta";
    const bits: string[] = [];
    if (b.frontmatter.author) bits.push(b.frontmatter.author);
    if (b.frontmatter.publisher) bits.push(b.frontmatter.publisher);
    if (b.frontmatter.rawStatus) bits.push(b.frontmatter.rawStatus);
    meta.textContent = bits.join(" · ");
    inner.appendChild(meta);
    if (b.frontmatter.tags.length) {
      const tags = document.createElement("div");
      tags.className = "dokki-panel-tags";
      for (const t of b.frontmatter.tags) {
        const span = document.createElement("span");
        span.className = "dokki-tag";
        span.textContent = "# " + t;
        tags.appendChild(span);
      }
      inner.appendChild(tags);
    }
    if (b.frontmatter.comment) {
      const c = document.createElement("blockquote");
      c.className = "dokki-panel-comment";
      c.textContent = b.frontmatter.comment;
      inner.appendChild(c);
    }
    if (b.externalQuote) {
      const e = document.createElement("blockquote");
      e.className = "dokki-panel-external";
      e.textContent = b.externalQuote;
      inner.appendChild(e);
    }
    const pagesEl = document.createElement("div");
    pagesEl.className = "dokki-panel-pages";
    for (const p of b.pages) {
      const block = document.createElement("section");
      block.className = "dokki-panel-page";
      const num = document.createElement("h3");
      num.textContent = `p. ${p.page}`;
      block.appendChild(num);
      const body = document.createElement("pre");
      body.className = "dokki-panel-body";
      body.innerHTML = renderBodyHTML(p.body);
      block.appendChild(body);
      pagesEl.appendChild(block);
    }
    inner.appendChild(pagesEl);
    panel.classList.add("is-open");
    panelBackdrop.classList.add("is-open");
  }

  function renderHead(head: HTMLElement, b: BookNote) {
    head.innerHTML = "";
    const meta = getMetadata(b.filePath);

    if (meta?.coverUrl) {
      const cover = document.createElement("img");
      cover.className = "dokki-panel-cover";
      cover.alt = `${meta.title} 표지`;
      cover.loading = "lazy";
      cover.src = meta.coverUrl;
      cover.addEventListener("error", () => cover.remove());
      head.appendChild(cover);
    }

    const titleWrap = document.createElement("div");
    titleWrap.className = "dokki-panel-title-wrap";
    const title = document.createElement("h2");
    title.textContent = b.title;
    titleWrap.appendChild(title);

    if (meta) {
      const sub = document.createElement("div");
      sub.className = "dokki-panel-libinfo";
      const subBits: string[] = [];
      if (meta.author) subBits.push(meta.author);
      if (meta.publisher) subBits.push(meta.publisher);
      if (meta.pubYear) subBits.push(meta.pubYear);
      sub.textContent = subBits.join(" · ");
      titleWrap.appendChild(sub);

      const actions = document.createElement("div");
      actions.className = "dokki-panel-libactions";
      const change = document.createElement("button");
      change.className = "dokki-libaction";
      change.textContent = "다시 검색";
      change.addEventListener("click", () => openSearch(b));
      const remove = document.createElement("button");
      remove.className = "dokki-libaction dokki-libaction-quiet";
      remove.textContent = "지우기";
      remove.addEventListener("click", () => {
        clearMetadata(b.filePath);
        renderHead(head, b);
      });
      actions.append(change, remove);
      titleWrap.appendChild(actions);
    } else {
      const search = document.createElement("button");
      search.className = "dokki-libsearch-btn";
      search.textContent = "+ 도서 정보 검색";
      search.title = "국립중앙도서관에서 이 책을 검색해 표지·서지 정보를 연결";
      search.addEventListener("click", () => openSearch(b));
      titleWrap.appendChild(search);
    }

    head.appendChild(titleWrap);
  }

  function openSearch(b: BookNote) {
    const overlay = document.createElement("div");
    overlay.className = "dokki-search-overlay";

    const dialog = document.createElement("div");
    dialog.className = "dokki-search-dialog";

    const head = document.createElement("div");
    head.className = "dokki-search-head";
    const heading = document.createElement("h3");
    heading.textContent = "국립중앙도서관 검색";
    head.appendChild(heading);
    const closeBtn = document.createElement("button");
    closeBtn.className = "dokki-panel-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => overlay.remove());
    head.appendChild(closeBtn);
    dialog.appendChild(head);

    const form = document.createElement("form");
    form.className = "dokki-search-form";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "dokki-search-input";
    input.value = b.title;
    input.placeholder = "제목·저자·키워드";
    input.autofocus = true;
    form.appendChild(input);
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "dokki-search-submit";
    submit.textContent = "검색";
    form.appendChild(submit);
    dialog.appendChild(form);

    const status = document.createElement("div");
    status.className = "dokki-search-status";
    dialog.appendChild(status);

    const results = document.createElement("div");
    results.className = "dokki-search-results";
    dialog.appendChild(results);

    overlay.appendChild(dialog);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 50);

    let currentAbort: AbortController | null = null;

    const run = async () => {
      const q = input.value.trim();
      if (!q) return;
      currentAbort?.abort();
      currentAbort = new AbortController();
      results.innerHTML = "";
      status.textContent = "검색 중…";
      submit.disabled = true;
      try {
        const data = await searchBooks(q, currentAbort.signal);
        submit.disabled = false;
        if (!data.results.length) {
          status.textContent = "검색 결과 없음.";
          return;
        }
        status.textContent = `${data.total}건 중 ${data.results.length}건 표시`;
        for (const r of data.results) results.appendChild(renderResultCard(r, b));
      } catch (e) {
        submit.disabled = false;
        if ((e as Error).name === "AbortError") return;
        status.textContent = `오류: ${(e as Error).message}`;
      }
    };

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void run();
    });
    void run();

    function renderResultCard(r: NlBookResult, note: BookNote): HTMLElement {
      const card = document.createElement("button");
      card.className = "dokki-search-card";
      card.type = "button";

      const coverBox = document.createElement("div");
      coverBox.className = "dokki-search-cover";
      if (r.coverUrl) {
        const img = document.createElement("img");
        img.src = r.coverUrl;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", () => {
          img.remove();
          coverBox.textContent = (r.title[0] ?? "?").toUpperCase();
          coverBox.classList.add("dokki-search-cover-fallback");
        });
        coverBox.appendChild(img);
      } else {
        coverBox.textContent = (r.title[0] ?? "?").toUpperCase();
        coverBox.classList.add("dokki-search-cover-fallback");
      }
      card.appendChild(coverBox);

      const text = document.createElement("div");
      text.className = "dokki-search-text";
      const t = document.createElement("div");
      t.className = "dokki-search-card-title";
      t.textContent = r.title;
      text.appendChild(t);
      const subBits: string[] = [];
      if (r.author) subBits.push(r.author);
      if (r.publisher) subBits.push(r.publisher);
      if (r.pubYear) subBits.push(r.pubYear);
      const s = document.createElement("div");
      s.className = "dokki-search-card-sub";
      s.textContent = subBits.join(" · ");
      text.appendChild(s);
      if (r.isbn) {
        const i = document.createElement("div");
        i.className = "dokki-search-card-isbn";
        i.textContent = `ISBN ${r.isbn}`;
        text.appendChild(i);
      }
      card.appendChild(text);

      card.addEventListener("click", () => {
        setMetadata(note.filePath, r);
        overlay.remove();
        const inner = panel.querySelector(".dokki-panel-inner") as HTMLElement;
        const head = inner.querySelector(".dokki-panel-head") as HTMLElement;
        if (head) renderHead(head, note);
      });
      return card;
    }
  }

  function closePanel() {
    panel.classList.remove("is-open");
    panelBackdrop.classList.remove("is-open");
  }

  function renderGraphSection() {
    graphCleanup?.();
    graphWrap.innerHTML = "";
    graphCleanup = renderGraph(graphWrap, books, state.basis, (path) => {
      const b = books.find((x) => x.filePath === path);
      if (b) openNote(b);
    });
  }

  function renderStack() {
    stackWrap.innerHTML = "";
    renderBookStack(stackWrap, filtered(state, books), (path) => {
      const b = books.find((x) => x.filePath === path);
      if (b) openNote(b);
    });
  }

  renderGraphSection();
  renderStack();
}

function renderExcerpt(
  wrap: HTMLElement,
  books: BookNote[],
  onOpen: (b: BookNote) => void,
): void {
  wrap.innerHTML = "";
  const bolds = books.flatMap((b) => b.allBolds);
  if (!bolds.length) {
    const empty = document.createElement("div");
    empty.className = "dokki-excerpt-empty";
    empty.textContent = "발췌가 아직 없습니다.";
    wrap.appendChild(empty);
    return;
  }
  const draw = () => {
    wrap.innerHTML = "";
    const pick = bolds[Math.floor(Math.random() * bolds.length)];
    const b = books.find((x) => x.filePath === pick.filePath);
    const quote = document.createElement("blockquote");
    quote.className = "dokki-quote";
    quote.textContent = pick.text;
    wrap.appendChild(quote);
    const meta = document.createElement("div");
    meta.className = "dokki-quote-meta";
    const title = document.createElement("span");
    title.className = "dokki-quote-title";
    title.textContent = pick.bookTitle;
    title.addEventListener("click", () => b && onOpen(b));
    meta.appendChild(title);
    if (pick.author) {
      meta.append(sep(), spanOf(pick.author));
    }
    meta.append(sep(), spanOf(`p.${pick.page}`));
    wrap.appendChild(meta);
    const reroll = document.createElement("button");
    reroll.className = "dokki-reroll";
    reroll.textContent = "↻";
    reroll.title = "다른 발췌 보기";
    reroll.addEventListener("click", draw);
    wrap.appendChild(reroll);
  };
  draw();
}

interface ControlsState {
  basis: GraphLinkBasis;
  filterAuthor: string | null;
  filterTag: string | null;
  filterStatus: string | null;
  search: string;
}

function renderControls(
  state: ControlsState,
  books: BookNote[],
  hooks: { onSearchOrFilter: () => void; onBasisChange: () => void },
): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "dokki-controls";

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "검색 (제목·저자·태그·본문)";
  search.className = "dokki-search";
  search.addEventListener("input", () => {
    state.search = search.value;
    hooks.onSearchOrFilter();
  });
  bar.appendChild(search);

  const basisWrap = document.createElement("div");
  basisWrap.className = "dokki-basis";
  basisWrap.append(spanOf("연결: "));
  const btnA = document.createElement("button");
  btnA.textContent = "저자";
  btnA.className = "is-active";
  const btnT = document.createElement("button");
  btnT.textContent = "태그";
  btnA.addEventListener("click", () => {
    state.basis = "author";
    btnA.classList.add("is-active");
    btnT.classList.remove("is-active");
    hooks.onBasisChange();
  });
  btnT.addEventListener("click", () => {
    state.basis = "tag-leaf";
    btnT.classList.add("is-active");
    btnA.classList.remove("is-active");
    hooks.onBasisChange();
  });
  basisWrap.append(btnA, btnT);
  bar.appendChild(basisWrap);

  const filters = document.createElement("div");
  filters.className = "dokki-filters";

  const statusSel = makeSelect([
    ["", "상태 전체"],
    ["reading", "읽는 중"],
    ["stopped", "중단"],
    ["finished", "완독"],
    ["unknown", "기타"],
  ]);
  statusSel.addEventListener("change", () => {
    state.filterStatus = statusSel.value || null;
    hooks.onSearchOrFilter();
  });
  filters.appendChild(statusSel);

  const authors = uniqueSorted(books.map((b) => b.frontmatter.author ?? "").filter(Boolean));
  const authorSel = makeSelect([["", "저자 전체"], ...authors.map((a) => [a, a] as [string, string])]);
  authorSel.addEventListener("change", () => {
    state.filterAuthor = authorSel.value || null;
    hooks.onSearchOrFilter();
  });
  filters.appendChild(authorSel);

  const tagLeaves = uniqueSorted(books.flatMap((b) => b.frontmatter.tags.map((t) => tagLeafOf(t))));
  const tagSel = makeSelect([["", "태그 전체"], ...tagLeaves.map((t) => [t, t] as [string, string])]);
  tagSel.addEventListener("change", () => {
    state.filterTag = tagSel.value || null;
    hooks.onSearchOrFilter();
  });
  filters.appendChild(tagSel);

  bar.appendChild(filters);
  return bar;
}

function makeSelect(options: [string, string][]): HTMLSelectElement {
  const sel = document.createElement("select");
  sel.className = "dokki-select";
  for (const [v, label] of options) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label;
    sel.appendChild(o);
  }
  return sel;
}

function filtered(state: ControlsState, books: BookNote[]): BookNote[] {
  const q = state.search.trim().toLowerCase();
  return books.filter((b) => {
    if (state.filterAuthor && b.frontmatter.author !== state.filterAuthor) return false;
    if (state.filterTag && !b.frontmatter.tags.some((t) => tagLeafOf(t) === state.filterTag)) return false;
    if (state.filterStatus && b.status !== state.filterStatus) return false;
    if (!q) return true;
    if (b.title.toLowerCase().includes(q)) return true;
    if ((b.frontmatter.author ?? "").toLowerCase().includes(q)) return true;
    if (b.frontmatter.tags.some((t) => t.toLowerCase().includes(q))) return true;
    if ((b.frontmatter.comment ?? "").toLowerCase().includes(q)) return true;
    if (b.pages.some((p) => p.body.toLowerCase().includes(q))) return true;
    return false;
  });
}

function uniqueSorted(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b, "ko"));
}

function sep(): HTMLElement {
  const s = document.createElement("span");
  s.className = "dokki-quote-sep";
  s.textContent = " · ";
  return s;
}

function spanOf(text: string): HTMLElement {
  const s = document.createElement("span");
  s.textContent = text;
  return s;
}

const BOLD_HTML = /\*\*([^*\n]+?)\*\*/g;
function renderBodyHTML(body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(BOLD_HTML, "<strong>$1</strong>");
}
