// Minimal polyfill for Obsidian's HTMLElement helpers so shared modules
// (bookStack.ts, graphView.ts, view.ts) work in a plain browser.

interface CreateElOptions {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
  value?: string;
}

function applyOpts(el: HTMLElement, opts?: CreateElOptions): void {
  if (!opts) return;
  if (opts.cls) el.className = opts.cls;
  if (opts.text !== undefined) el.textContent = opts.text;
  if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, v);
  if (opts.value !== undefined && "value" in el) (el as HTMLInputElement).value = opts.value;
}

const proto = HTMLElement.prototype as HTMLElement & {
  createDiv?: (opts?: CreateElOptions) => HTMLDivElement;
  createSpan?: (opts?: CreateElOptions) => HTMLSpanElement;
  createEl?: <K extends keyof HTMLElementTagNameMap>(tag: K, opts?: CreateElOptions) => HTMLElementTagNameMap[K];
  addClass?: (...cls: string[]) => void;
  removeClass?: (...cls: string[]) => void;
  toggleClass?: (cls: string, force?: boolean) => void;
  hasClass?: (cls: string) => boolean;
  setText?: (text: string) => void;
  setAttr?: (name: string, value: string) => void;
  empty?: () => void;
};

if (!proto.createDiv) {
  proto.createDiv = function (opts?: CreateElOptions): HTMLDivElement {
    const el = document.createElement("div");
    applyOpts(el, opts);
    this.appendChild(el);
    return el;
  };
}
if (!proto.createSpan) {
  proto.createSpan = function (opts?: CreateElOptions): HTMLSpanElement {
    const el = document.createElement("span");
    applyOpts(el, opts);
    this.appendChild(el);
    return el;
  };
}
if (!proto.createEl) {
  proto.createEl = function <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: CreateElOptions,
  ): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    applyOpts(el as unknown as HTMLElement, opts);
    this.appendChild(el);
    return el;
  };
}
if (!proto.addClass) {
  proto.addClass = function (...cls: string[]): void {
    this.classList.add(...cls);
  };
}
if (!proto.removeClass) {
  proto.removeClass = function (...cls: string[]): void {
    this.classList.remove(...cls);
  };
}
if (!proto.toggleClass) {
  proto.toggleClass = function (cls: string, force?: boolean): void {
    this.classList.toggle(cls, force);
  };
}
if (!proto.hasClass) {
  proto.hasClass = function (cls: string): boolean {
    return this.classList.contains(cls);
  };
}
if (!proto.setText) {
  proto.setText = function (text: string): void {
    this.textContent = text;
  };
}
if (!proto.setAttr) {
  proto.setAttr = function (name: string, value: string): void {
    this.setAttribute(name, value);
  };
}
if (!proto.empty) {
  proto.empty = function (): void {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
}

declare global {
  interface HTMLElement {
    createDiv(opts?: CreateElOptions): HTMLDivElement;
    createSpan(opts?: CreateElOptions): HTMLSpanElement;
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, opts?: CreateElOptions): HTMLElementTagNameMap[K];
    addClass(...cls: string[]): void;
    removeClass(...cls: string[]): void;
    toggleClass(cls: string, force?: boolean): void;
    hasClass(cls: string): boolean;
    setText(text: string): void;
    setAttr(name: string, value: string): void;
    empty(): void;
  }
  interface HTMLDivElement {
    dataset: DOMStringMap;
  }
}

export {};
