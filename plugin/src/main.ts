import {
  Plugin,
  PluginSettingTab,
  Setting,
  App,
  Modal,
  Notice,
  Editor,
} from "obsidian";
import { findPageFixes, applyPageFixes, type PageFix } from "./format";
import {
  SupabaseService,
  DEFAULT_SUPABASE_SETTINGS,
  type SupabaseSettings,
} from "./supabase-client";
import { runSync, showSyncResult, type SyncHashes } from "./sync";

interface DokkiSettings extends SupabaseSettings {
  notesFolder: string;
  /** Files inside this folder are uploaded as 조각글 (is_fragment = true). */
  fragmentFolder: string;
  /** Mirror local deletions to the cloud. Off by default — safer. */
  deleteRemoved: boolean;
  /** Per-filename SHA-256 of the last successfully uploaded content. */
  syncHashes: SyncHashes;
}

const DEFAULT_SETTINGS: DokkiSettings = {
  ...DEFAULT_SUPABASE_SETTINGS,
  notesFolder: "",
  fragmentFolder: "",
  deleteRemoved: false,
  syncHashes: {},
};

export default class DokkiPlugin extends Plugin {
  settings!: DokkiSettings;
  supabase!: SupabaseService;

  async onload() {
    await this.loadSettings();
    this.supabase = new SupabaseService(this.settings, async (s) => {
      Object.assign(this.settings, s);
      await this.saveSettings();
    });

    // OAuth callback — Supabase redirects the browser to obsidian://dokki-auth?code=…
    this.registerObsidianProtocolHandler("dokki-auth", (params) => {
      const code = params.code;
      if (!code) {
        new Notice("로그인 콜백에 code가 없습니다.");
        return;
      }
      void this.supabase.completeOAuth(code);
    });

    // Ribbon = quick sync (the in-Obsidian explorer view has been retired —
    // the canonical viewer is the DoKKi web app).
    this.addRibbonIcon("refresh-cw", "DoKKi 동기화", () => void this.syncNow());
    this.addCommand({
      id: "dokki-sync",
      name: "DoKKi 동기화 (변경된 노트만 업로드)",
      callback: () => void this.syncNow(),
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
  }

  onunload() {}

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async syncNow(): Promise<void> {
    const client = this.supabase.getClient();
    if (!client) {
      new Notice("Supabase URL / anon key를 먼저 설정해 주세요.");
      return;
    }
    const userId = await this.supabase.getUserId();
    if (!userId) {
      new Notice("로그인이 필요합니다. 설정 → DoKKi 에서 로그인하세요.");
      return;
    }
    new Notice("DoKKi 동기화 중…");
    const result = await runSync(this.app, client, userId, this.settings.syncHashes, {
      folder: this.settings.notesFolder,
      fragmentFolder: this.settings.fragmentFolder,
      deleteRemoved: this.settings.deleteRemoved,
    });
    this.settings.syncHashes = result.newHashes;
    await this.saveSettings();
    showSyncResult(result);
  }
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
    const c = this.containerEl;
    c.empty();

    new Setting(c)
      .setName("책 폴더")
      .setDesc(
        "책 노트가 들어있는 폴더 (예: 완독). 이 폴더 아래 .md는 책 스택에 업로드됩니다. 비우면 조각 폴더를 뺀 vault 전체가 책으로 취급됩니다.",
      )
      .addText((t) =>
        t
          .setPlaceholder("예: 완독")
          .setValue(this.plugin.settings.notesFolder)
          .onChange(async (v) => {
            this.plugin.settings.notesFolder = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(c)
      .setName("조각 폴더")
      .setDesc(
        "조각글(짧은 비문학 발췌) 폴더 (예: 조각). 이 폴더 아래 .md는 책이 아니라 조각글로 업로드되어 웹에서 책 스택 아래 별도 단에 표시됩니다. 비우면 조각 분류 사용 안 함.",
      )
      .addText((t) =>
        t
          .setPlaceholder("예: 조각")
          .setValue(this.plugin.settings.fragmentFolder)
          .onChange(async (v) => {
            this.plugin.settings.fragmentFolder = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    c.createEl("h3", { text: "클라우드 동기화" });
    c.createEl("p", {
      text: "Supabase 프로젝트의 URL과 anon key를 입력하고 로그인하면, 변경된 노트만 클라우드(notes 테이블)에 업로드합니다.",
      cls: "setting-item-description",
    });

    new Setting(c)
      .setName("Supabase URL")
      .addText((t) =>
        t
          .setPlaceholder("https://xxxxx.supabase.co")
          .setValue(this.plugin.settings.supabaseUrl)
          .onChange(async (v) => {
            this.plugin.settings.supabaseUrl = v.trim();
            this.plugin.supabase.invalidate();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(c)
      .setName("Supabase anon key")
      .addText((t) =>
        t
          .setPlaceholder("ey…")
          .setValue(this.plugin.settings.supabaseAnonKey)
          .onChange(async (v) => {
            this.plugin.settings.supabaseAnonKey = v.trim();
            this.plugin.supabase.invalidate();
            await this.plugin.saveSettings();
          }),
      );

    // Live status — readers can tell at a glance whether the plugin actually
    // has a usable session.
    const status = c.createDiv({ cls: "setting-item-description" });
    status.style.padding = "4px 0 12px";
    const refreshStatus = async () => {
      const who = await this.plugin.supabase.signedInAs();
      status.setText(who ? `로그인됨: ${who}` : "현재 로그아웃 상태");
      status.style.color = who ? "var(--text-success, #4caf50)" : "var(--text-muted)";
    };
    void refreshStatus();

    new Setting(c)
      .setName("로그인 (OAuth)")
      .setDesc(
        "브라우저에서 로그인을 마치면 obsidian://dokki-auth 콜백으로 자동 복귀합니다. ① Supabase Dashboard → Authentication → URL Configuration → Redirect URLs에 'obsidian://dokki-auth'를 먼저 등록해야 합니다. ② 콜백이 안 잡히면 아래 '세션 붙여넣기'로 우회.",
      )
      .addButton((b) =>
        b.setButtonText("Google").onClick(() => void this.plugin.supabase.signIn("google")),
      )
      .addButton((b) =>
        b.setButtonText("Kakao").onClick(() => void this.plugin.supabase.signIn("kakao")),
      )
      .addButton((b) =>
        b.setButtonText("상태 새로고침").onClick(() => void refreshStatus()),
      )
      .addButton((b) =>
        b.setButtonText("로그아웃").onClick(async () => {
          await this.plugin.supabase.signOut();
          await refreshStatus();
          new Notice("로그아웃했습니다.");
        }),
      );

    // Paste-session fallback: copy the `sb-<project>-auth-token` value from
    // the web app's localStorage and drop it here. Bypasses OAuth entirely.
    let pasted = "";
    new Setting(c)
      .setName("세션 붙여넣기 (OAuth 우회)")
      .setDesc(
        "웹 DoKKi에서 로그인 → 개발자 도구 → Application → Local Storage → 'sb-...-auth-token' 값(JSON)을 복사해 붙여넣고 [적용].",
      )
      .addTextArea((t) => {
        t.inputEl.rows = 3;
        t.inputEl.style.width = "100%";
        t.setPlaceholder('{"access_token":"…","refresh_token":"…",…}');
        t.onChange((v) => (pasted = v));
      })
      .addButton((b) =>
        b.setButtonText("적용").onClick(async () => {
          await this.plugin.supabase.setSessionFromJson(pasted);
          await refreshStatus();
        }),
      );

    new Setting(c)
      .setName("vault에서 삭제된 노트는 클라우드에서도 삭제")
      .setDesc(
        "끄면(기본) 클라우드에는 그대로 남습니다. 켜기 전에 vault에 모든 노트가 있는지 확인하세요 — 실수로 켜면 클라우드 노트가 사라질 수 있습니다.",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.deleteRemoved).onChange(async (v) => {
          this.plugin.settings.deleteRemoved = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(c)
      .setName("지금 동기화")
      .setDesc("변경된 노트만 한 번에 업로드합니다.")
      .addButton((b) =>
        b
          .setButtonText("동기화")
          .setCta()
          .onClick(() => void this.plugin.syncNow()),
      );

    new Setting(c)
      .setName("해시 캐시 초기화")
      .setDesc("다음 동기화에서 모든 노트를 다시 업로드합니다(전체 재업로드용).")
      .addButton((b) =>
        b.setButtonText("초기화").onClick(async () => {
          this.plugin.settings.syncHashes = {};
          await this.plugin.saveSettings();
          new Notice("해시 캐시를 비웠습니다.");
        }),
      );
  }
}
