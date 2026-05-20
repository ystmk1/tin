import { BookNote } from "./types";
import { renderGraph, type GraphHandle } from "./graphView";
import { renderBookStack } from "./bookStack";
import { tagLeafOf } from "./parser-core";
import { searchBooks, NlBookResult } from "./nl-api";
import { getMetadata, setMetadata, clearMetadata, initMetadata } from "./note-metadata";
import { isCloudEnabled } from "./supabase";
import { onAuthChange, signInWith, signOut, userLabel, getUser } from "./auth";

export interface WebViewOptions {
  books: BookNote[];
  mount: HTMLElement;
}

export function mountWebView({ books, mount }: WebViewOptions): void {
  const state = {
    filterAuthors: new Set<string>(),
    filterTags: new Set<string>(),
    filterStatuses: new Set<string>(),
    filterRatings: new Set<string>(),
    search: "",
  };
  let graph: GraphHandle | null = null;
  let lastOpenedBook: BookNote | null = null;

  mount.classList.add("dokki-root");
  mount.innerHTML = "";

  const header = document.createElement("header");
  header.className = "dokki-page-header";
  const brand = document.createElement("a");
  brand.className = "dokki-brand";
  brand.href = "/";
  const brandName = document.createElement("span");
  brandName.textContent = "도끼";
  brand.appendChild(brandName);
  header.appendChild(brand);
  const headerRight = document.createElement("div");
  headerRight.className = "dokki-header-right";
  const repoLink = document.createElement("a");
  repoLink.className = "dokki-repo-link";
  repoLink.href = "https://github.com/ystmk1/DoKKi";
  repoLink.target = "_blank";
  repoLink.rel = "noopener";
  repoLink.textContent = "GitHub →";
  headerRight.appendChild(repoLink);
  const authSlot = document.createElement("div");
  authSlot.className = "dokki-auth";
  headerRight.appendChild(authSlot);
  header.appendChild(headerRight);
  mount.appendChild(header);

  // Auth control reflects cloud sync state. When cloud is disabled
  // (Supabase env not set), the slot stays empty and everything runs
  // off localStorage exactly as before.
  if (isCloudEnabled) {
    onAuthChange((user) => {
      renderAuthSlot(authSlot);
      // Reload metadata for the new identity, then refresh anything
      // currently on screen that depends on it.
      void initMetadata().then(() => {
        if (panel.classList.contains("is-open") && lastOpenedBook) {
          renderHead(
            panel.querySelector(".dokki-panel-head") as HTMLElement,
            lastOpenedBook,
          );
        }
      });
      void user;
    });
  }

  const excerptWrap = document.createElement("div");
  excerptWrap.className = "dokki-excerpt";
  mount.appendChild(excerptWrap);
  renderExcerpt(excerptWrap, books, (b) => openNote(b));

  const controls = renderControls(state, books, {
    onSearchOrFilter: () => {
      renderStack();
      updateGraphHighlight();
    },
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
    lastOpenedBook = b;
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

    const status = statusChipText(b);
    if (status || b.frontmatter.tags.length > 0) {
      const tags = document.createElement("div");
      tags.className = "dokki-panel-tags";
      if (status) {
        const chip = document.createElement("span");
        chip.className = "dokki-tag dokki-status";
        chip.textContent = status;
        tags.appendChild(chip);
      }
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
    const titleRow = document.createElement("div");
    titleRow.className = "dokki-panel-title-row";
    const title = document.createElement("h2");
    title.textContent = b.title;
    titleRow.appendChild(title);
    if (b.frontmatter.rating !== undefined && b.frontmatter.rating > 0) {
      const stars = renderRatingEl(b.frontmatter.rating);
      titleRow.appendChild(stars);
    }
    titleWrap.appendChild(titleRow);

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
      // No library metadata selected — surface the user's own frontmatter
      // (author / publisher) in the same libinfo slot. Status is handled
      // separately as a chip in the tags row.
      const fmBits: string[] = [];
      if (b.frontmatter.author) fmBits.push(b.frontmatter.author);
      if (b.frontmatter.publisher) fmBits.push(b.frontmatter.publisher);
      if (fmBits.length) {
        const sub = document.createElement("div");
        sub.className = "dokki-panel-libinfo";
        sub.textContent = fmBits.join(" · ");
        titleWrap.appendChild(sub);
      }
      const search = document.createElement("button");
      search.className = "dokki-libsearch-btn";
      search.textContent = "+ 도서 정보 검색";
      search.title = "국립중앙도서관·알라딘에서 검색해 표지·서지 정보를 연결";
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
    heading.textContent = "서지정보 검색";
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
    graph?.cleanup();
    graphWrap.innerHTML = "";
    graph = renderGraph(graphWrap, books, (path) => {
      const b = books.find((x) => x.filePath === path);
      if (b) openNote(b);
    });
    updateGraphHighlight();
  }

  function updateGraphHighlight() {
    if (!graph) return;
    if (!hasActiveFilter(state)) {
      graph.setHighlight(null);
      return;
    }
    const ids = new Set(filtered(state, books).map((b) => b.filePath));
    graph.setHighlight(ids);
  }

  function renderStack() {
    stackWrap.innerHTML = "";
    renderBookStack(stackWrap, filtered(state, books), (path) => {
      const b = books.find((x) => x.filePath === path);
      if (b) openNote(b);
    });
  }

  function renderAuthSlot(slot: HTMLElement) {
    slot.innerHTML = "";
    const user = getUser();
    if (user) {
      const name = document.createElement("span");
      name.className = "dokki-auth-name";
      name.textContent = userLabel(user);
      const out = document.createElement("button");
      out.className = "dokki-auth-btn";
      out.textContent = "로그아웃";
      out.addEventListener("click", () => void signOut());
      slot.append(name, out);
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "dokki-auth-login";
    const trigger = document.createElement("button");
    trigger.className = "dokki-auth-btn";
    trigger.textContent = "로그인";
    const menu = document.createElement("div");
    menu.className = "dokki-auth-menu";
    const g = document.createElement("button");
    g.className = "dokki-auth-provider";
    g.textContent = "Google로 로그인";
    g.addEventListener("click", () => void signInWith("google"));
    const k = document.createElement("button");
    k.className = "dokki-auth-provider";
    k.textContent = "Kakao로 로그인";
    k.addEventListener("click", () => void signInWith("kakao"));
    menu.append(g, k);
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("is-open");
    });
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target as Node)) menu.classList.remove("is-open");
    });
    wrap.append(trigger, menu);
    slot.appendChild(wrap);
  }

  renderGraphSection();
  renderStack();
}

function hasActiveFilter(state: ControlsState): boolean {
  return (
    state.search.trim().length > 0 ||
    state.filterAuthors.size > 0 ||
    state.filterTags.size > 0 ||
    state.filterStatuses.size > 0 ||
    state.filterRatings.size > 0
  );
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
    quote.textContent = stripWrappingQuotes(pick.text);
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
  filterAuthors: Set<string>;
  filterTags: Set<string>;
  filterStatuses: Set<string>;
  filterRatings: Set<string>;
  search: string;
}

interface ControlsHooks {
  onSearchOrFilter: () => void;
}

const STATUS_OPTIONS: Array<[string, string]> = [
  ["reading", "읽는 중"],
  ["stopped", "중단"],
  ["finished", "완독"],
  ["unknown", "기타"],
];

function renderControls(
  state: ControlsState,
  books: BookNote[],
  hooks: ControlsHooks,
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

  bar.appendChild(renderFilterButton(state, books, hooks));
  return bar;
}

function renderFilterButton(
  state: ControlsState,
  books: BookNote[],
  hooks: ControlsHooks,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "dokki-filter-root";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dokki-filter-btn";
  const icon = document.createElement("span");
  icon.className = "dokki-filter-icon";
  icon.textContent = "≡";
  const label = document.createElement("span");
  label.textContent = "필터";
  const badge = document.createElement("span");
  badge.className = "dokki-filter-badge";
  btn.append(icon, label, badge);
  root.appendChild(btn);

  const popover = document.createElement("div");
  popover.className = "dokki-filter-popover";
  root.appendChild(popover);

  const activeCount = () =>
    state.filterStatuses.size +
    state.filterAuthors.size +
    state.filterTags.size +
    state.filterRatings.size;

  const refreshBadge = () => {
    const n = activeCount();
    badge.textContent = String(n);
    btn.classList.toggle("is-active", n > 0);
  };

  const onChipChange = () => {
    refreshBadge();
    hooks.onSearchOrFilter();
  };

  const buildPopover = () => {
    popover.innerHTML = "";
    const head = document.createElement("div");
    head.className = "dokki-filter-popover-head";
    const title = document.createElement("span");
    title.textContent = "필터";
    head.appendChild(title);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "dokki-filter-clear";
    clear.textContent = "초기화";
    clear.addEventListener("click", () => {
      state.filterStatuses.clear();
      state.filterAuthors.clear();
      state.filterTags.clear();
      state.filterRatings.clear();
      buildPopover();
      refreshBadge();
      hooks.onSearchOrFilter();
    });
    head.appendChild(clear);
    popover.appendChild(head);

    const authors = uniqueSorted(books.map((b) => b.frontmatter.author ?? "").filter(Boolean));
    const tagLeaves = uniqueSorted(
      books.flatMap((b) => b.frontmatter.tags.map((t) => tagLeafOf(t))),
    );
    // Distinct ratings present in the data, high → low, labeled as filled stars.
    const ratings = Array.from(
      new Set(
        books
          .map((b) => b.frontmatter.rating)
          .filter((r): r is number => typeof r === "number" && r > 0),
      ),
    ).sort((a, b) => b - a);

    popover.appendChild(buildFilterSection("상태", STATUS_OPTIONS, state.filterStatuses, onChipChange));
    if (ratings.length) {
      popover.appendChild(
        buildFilterSection(
          "별점",
          ratings.map((r) => [String(r), "★".repeat(r)] as [string, string]),
          state.filterRatings,
          onChipChange,
        ),
      );
    }
    popover.appendChild(
      buildFilterSection(
        "저자",
        authors.map((a) => [a, a] as [string, string]),
        state.filterAuthors,
        onChipChange,
      ),
    );
    popover.appendChild(
      buildFilterSection(
        "태그",
        tagLeaves.map((t) => [t, t] as [string, string]),
        state.filterTags,
        onChipChange,
      ),
    );
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = popover.classList.toggle("is-open");
    if (open) buildPopover();
  });

  document.addEventListener("click", (e) => {
    if (!root.contains(e.target as Node)) popover.classList.remove("is-open");
  });

  refreshBadge();
  return root;
}

function buildFilterSection(
  label: string,
  options: Array<[string, string]>,
  set: Set<string>,
  onChange: () => void,
): HTMLElement {
  const section = document.createElement("div");
  section.className = "dokki-filter-section";
  const heading = document.createElement("div");
  heading.className = "dokki-filter-section-label";
  heading.textContent = label;
  section.appendChild(heading);
  const list = document.createElement("div");
  list.className = "dokki-filter-section-list";
  if (options.length === 0) {
    const empty = document.createElement("span");
    empty.className = "dokki-filter-empty";
    empty.textContent = "없음";
    list.appendChild(empty);
  } else {
    for (const [val, text] of options) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "dokki-filter-chip";
      if (set.has(val)) chip.classList.add("is-active");
      chip.textContent = text;
      chip.addEventListener("click", () => {
        if (set.has(val)) set.delete(val);
        else set.add(val);
        chip.classList.toggle("is-active");
        onChange();
      });
      list.appendChild(chip);
    }
  }
  section.appendChild(list);
  return section;
}

function filtered(state: ControlsState, books: BookNote[]): BookNote[] {
  const q = state.search.trim().toLowerCase();
  return books.filter((b) => {
    if (state.filterStatuses.size > 0 && !state.filterStatuses.has(b.status)) return false;
    if (state.filterAuthors.size > 0 && !state.filterAuthors.has(b.frontmatter.author ?? "")) return false;
    if (
      state.filterTags.size > 0 &&
      !b.frontmatter.tags.some((t) => state.filterTags.has(tagLeafOf(t)))
    ) {
      return false;
    }
    if (state.filterRatings.size > 0) {
      const r = b.frontmatter.rating;
      if (r === undefined || !state.filterRatings.has(String(r))) return false;
    }
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

function statusChipText(b: BookNote): string | undefined {
  const fm = b.frontmatter;
  switch (b.status) {
    case "finished":
      return fm.endDate ? `완독 · ${fm.endDate}` : "완독";
    case "reading":
      return "읽는 중";
    case "stopped":
      return fm.stoppedAtPage ? `p.${fm.stoppedAtPage} 중단` : "중단";
    default:
      return fm.rawStatus || undefined;
  }
}

// When the bold excerpt is a dialogue wrapped in matching quotes,
// strip the outer pair at render time only — CSS already adds visual
// curly quotes (“ ”) via ::before/::after, so the typed quotes would
// double up. The source .md is never touched.
//
// Lenient: any character considered an "opener" + any "closer" at the
// ends counts as a wrapped pair, so we cover ASCII straight, curly,
// CJK 「」『』, French «», low-9 „, etc. — and also ASCII " on both
// ends (same char as opener and closer).
const QUOTE_OPENERS = new Set([
  '"', "'", "“", "‘", "「", "『", "«", "‹", "„", "‚", "＂", "＇",
]);
const QUOTE_CLOSERS = new Set([
  '"', "'", "”", "’", "」", "』", "»", "›", "‟", "‛", "＂", "＇",
]);
function stripWrappingQuotes(s: string): string {
  let t = s.trim();
  // Strip ends independently. If the user only bolded part of a dialogue
  // (so only the leading quote is in the bold, or only the trailing one),
  // we still want that single quote gone to avoid the doubled-quote look.
  // Up to two passes covers the rare nested-quote case.
  for (let i = 0; i < 2; i++) {
    if (t.length === 0) break;
    let changed = false;
    if (QUOTE_OPENERS.has(t[0])) {
      t = t.slice(1).trimStart();
      changed = true;
    }
    if (t.length > 0 && QUOTE_CLOSERS.has(t[t.length - 1])) {
      t = t.slice(0, -1).trimEnd();
      changed = true;
    }
    if (!changed) break;
  }
  return t;
}

// Rounded star SVG path (chunky body, soft tips).
const STAR_PATH =
  "M12 3.4l2.62 5.31 5.86.85-4.24 4.13 1 5.84L12 16.78l-5.24 2.75 1-5.84L3.52 9.56l5.86-.85L12 3.4z";
const SVG_NS = "http://www.w3.org/2000/svg";

function renderRatingEl(rating: number): HTMLElement {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  const wrap = document.createElement("span");
  wrap.className = "dokki-rating";
  wrap.title = `${r} / 5`;
  wrap.setAttribute("aria-label", `별점 ${r}점 만점 5점`);
  for (let i = 0; i < 5; i++) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", i < r ? "dokki-star is-filled" : "dokki-star");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", STAR_PATH);
    svg.appendChild(path);
    wrap.appendChild(svg);
  }
  return wrap;
}

const BOLD_HTML = /\*\*([^*\n]+?)\*\*/g;
// Subheadings (### Title) — used inside page bodies of short-story
// collections etc. ## and # don't appear in user notes; ##### is the
// page marker, parsed away earlier. We only handle exactly ###.
const SUBHEADING_HTML = /^###[ \t]+(.+?)[ \t]*$/gm;
function renderBodyHTML(body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // ### Title → block subheading. Run before bold/skips so the captured
  // group text can still contain **bold** that gets processed later.
  const withHeadings = escaped.replace(
    SUBHEADING_HTML,
    '<span class="dokki-subheading">$1</span>',
  );
  // 3+ consecutive newlines (=2+ blank lines) represent an intentional skip
  // (middle of page skipped, or stitched-together continuous pages). Render
  // as a single normalized gap regardless of how many enters were typed.
  // A single blank line (\n\n, =book paragraph break) is preserved as-is
  // by the surrounding white-space: pre-wrap.
  const withSkips = withHeadings.replace(/\n{3,}/g, '<span class="dokki-skip" aria-hidden="true"></span>');
  return withSkips.replace(BOLD_HTML, "<strong>$1</strong>");
}
