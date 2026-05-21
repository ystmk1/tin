import { BookNote, GraphBasis } from "./types";
import { renderGraph, type GraphHandle } from "./graphView";
import { renderBookStack } from "./bookStack";
import { tagLeafOf } from "./parser-core";
import { searchBooks, NlBookResult } from "./nl-api";
import { getMetadata, setMetadata, clearMetadata, setCoverColor } from "./note-metadata";
import { isCloudEnabled } from "./supabase";
import { signInWith, signOut, userLabel, getUser } from "./auth";
import { extractCoverColor } from "./cover-color";

export interface WebViewOptions {
  books: BookNote[];
  isDemo: boolean;
  mount: HTMLElement;
  /** Persist uploaded files (main re-loads + calls reload afterwards). */
  onUpload: (files: File[]) => Promise<void>;
  /** Delete an uploaded note by filename (main re-loads afterwards). */
  onDelete: (filename: string) => Promise<void>;
  /** Delete several uploaded notes at once (one re-load afterwards). */
  onDeleteMany: (filenames: string[]) => Promise<void>;
  /** Save edited tags for an uploaded note (main rewrites + re-loads). */
  onEditTags: (filename: string, tags: string[]) => Promise<void>;
  /** True for demo/built-in notes (not deletable/editable). */
  isDemoPath: (filePath: string) => boolean;
}

export interface WebViewHandle {
  /** Swap the book set (after auth change or upload) and re-render. */
  reload: (books: BookNote[], isDemo: boolean) => void;
}

export function mountWebView({
  books,
  isDemo,
  mount,
  onUpload,
  onDelete,
  onDeleteMany,
  onEditTags,
  isDemoPath,
}: WebViewOptions): WebViewHandle {
  const state: ControlsState = {
    filterAuthors: new Set<string>(),
    filterTags: new Set<string>(),
    filterStatuses: new Set<string>(),
    filterRatings: new Set<string>(),
    search: "",
    graphBasis: "off",
  };
  let graph: GraphHandle | null = null;
  let lastOpenedBook: BookNote | null = null;
  // Marquee multi-select over the book stack.
  const selectedPaths = new Set<string>();
  let suppressOpen = false; // a drag just happened — swallow the trailing click

  function applySelectionClasses() {
    stackWrap.querySelectorAll<HTMLElement>(".dokki-spine").forEach((row) => {
      row.classList.toggle("is-selected", !!row.dataset.path && selectedPaths.has(row.dataset.path));
    });
  }
  let controlsEl: HTMLElement | null = null;

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
  const authSlot = document.createElement("div");
  authSlot.className = "dokki-auth";
  headerRight.appendChild(authSlot);
  header.appendChild(headerRight);
  mount.appendChild(header);

  const excerptWrap = document.createElement("div");
  excerptWrap.className = "dokki-excerpt";
  mount.appendChild(excerptWrap);

  const controlsHolder = document.createElement("div");
  mount.appendChild(controlsHolder);

  const graphSection = document.createElement("div");
  graphSection.className = "dokki-graph-section";
  const graphWrap = document.createElement("div");
  graphWrap.className = "dokki-graph-wrap";
  graphSection.appendChild(graphWrap);
  mount.appendChild(graphSection);

  // Upload button lives in the controls bar (right of the filter); it's a
  // persistent element moved into each freshly-built bar.
  const uploadSlot = document.createElement("div");
  uploadSlot.className = "dokki-upload-slot";

  const stackWrap = document.createElement("div");
  stackWrap.className = "dokki-stack-wrap";
  mount.appendChild(stackWrap);

  // Drag a marquee across the spines to select several at once (own notes
  // only); right-clicking the selection then offers a bulk delete.
  const marquee = document.createElement("div");
  marquee.className = "dokki-marquee";
  marquee.style.display = "none";
  stackWrap.appendChild(marquee);

  stackWrap.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !isCloudEnabled || !getUser()) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const fromSpine = (e.target as HTMLElement).closest(".dokki-spine");
    let moved = false;

    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
      if (!moved) {
        moved = true;
        suppressOpen = true; // the trailing click shouldn't open a note
        marquee.style.display = "block";
      }
      const minX = Math.min(startX, ev.clientX);
      const maxX = Math.max(startX, ev.clientX);
      const minY = Math.min(startY, ev.clientY);
      const maxY = Math.max(startY, ev.clientY);
      const wr = stackWrap.getBoundingClientRect();
      marquee.style.left = `${minX - wr.left}px`;
      marquee.style.top = `${minY - wr.top}px`;
      marquee.style.width = `${maxX - minX}px`;
      marquee.style.height = `${maxY - minY}px`;
      selectedPaths.clear();
      stackWrap.querySelectorAll<HTMLElement>(".dokki-spine").forEach((row) => {
        const r = row.getBoundingClientRect();
        const hit = r.left < maxX && r.right > minX && r.top < maxY && r.bottom > minY;
        const path = row.dataset.path;
        if (hit && path && !isDemoPath(path)) selectedPaths.add(path);
      });
      applySelectionClasses();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      marquee.style.display = "none";
      // A plain click on empty space clears the selection.
      if (!moved && !fromSpine && selectedPaths.size) {
        selectedPaths.clear();
        applySelectionClasses();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  // Pressing anywhere else clears the selection — except on an already-selected
  // spine (so you can right-click it) or inside the context menu.
  document.addEventListener("pointerdown", (e) => {
    if (!selectedPaths.size) return;
    const t = e.target as HTMLElement;
    if (t.closest(".dokki-ctx-menu")) return;
    const spine = t.closest(".dokki-spine") as HTMLElement | null;
    if (spine && spine.dataset.path && selectedPaths.has(spine.dataset.path)) return;
    selectedPaths.clear();
    applySelectionClasses();
  });

  // GitHub link lives at the very bottom now (desktop only, via CSS) — you
  // scroll past the book stack to reach it.
  const footer = document.createElement("footer");
  footer.className = "dokki-footer";
  const repoLink = document.createElement("a");
  repoLink.className = "dokki-repo-link";
  repoLink.href = "https://github.com/ystmk1/DoKKi";
  repoLink.target = "_blank";
  repoLink.rel = "noopener";
  repoLink.textContent = "GitHub →";
  footer.appendChild(repoLink);
  mount.appendChild(footer);

  const panel = document.createElement("aside");
  panel.className = "dokki-panel";
  panel.innerHTML = `<div class="dokki-panel-inner"></div>`;
  mount.appendChild(panel);
  const panelBackdrop = document.createElement("div");
  panelBackdrop.className = "dokki-panel-backdrop";
  panelBackdrop.addEventListener("click", () => closePanel());
  mount.appendChild(panelBackdrop);

  function openNote(b: BookNote, focus?: { page: number; text: string }) {
    lastOpenedBook = b;
    const inner = panel.querySelector(".dokki-panel-inner") as HTMLElement;
    inner.innerHTML = "";
    const close = document.createElement("button");
    close.className = "dokki-panel-close";
    close.textContent = "×";
    close.addEventListener("click", () => closePanel());
    inner.appendChild(close);

    // (Delete / edit-tags moved to the book-stack right-click context menu.)

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
      // No "#"; hierarchical tags are shown gathered as a path,
      // e.g. 문학 / 해외문학 / 프랑스문학 → "문학/해외문학/프랑스문학".
      if (b.frontmatter.tags.length) {
        const span = document.createElement("span");
        span.className = "dokki-tag";
        span.textContent = b.frontmatter.tags.join("/");
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
    // Resolve an ![[Note]] embed to that note's text, when it's a loaded note.
    const resolveEmbed = (name: string): string | null => {
      const hit = books.find(
        (x) => x.title === name || x.filePath === name || x.filePath === `${name}.md`,
      );
      if (!hit) return null;
      const parts: string[] = [];
      if (hit.externalQuote) parts.push(hit.externalQuote);
      for (const pg of hit.pages) parts.push(pg.body);
      const text = parts.join("\n\n").trim();
      return text || null;
    };

    const pagesEl = document.createElement("div");
    pagesEl.className = "dokki-panel-pages";
    for (const p of b.pages) {
      const block = document.createElement("section");
      block.className = "dokki-panel-page";
      block.dataset.page = String(p.page);
      const num = document.createElement("h3");
      num.textContent = `p. ${p.page}`;
      block.appendChild(num);
      const body = document.createElement("pre");
      body.className = "dokki-panel-body";
      body.innerHTML = renderBodyHTML(p.body, resolveEmbed);
      block.appendChild(body);
      pagesEl.appendChild(block);
    }
    inner.appendChild(pagesEl);
    panel.classList.add("is-open");
    panelBackdrop.classList.add("is-open");
    if (focus) scrollToExcerpt(inner, focus);
  }

  // Open scrolled so the excerpted passage sits ~mid-screen. Finds the matching
  // <strong> in the right page (else the page itself) and centres it.
  function scrollToExcerpt(inner: HTMLElement, focus: { page: number; text: string }) {
    const core = stripWrappingQuotes(focus.text.split("\n")[0]).trim().slice(0, 8);
    setTimeout(() => {
      const section = inner.querySelector(
        `.dokki-panel-page[data-page="${focus.page}"]`,
      ) as HTMLElement | null;
      if (!section) return;
      let target: HTMLElement = section;
      if (core) {
        const hit = Array.from(section.querySelectorAll("strong")).find((s) =>
          (s.textContent ?? "").includes(core),
        ) as HTMLElement | undefined;
        if (hit) target = hit;
      }
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
  }

  function renderHead(head: HTMLElement, b: BookNote) {
    head.innerHTML = "";
    const meta = getMetadata(b.filePath);

    if (meta) {
      // Cover (or letter placeholder) is the trigger for the actions popup —
      // 다시 검색 / 지우기 live one depth deeper now, not inline.
      const cover = document.createElement("button");
      cover.className = "dokki-panel-cover dokki-panel-cover-btn";
      cover.title = "표지를 눌러 다시 검색 / 지우기";
      cover.setAttribute("aria-label", "도서 정보 옵션 열기");
      if (meta.coverUrl) {
        const img = document.createElement("img");
        img.alt = `${meta.title} 표지`;
        img.loading = "lazy";
        img.src = meta.coverUrl;
        img.addEventListener("error", () => {
          img.remove();
          cover.classList.add("dokki-panel-cover-fallback");
          cover.textContent = (b.title[0] ?? "?").toUpperCase();
        });
        cover.appendChild(img);
      } else {
        cover.classList.add("dokki-panel-cover-fallback");
        cover.textContent = (b.title[0] ?? "?").toUpperCase();
      }
      cover.addEventListener("click", () => openCoverActions(b));
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

  function openCoverActions(b: BookNote) {
    const meta = getMetadata(b.filePath);
    if (!meta) return;

    const overlay = document.createElement("div");
    overlay.className = "dokki-search-overlay";
    const dialog = document.createElement("div");
    dialog.className = "dokki-cover-dialog";

    const closeBtn = document.createElement("button");
    closeBtn.className = "dokki-panel-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => overlay.remove());
    dialog.appendChild(closeBtn);

    if (meta.coverUrl) {
      const big = document.createElement("img");
      big.className = "dokki-cover-big";
      big.alt = `${meta.title} 표지`;
      big.src = meta.coverUrl;
      big.addEventListener("error", () => big.remove());
      dialog.appendChild(big);
    }

    const info = document.createElement("div");
    info.className = "dokki-cover-info";
    const t = document.createElement("div");
    t.className = "dokki-cover-title";
    t.textContent = meta.title || b.title;
    info.appendChild(t);
    const subBits: string[] = [];
    if (meta.author) subBits.push(meta.author);
    if (meta.publisher) subBits.push(meta.publisher);
    if (meta.pubYear) subBits.push(meta.pubYear);
    if (subBits.length) {
      const s = document.createElement("div");
      s.className = "dokki-cover-sub";
      s.textContent = subBits.join(" · ");
      info.appendChild(s);
    }
    dialog.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "dokki-cover-actions";
    const change = document.createElement("button");
    change.className = "dokki-libaction";
    change.textContent = "다시 검색";
    change.addEventListener("click", () => {
      overlay.remove();
      openSearch(b);
    });
    const remove = document.createElement("button");
    remove.className = "dokki-libaction dokki-libaction-quiet";
    remove.textContent = "지우기";
    remove.addEventListener("click", () => {
      clearMetadata(b.filePath);
      overlay.remove();
      const headEl = panel.querySelector(".dokki-panel-head") as HTMLElement | null;
      if (headEl) renderHead(headEl, b);
    });
    actions.append(change, remove);
    dialog.appendChild(actions);

    overlay.appendChild(dialog);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
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
        const meta = setMetadata(note.filePath, r);
        overlay.remove();
        const inner = panel.querySelector(".dokki-panel-inner") as HTMLElement;
        const head = inner.querySelector(".dokki-panel-head") as HTMLElement;
        if (head) renderHead(head, note);
        // Sample a spine tint from the cover once, then cache + re-render stack.
        if (r.coverUrl && !meta.coverColor) {
          void extractCoverColor(r.coverUrl).then((color) => {
            if (!color) return;
            setCoverColor(note.filePath, color);
            renderStack();
            graph?.recolor(); // repaint the matching star with the new cover tint
          });
        }
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
    graph = renderGraph(
      graphWrap,
      books,
      (path) => {
        const b = books.find((x) => x.filePath === path);
        if (b) openNote(b);
      },
      state.graphBasis,
    );
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
    selectedPaths.clear();
    stackWrap.innerHTML = "";
    stackWrap.appendChild(marquee);
    renderBookStack(
      stackWrap,
      filtered(state, books),
      (path) => {
        if (suppressOpen) {
          suppressOpen = false; // swallow the click that ended a marquee drag
          return;
        }
        const b = books.find((x) => x.filePath === path);
        if (b) openNote(b);
      },
      {
        tintFor: (path) => getMetadata(path)?.coverColor,
        onContextMenu: (path, x, y) => {
          if (selectedPaths.size > 1 && selectedPaths.has(path)) {
            openMultiDeleteMenu([...selectedPaths], x, y);
            return;
          }
          if (selectedPaths.size) {
            selectedPaths.clear();
            applySelectionClasses();
          }
          const b = books.find((x2) => x2.filePath === path);
          if (b) openSpineMenu(b, x, y);
        },
      },
    );
  }

  function openSpineMenu(b: BookNote, x: number, y: number) {
    // Edit/delete only for the user's own uploaded notes.
    if (!isCloudEnabled || !getUser() || isDemoPath(b.filePath)) return;

    document.querySelector(".dokki-ctx-menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "dokki-ctx-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const editBtn = document.createElement("button");
    editBtn.className = "dokki-ctx-item";
    editBtn.textContent = "태그 수정하기";
    editBtn.addEventListener("click", async () => {
      menu.remove();
      const current = b.frontmatter.tags.join("/");
      const input = window.prompt("태그 (/ 또는 , 로 구분)", current);
      if (input === null) return;
      const edited = input.split(/[/,]/).map((s) => s.trim()).filter(Boolean);
      const rating = b.frontmatter.rating;
      const tags = [...(rating ? ["☆".repeat(rating)] : []), ...edited];
      try {
        await onEditTags(b.filePath, tags);
      } catch (e) {
        alert(`태그 수정 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    const delBtn = document.createElement("button");
    delBtn.className = "dokki-ctx-item dokki-ctx-danger";
    delBtn.textContent = "삭제하기";
    delBtn.addEventListener("click", async () => {
      menu.remove();
      if (!confirm(`"${b.title}" 노트를 삭제할까요? 되돌릴 수 없습니다.`)) return;
      try {
        await onDelete(b.filePath);
      } catch (e) {
        alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    menu.append(editBtn, delBtn);
    document.body.appendChild(menu);

    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("mousedown", close);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", close), 0);
  }

  function openMultiDeleteMenu(paths: string[], x: number, y: number) {
    const deletable = paths.filter((p) => !isDemoPath(p));
    if (!isCloudEnabled || !getUser() || deletable.length === 0) return;

    document.querySelector(".dokki-ctx-menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "dokki-ctx-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const delBtn = document.createElement("button");
    delBtn.className = "dokki-ctx-item dokki-ctx-danger";
    delBtn.textContent = `삭제하기 (${deletable.length}개)`;
    delBtn.addEventListener("click", async () => {
      menu.remove();
      if (!confirm(`선택한 ${deletable.length}개 노트를 삭제할까요? 되돌릴 수 없습니다.`)) return;
      try {
        await onDeleteMany(deletable);
      } catch (e) {
        alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    menu.append(delBtn);
    document.body.appendChild(menu);

    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("mousedown", close);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", close), 0);
  }

  function renderControlsBar() {
    const next = renderControls(state, books, {
      onSearchOrFilter: () => {
        renderStack();
        updateGraphHighlight();
      },
      onGraphBasisChange: () => {
        renderGraphSection();
      },
    });
    next.appendChild(uploadSlot); // upload button to the right of the filter
    if (controlsEl) controlsEl.replaceWith(next);
    else controlsHolder.appendChild(next);
    controlsEl = next;
  }

  function renderAuthSlot() {
    authSlot.innerHTML = "";
    if (!isCloudEnabled) return; // localStorage-only mode: no auth UI
    const user = getUser();
    if (user) {
      const name = document.createElement("span");
      name.className = "dokki-auth-name";
      name.textContent = userLabel(user);
      const out = document.createElement("button");
      out.className = "dokki-auth-btn";
      out.textContent = "로그아웃";
      out.addEventListener("click", () => void signOut());
      authSlot.append(name, out);
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
    authSlot.appendChild(wrap);
  }

  function renderUploadSlot() {
    uploadSlot.innerHTML = "";
    // Uploads need an account. Only show when signed in.
    if (!isCloudEnabled || !getUser()) return;
    // Same pill as the filter button, with a leading "+" icon.
    const btn = document.createElement("button");
    btn.className = "dokki-filter-btn";
    const icon = document.createElement("span");
    icon.className = "dokki-filter-icon";
    icon.textContent = "＋";
    const lbl = document.createElement("span");
    lbl.textContent = "노트 올리기";
    btn.append(icon, lbl);
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".md,text/markdown";
    picker.multiple = true;
    picker.style.display = "none";
    picker.addEventListener("change", () => {
      if (picker.files && picker.files.length) void doUpload(Array.from(picker.files));
      picker.value = "";
    });
    btn.addEventListener("click", () => picker.click());
    uploadSlot.append(btn, picker);
  }

  async function doUpload(files: File[]) {
    try {
      await onUpload(files);
    } catch (e) {
      alert(`업로드 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Whole-app drag & drop (signed-in only).
  const dropOverlay = document.createElement("div");
  dropOverlay.className = "dokki-drop-overlay";
  dropOverlay.textContent = "여기에 .md 파일을 놓으세요";
  mount.appendChild(dropOverlay);
  let dragDepth = 0;
  const canUpload = () => isCloudEnabled && !!getUser();
  mount.addEventListener("dragenter", (e) => {
    if (!canUpload()) return;
    e.preventDefault();
    dragDepth++;
    dropOverlay.classList.add("is-active");
  });
  mount.addEventListener("dragover", (e) => {
    if (canUpload()) e.preventDefault();
  });
  mount.addEventListener("dragleave", () => {
    if (!canUpload()) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.classList.remove("is-active");
  });
  mount.addEventListener("drop", (e) => {
    if (!canUpload()) return;
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove("is-active");
    const files = e.dataTransfer?.files;
    if (files && files.length) void doUpload(Array.from(files));
  });

  function renderAll() {
    mount.classList.toggle("dokki-demo", isDemo);
    renderExcerpt(excerptWrap, books, (b, focus) => openNote(b, focus));
    renderControlsBar();
    renderGraphSection();
    renderStack();
    renderAuthSlot();
    renderUploadSlot();
  }

  renderAll();

  return {
    reload(nextBooks: BookNote[], nextIsDemo: boolean) {
      books = nextBooks;
      isDemo = nextIsDemo;
      closePanel();
      renderAll();
    },
  };
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
  onOpen: (b: BookNote, focus?: { page: number; text: string }) => void,
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
    // Strip quotes per line so a merged multi-line dialogue reads as one quote
    // (the outer “ ” come from CSS); line breaks are preserved.
    quote.textContent = pick.text.split("\n").map(stripWrappingQuotes).join("\n");
    wrap.appendChild(quote);
    const meta = document.createElement("div");
    meta.className = "dokki-quote-meta";
    const title = document.createElement("span");
    title.className = "dokki-quote-title";
    title.textContent = pick.bookTitle;
    title.addEventListener("click", () => b && onOpen(b, { page: pick.page, text: pick.text }));
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
  graphBasis: GraphBasis;
}

interface ControlsHooks {
  onSearchOrFilter: () => void;
  /** Graph connection basis changed → rebuild the graph. */
  onGraphBasisChange: () => void;
}

// Single-select chips for the graph connection basis.
const GRAPH_BASIS_OPTIONS: Array<[GraphBasis, string]> = [
  ["off", "연결 끄기"],
  ["author", "저자"],
  ["tag", "태그"],
  ["both", "저자+태그"],
];

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

  // Drag-to-move: grab the popover by its header. Position (relative to the
  // filter root) persists across rebuilds and reopens.
  let popPos: { left: number; top: number } | null = null;
  const applyPopPos = () => {
    if (!popPos) return;
    popover.style.left = `${popPos.left}px`;
    popover.style.top = `${popPos.top}px`;
    popover.style.right = "auto";
  };
  const makeHeadDraggable = (head: HTMLElement) => {
    head.style.cursor = "move";
    head.style.userSelect = "none";
    head.style.touchAction = "none";
    head.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest(".dokki-filter-clear")) return;
      e.preventDefault();
      const startLeft = popover.offsetLeft;
      const startTop = popover.offsetTop;
      const sx = e.clientX;
      const sy = e.clientY;
      popover.style.left = `${startLeft}px`;
      popover.style.top = `${startTop}px`;
      popover.style.right = "auto";
      // Track on window so the drag keeps up even if the cursor outruns the
      // small header.
      const move = (ev: PointerEvent) => {
        popPos = { left: startLeft + (ev.clientX - sx), top: startTop + (ev.clientY - sy) };
        applyPopPos();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
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
    makeHeadDraggable(head);

    // Graph connection basis (single-select; a view preference, not a filter —
    // so it sits apart from the badge/초기화).
    popover.appendChild(
      buildModeSection("연결", GRAPH_BASIS_OPTIONS, state.graphBasis, (next) => {
        state.graphBasis = next;
        buildPopover();
        hooks.onGraphBasisChange();
      }),
    );

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
    applyPopPos(); // keep a dragged position across rebuilds
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

// Single-select variant of a filter section: exactly one chip is active.
function buildModeSection<T extends string>(
  label: string,
  options: Array<[T, string]>,
  active: T,
  onSelect: (value: T) => void,
): HTMLElement {
  const section = document.createElement("div");
  section.className = "dokki-filter-section";
  const heading = document.createElement("div");
  heading.className = "dokki-filter-section-label";
  heading.textContent = label;
  section.appendChild(heading);
  const list = document.createElement("div");
  list.className = "dokki-filter-section-list";
  for (const [val, text] of options) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "dokki-filter-chip";
    if (val === active) chip.classList.add("is-active");
    chip.textContent = text;
    chip.addEventListener("click", () => {
      if (val !== active) onSelect(val);
    });
    list.appendChild(chip);
  }
  section.appendChild(list);
  return section;
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
const EMBED = /!\[\[([^\]]+)\]\]/g; // ![[Note]] / ![[Note#sec|alias]] / ![[img.png]]
const MD_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g; // ![alt](url)
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/**
 * Render a page body to HTML.
 * - `![[Note]]` transclusions show like a `>` quote (the referenced note's
 *   text pulled in when `resolveEmbed` finds it, else just the name).
 * - `![alt](url)` images render in place.
 * - `### Title` → subheading, `**bold**` → highlight, big gaps → skip.
 */
function renderBodyHTML(
  body: string,
  resolveEmbed?: (name: string) => string | null,
  depth = 0,
): string {
  let html = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // ### Title → block subheading (before bold so its text can hold **bold**).
  html = html.replace(SUBHEADING_HTML, '<span class="dokki-subheading">$1</span>');
  // ![[…]] embeds → quote-styled block (display:block span, valid inside <pre>).
  html = html.replace(EMBED, (_m, inner: string) => {
    const name = inner.split("|")[0].split("#")[0].trim();
    if (IMG_EXT.test(name)) return `<span class="dokki-embed-missing">🖼 ${name}</span>`;
    const resolved = depth < 1 && resolveEmbed ? resolveEmbed(name) : null;
    const innerHtml = resolved != null ? renderBodyHTML(resolved, undefined, depth + 1) : name;
    return `<span class="dokki-panel-external dokki-embed">${innerHtml}</span>`;
  });
  // ![alt](url) → image in place (only safe URL schemes).
  html = html.replace(MD_IMAGE, (_m, alt: string, url: string) =>
    /^(https?:|data:|\/)/i.test(url) ? `<img class="dokki-md-img" src="${url}" alt="${alt}">` : alt,
  );
  // 3+ newlines = intentional skip; a single blank line is a paragraph break.
  html = html.replace(/\n{3,}/g, '<span class="dokki-skip" aria-hidden="true"></span>');
  return html.replace(BOLD_HTML, "<strong>$1</strong>");
}
