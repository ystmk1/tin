// Color architecture for the curation view.
//
// A book's cover yields one "dominant" colour. We never use it raw — it is
// toned down to a matte, low-saturation "tin" colour so any cover sits on the
// printed-catalog surface without screaming. From that key colour we derive a
// contrasting ink (black or white) and a second, complementary accent.

export interface Palette {
  /** Matte, toned-down dominant colour. The page's key colour. */
  key: string;
  /** Black or white — whichever reads cleanly on `key`. */
  contrast: string;
  /** A second matte point colour (complementary-ish hue). */
  accent: string;
  /** True when `key` is dark enough that white type sits on top of it. */
  keyIsDark: boolean;
}

interface HSL {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function hexToHsl(hex: string): HSL {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: hue, s, l };
}

export function hslToHex({ h, s, l }: HSL): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Relative luminance (WCAG-ish) used only for black/white contrast choice. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * Pull any colour into the matte-tin register: cap saturation, keep lightness
 * in a printable mid-band. A screaming yellow becomes a mustard; a hot pink
 * becomes an indie rose.
 */
export function toMatteTin(hex: string): string {
  const hsl = hexToHsl(hex);
  return hslToHex({
    h: hsl.h,
    s: clamp(hsl.s, 0.12, 0.34),
    l: clamp(hsl.l, 0.42, 0.66),
  });
}

export function buildPalette(coverHex: string): Palette {
  const key = toMatteTin(coverHex);
  const keyIsDark = luminance(key) < 0.42;
  const contrast = keyIsDark ? "#F4F4F2" : "#1A1A1A";
  const base = hexToHsl(key);
  const accent = hslToHex({
    h: (base.h + 168) % 360,
    s: clamp(base.s + 0.04, 0.14, 0.36),
    l: clamp(keyIsDark ? base.l + 0.18 : base.l - 0.2, 0.3, 0.72),
  });
  return { key, contrast, accent, keyIsDark };
}
