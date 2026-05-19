import { Plugin, WorkspaceLeaf, PluginSettingTab, Setting, App } from "obsidian";
import { DokkiView, VIEW_TYPE_DOKKI } from "./view";

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
