import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { BookNote, BoldFragment, GraphLinkBasis } from "../../src/types";
import { parseAllBooks } from "./parser";
import { renderGraph } from "../../src/graphView";
import { renderBookStack } from "../../src/bookStack";

export const VIEW_TYPE_DOKKI = "dokki-explorer";

export class DokkiView extends ItemView {
  private books: BookNote[] = [];
  private basis: GraphLinkBasis = "author";
  private filterAuthor: string | null = null;
  private filterTag: string | null = null;
  private filterStatus: string | null = null;
  private searchQuery = "";
  private currentBold: BoldFragment | null = null;
  private graphCleanup: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private notesFolder: string) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_DOKKI;
  }
  getDisplayText() {
    return "DoKKi";
  }
  getIcon() {
    return "book-open";
  }

  async onOpen() {
    await this.reload();
  }

  async onClose() {
    this.graphCleanup?.();
  }

  async reload() {
    this.books = await parseAllBooks(this.app, this.notesFolder);
    this.render();
  }

  private render() {
    this.graphCleanup?.();
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("dokki-root");

    this.renderHeader(root as HTMLElement);
    this.renderControls(root as HTMLElement);
    this.renderGraphSection(root as HTMLElement);
    this.renderBookStackSection(root as HTMLElement);
  }

  private renderHeader(parent: HTMLElement) {
    const wrap = parent.createDiv({ cls: "dokki-excerpt" });
    const bolds = this.allBolds();
    if (bolds.length === 0) {
      wrap.createEl("div", { cls: "dokki-excerpt-empty", text: "발췌가 아직 없습니다." });
      return;
    }
    this.currentBold = bolds[Math.floor(Math.random() * bolds.length)];
    const quote = wrap.createEl("blockquote", { cls: "dokki-quote" });
    quote.setText(this.currentBold.text);
    const meta = wrap.createDiv({ cls: "dokki-quote-meta" });
    const titleEl = meta.createEl("span", { cls: "dokki-quote-title", text: this.currentBold.bookTitle });
    titleEl.addEventListener("click", () => this.openFile(this.currentBold!.filePath));
    if (this.currentBold.author) {
      meta.createEl("span", { cls: "dokki-quote-sep", text: " · " });
      meta.createEl("span", { cls: "dokki-quote-author", text: this.currentBold.author });
    }
    meta.createEl("span", { cls: "dokki-quote-sep", text: " · " });
    meta.createEl("span", { cls: "dokki-quote-page", text: `p.${this.currentBold.page}` });

    const reroll = wrap.createEl("button", { cls: "dokki-reroll", text: "↻" });
    reroll.setAttr("aria-label", "다른 발췌 보기");
    reroll.addEventListener("click", () => this.renderHeaderReroll(wrap));
  }

  private renderHeaderReroll(wrap: HTMLElement) {
    wrap.empty();
    this.renderHeaderInto(wrap);
  }

  private renderHeaderInto(wrap: HTMLElement) {
    const bolds = this.allBolds();
    if (!bolds.length) return;
    const pick = bolds[Math.floor(Math.random() * bolds.length)];
    this.currentBold = pick;
    const quote = wrap.createEl("blockquote", { cls: "dokki-quote", text: pick.text });
    void quote;
    const meta = wrap.createDiv({ cls: "dokki-quote-meta" });
    const titleEl = meta.createEl("span", { cls: "dokki-quote-title", text: pick.bookTitle });
    titleEl.addEventListener("click", () => this.openFile(pick.filePath));
    if (pick.author) {
      meta.createEl("span", { cls: "dokki-quote-sep", text: " · " });
      meta.createEl("span", { text: pick.author });
    }
    meta.createEl("span", { cls: "dokki-quote-sep", text: " · " });
    meta.createEl("span", { text: `p.${pick.page}` });
    const reroll = wrap.createEl("button", { cls: "dokki-reroll", text: "↻" });
    reroll.addEventListener("click", () => this.renderHeaderReroll(wrap));
  }

  private renderControls(parent: HTMLElement) {
    const bar = parent.createDiv({ cls: "dokki-controls" });
    const search = bar.createEl("input", { cls: "dokki-search", attr: { type: "search", placeholder: "검색 (제목·저자·태그·본문)" } });
    search.value = this.searchQuery;
    search.addEventListener("input", () => {
      this.searchQuery = search.value;
      this.rerenderStack();
    });

    const basisWrap = bar.createDiv({ cls: "dokki-basis" });
    basisWrap.createSpan({ text: "연결: " });
    const btnA = basisWrap.createEl("button", { text: "저자", cls: this.basis === "author" ? "is-active" : "" });
    const btnT = basisWrap.createEl("button", { text: "태그", cls: this.basis === "tag-leaf" ? "is-active" : "" });
    btnA.addEventListener("click", () => {
      this.basis = "author";
      this.rerenderGraph();
      btnA.addClass("is-active");
      btnT.removeClass("is-active");
    });
    btnT.addEventListener("click", () => {
      this.basis = "tag-leaf";
      this.rerenderGraph();
      btnT.addClass("is-active");
      btnA.removeClass("is-active");
    });

    const filters = bar.createDiv({ cls: "dokki-filters" });
    const status = filters.createEl("select", { cls: "dokki-select" });
    for (const opt of [
      ["", "상태 전체"],
      ["reading", "읽는 중"],
      ["stopped", "중단"],
      ["finished", "완독"],
      ["unknown", "기타"],
    ]) {
      const o = status.createEl("option", { value: opt[0], text: opt[1] });
      if (this.filterStatus === opt[0] || (!this.filterStatus && opt[0] === "")) o.selected = true;
    }
    status.addEventListener("change", () => {
      this.filterStatus = status.value || null;
      this.rerenderStack();
    });

    const authors = uniqueSorted(this.books.map((b) => b.frontmatter.author ?? "").filter(Boolean));
    const authorSel = filters.createEl("select", { cls: "dokki-select" });
    authorSel.createEl("option", { value: "", text: "저자 전체" });
    for (const a of authors) authorSel.createEl("option", { value: a, text: a });
    authorSel.value = this.filterAuthor ?? "";
    authorSel.addEventListener("change", () => {
      this.filterAuthor = authorSel.value || null;
      this.rerenderStack();
    });

    const tagLeaves = uniqueSorted(this.books.flatMap((b) => b.frontmatter.tags.map((t) => leafOf(t))));
    const tagSel = filters.createEl("select", { cls: "dokki-select" });
    tagSel.createEl("option", { value: "", text: "태그 전체" });
    for (const t of tagLeaves) tagSel.createEl("option", { value: t, text: t });
    tagSel.value = this.filterTag ?? "";
    tagSel.addEventListener("change", () => {
      this.filterTag = tagSel.value || null;
      this.rerenderStack();
    });

    const reload = bar.createEl("button", { cls: "dokki-reload", text: "새로고침" });
    reload.addEventListener("click", () => this.reload());
  }

  private renderGraphSection(parent: HTMLElement) {
    const wrap = parent.createDiv({ cls: "dokki-graph-wrap" });
    this.graphCleanup = renderGraph(wrap, this.books, this.basis, (path) => this.openFile(path));
  }

  private rerenderGraph() {
    const wrap = this.containerEl.querySelector(".dokki-graph-wrap") as HTMLElement | null;
    if (!wrap) return;
    this.graphCleanup?.();
    wrap.empty();
    this.graphCleanup = renderGraph(wrap, this.books, this.basis, (path) => this.openFile(path));
  }

  private renderBookStackSection(parent: HTMLElement) {
    const wrap = parent.createDiv({ cls: "dokki-stack-wrap" });
    renderBookStack(wrap, this.filteredBooks(), (path) => this.openFile(path));
  }

  private rerenderStack() {
    const wrap = this.containerEl.querySelector(".dokki-stack-wrap") as HTMLElement | null;
    if (!wrap) return;
    wrap.empty();
    renderBookStack(wrap, this.filteredBooks(), (path) => this.openFile(path));
  }

  private filteredBooks(): BookNote[] {
    const q = this.searchQuery.trim().toLowerCase();
    return this.books.filter((b) => {
      if (this.filterAuthor && b.frontmatter.author !== this.filterAuthor) return false;
      if (this.filterTag && !b.frontmatter.tags.some((t) => leafOf(t) === this.filterTag)) return false;
      if (this.filterStatus && b.status !== this.filterStatus) return false;
      if (!q) return true;
      if (b.title.toLowerCase().includes(q)) return true;
      if ((b.frontmatter.author ?? "").toLowerCase().includes(q)) return true;
      if (b.frontmatter.tags.some((t) => t.toLowerCase().includes(q))) return true;
      if ((b.frontmatter.comment ?? "").toLowerCase().includes(q)) return true;
      if (b.pages.some((p) => p.body.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  private allBolds(): BoldFragment[] {
    return this.books.flatMap((b) => b.allBolds);
  }

  private async openFile(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf("tab").openFile(file);
    } else {
      new Notice(`파일을 찾을 수 없습니다: ${path}`);
    }
  }
}

function uniqueSorted(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b, "ko"));
}

function leafOf(tag: string): string {
  const parts = tag.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? tag;
}
