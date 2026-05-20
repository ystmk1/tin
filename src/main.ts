import "./dom-polyfill";
import "./styles.css";
import { loadBooks } from "./notes";
import { mountWebView } from "./view-web";
import { initAuth } from "./auth";
import { initMetadata } from "./note-metadata";

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

const books = loadBooks();

// Resolve any existing session, then load metadata from the right backend
// (cloud if signed in, else localStorage). The view also re-inits metadata
// on later auth changes. We don't block the first paint on the network —
// the view mounts immediately and refreshes when metadata resolves.
void bootstrap();

async function bootstrap() {
  // 1) Load whatever's cached locally so the first paint is instant.
  await initMetadata();
  // 2) Mount the UI (this registers the auth-change listener).
  mountWebView({ books, mount: app! });
  dismissSplash();
  // 3) Resolve the session. If signed in, the view's auth listener
  //    re-runs initMetadata against the cloud and refreshes the panel.
  await initAuth();
}

function dismissSplash(): void {
  const splash = document.getElementById("dokki-splash");
  if (!splash) return;
  // If the inline head script already marked us as a returning visitor,
  // the splash is display:none — bail out (and clean the node).
  if (document.documentElement.classList.contains("dokki-no-splash")) {
    splash.remove();
    return;
  }
  // First-time visitor: hold long enough to read the quote, then fade out
  // and persist the flag so subsequent visits skip it entirely.
  const MIN_DWELL_MS = 1800;
  setTimeout(() => {
    splash.classList.add("is-leaving");
    const onEnd = () => splash.remove();
    splash.addEventListener("transitionend", onEnd, { once: true });
    // Safety: if transitionend never fires (rare), force-remove
    setTimeout(onEnd, 1500);
    try {
      localStorage.setItem("dokki:seen-splash:v1", "1");
    } catch {
      /* storage disabled — ok, splash just stays for this session */
    }
  }, MIN_DWELL_MS);
}
