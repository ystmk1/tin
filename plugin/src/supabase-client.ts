// Supabase client for the Obsidian plugin.
//
// Auth uses the PKCE OAuth flow with an `obsidian://dokki-auth` redirect, so
// the user signs in once in their browser and the session lands back in
// Obsidian via a custom-protocol callback.
//
// Tokens persist in plugin data (refresh_token survives across reloads;
// access_token is short-lived but auto-refreshed by the SDK).

import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { Notice } from "obsidian";

export interface SyncSession {
  access_token: string;
  refresh_token: string;
}

export interface SupabaseSettings {
  supabaseUrl: string;
  supabaseAnonKey: string;
  session: SyncSession | null;
}

export const DEFAULT_SUPABASE_SETTINGS: SupabaseSettings = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  session: null,
};

const REDIRECT = "obsidian://dokki-auth";

export class SupabaseService {
  private client: SupabaseClient | null = null;
  // Resolves once the stored session (if any) has been applied. Every API
  // method that needs an authenticated client awaits this — otherwise the
  // first call after a plugin reload races setSession() and reports "not
  // signed in" even though a valid refresh token is on disk.
  private ready: Promise<void> = Promise.resolve();

  constructor(
    private settings: SupabaseSettings,
    private onSettingsChanged: (s: SupabaseSettings) => Promise<void>,
  ) {}

  /** Lazily build the client when both URL and key are present. */
  getClient(): SupabaseClient | null {
    if (this.client) return this.client;
    const { supabaseUrl, supabaseAnonKey } = this.settings;
    if (!supabaseUrl || !supabaseAnonKey) return null;
    this.client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // PKCE — works through a custom protocol redirect because the token
        // lives in a `?code=...` query string, not a fragment that some
        // browsers strip when forwarding non-http schemes.
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false, // Obsidian environment, never reads window.location
      },
    });
    // Restore a stored session up front — but await it via `ready` so the
    // first sync call doesn't race the network round-trip.
    if (this.settings.session) {
      const c = this.client;
      this.ready = c.auth
        .setSession(this.settings.session)
        .then(() => {})
        .catch((e) => {
          console.warn("[DoKKi] setSession failed:", e);
        });
    }
    // Mirror every refresh back into plugin data so reloads find it.
    this.client.auth.onAuthStateChange((_evt, session) => {
      void this.persistSession(session);
    });
    return this.client;
  }

  /** Reset the client when the URL/key change. */
  invalidate(): void {
    this.client = null;
    this.ready = Promise.resolve();
  }

  async getUserId(): Promise<string | null> {
    const c = this.getClient();
    if (!c) return null;
    await this.ready;
    const { data } = await c.auth.getUser();
    return data.user?.id ?? null;
  }

  /** "user@example.com" when signed in, null otherwise. For settings display. */
  async signedInAs(): Promise<string | null> {
    const c = this.getClient();
    if (!c) return null;
    await this.ready;
    const { data } = await c.auth.getUser();
    return data.user?.email ?? data.user?.id ?? null;
  }

  /**
   * Fallback when OAuth via obsidian:// won't fire — paste the raw JSON value
   * of `sb-<project>-auth-token` from the web app's localStorage. We only need
   * the two tokens; everything else in that blob is reconstructable.
   */
  async setSessionFromJson(raw: string): Promise<void> {
    const c = this.getClient();
    if (!c) {
      new Notice("Supabase URL / anon key를 먼저 설정해 주세요.");
      return;
    }
    let access_token = "";
    let refresh_token = "";
    try {
      const parsed = JSON.parse(raw.trim());
      access_token = parsed.access_token ?? parsed.currentSession?.access_token ?? "";
      refresh_token = parsed.refresh_token ?? parsed.currentSession?.refresh_token ?? "";
    } catch {
      new Notice("붙여넣은 텍스트가 JSON이 아닙니다.");
      return;
    }
    if (!access_token || !refresh_token) {
      new Notice("access_token / refresh_token을 찾지 못했습니다.");
      return;
    }
    await this.setSessionManually({ access_token, refresh_token });
  }

  /** Begin OAuth by opening the provider in the user's default browser. */
  async signIn(provider: "google" | "kakao"): Promise<void> {
    const c = this.getClient();
    if (!c) {
      new Notice("Supabase URL / anon key를 먼저 설정해 주세요.");
      return;
    }
    const { data, error } = await c.auth.signInWithOAuth({
      provider,
      options: { redirectTo: REDIRECT, skipBrowserRedirect: true },
    });
    if (error || !data?.url) {
      new Notice(`로그인 시작 실패: ${error?.message ?? "unknown"}`);
      return;
    }
    // Obsidian's electron `shell.openExternal` is exposed as `window.open`
    // for http(s); use the platform-agnostic helper.
    window.open(data.url, "_blank");
    new Notice("브라우저에서 로그인을 완료하세요. 끝나면 Obsidian으로 돌아옵니다.");
  }

  /** Called by the obsidian:// protocol handler after Supabase redirects back. */
  async completeOAuth(code: string): Promise<void> {
    const c = this.getClient();
    if (!c) return;
    const { data, error } = await c.auth.exchangeCodeForSession(code);
    if (error) {
      new Notice(`로그인 교환 실패: ${error.message}`);
      return;
    }
    await this.persistSession(data.session);
    new Notice("tin 로그인 완료.");
  }

  async signOut(): Promise<void> {
    const c = this.getClient();
    if (c) await c.auth.signOut();
    await this.persistSession(null);
  }

  /** Manual paste path: drop a refresh+access token from the web app. */
  async setSessionManually(s: SyncSession): Promise<void> {
    const c = this.getClient();
    if (!c) {
      new Notice("Supabase URL / anon key를 먼저 설정해 주세요.");
      return;
    }
    const { error } = await c.auth.setSession(s);
    if (error) {
      new Notice(`세션 적용 실패: ${error.message}`);
      return;
    }
    await this.persistSession(s);
    new Notice("세션을 저장했습니다.");
  }

  private async persistSession(session: Session | SyncSession | null): Promise<void> {
    this.settings.session = session
      ? { access_token: session.access_token, refresh_token: session.refresh_token }
      : null;
    await this.onSettingsChanged(this.settings);
  }
}
