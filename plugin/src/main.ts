import {
  Plugin,
  WorkspaceLeaf,
  PluginSettingTab,
  Setting,
  App,
  Modal,
  Notice,
  Editor,
} from "obsidian";
import { DokkiView, VIEW_TYPE_DOKKI } from "./view";
import { findPageFixes, applyPageFixes, type PageFix } from "./format";

interface DokkiSettings {
  notesFolder: string;
}

const DEFAULT_SETTINGS: DokkiSettings = {
  notesFolder: "",
};

export default class DokkiPlugin extends Plugin {
  settings!: DokkiSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_DOKKI, (leaf) => new DokkiView(leaf, this.settings.notesFolder));

    this.addRibbonIcon("book-open", "DoKKi 열기", () => this.activateView());
    this.addCommand({
      id: "dokki-open",
      name: "DoKKi 탐색기 열기",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "dokki-reload",
      name: "DoKKi 노트 다시 읽기",
      callback: () => this.reloadAllViews(),
    });
    this.addCommand({
      id: "dokki-fix-page-format",
      name: "페이지 양식 정리 제안 (##### Np.)",
      editorCallback: (editor: Editor) => {
        const text = editor.getValue();
        const fixes = findPageFixes(text);
        if (!fixes.length) {
          new Notice("정리할 페이지 양식이 없습니다.");
          return;
        }
        new PageFixModal(this.app, fixes, () => {
          editor.setValue(applyPageFixes(text));
          new Notice(`페이지 마커 ${fixes.length}개를 정리했습니다.`);
        }).open();
      },
    });

    this.addSettingTab(new DokkiSettingTab(this.app, this));

    // Re-parse when vault changes
    const reloadDebounced = debounce(() => this.reloadAllViews(), 600);
    this.registerEvent(this.app.vault.on("modify", reloadDebounced));
    this.registerEvent(this.app.vault.on("create", reloadDebounced));
    this.registerEvent(this.app.vault.on("delete", reloadDebounced));
    this.registerEvent(this.app.vault.on("rename", reloadDebounced));
  }

  onunload() {}

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_DOKKI);
    if (existing.length) {
      leaf = existing[0];
    } else {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_DOKKI, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  private reloadAllViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DOKKI)) {
      const v = leaf.view as DokkiView;
      v.reload();
    }
  }
}

function debounce(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

// Preview the suggested page-marker fixes before applying them.
class PageFixModal extends Modal {
  constructor(
    app: App,
    private fixes: PageFix[],
    private onApply: () => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `페이지 양식 정리 제안 (${this.fixes.length}곳)` });
    contentEl.createEl("p", {
      text: "아래 줄을 DoKKi 표준 형식 “##### Np.” 로 바꿉니다.",
      cls: "dokki-fix-desc",
    });

    const list = contentEl.createDiv({ cls: "dokki-fix-list" });
    for (const f of this.fixes) {
      const row = list.createDiv({ cls: "dokki-fix-row" });
      row.createSpan({ cls: "dokki-fix-ln", text: `${f.line + 1}` });
      row.createSpan({ cls: "dokki-fix-from", text: f.from.trim() || "(빈 줄)" });
      row.createSpan({ cls: "dokki-fix-arrow", text: "→" });
      row.createSpan({ cls: "dokki-fix-to", text: f.to });
    }

    const buttons = contentEl.createDiv({ cls: "dokki-fix-buttons" });
    const cancel = buttons.createEl("button", { text: "취소" });
    cancel.addEventListener("click", () => this.close());
    const apply = buttons.createEl("button", { text: "적용", cls: "mod-cta" });
    apply.addEventListener("click", () => {
      this.onApply();
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class DokkiSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: DokkiPlugin) {
    super(app, plugin);
  }
  display() {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("노트 폴더")
      .setDesc("발췌 노트가 들어있는 vault 내 폴더 경로 (비우면 전체 vault 검색).")
      .addText((t) =>
        t
          .setPlaceholder("예: notes")
          .setValue(this.plugin.settings.notesFolder)
          .onChange(async (v) => {
            this.plugin.settings.notesFolder = v.trim();
            await this.plugin.saveSettings();
          }),
      );
  }
}
