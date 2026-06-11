// A stand-in for the "AI metaphor object" in the spec. Until real generated
// art exists, each book gets a deterministic, minimal geometric composition
// seeded from its id — so the same book always yields the same object, and
// different books look distinct. Matte, print-like, two-colour.

import type { Palette } from "./palette";

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Tiny deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns an inline SVG string on a 100×100 viewBox. `solid` paints the object
 * as a filled silhouette (the spec's clean "누끼" cut-out for the grid view);
 * otherwise shapes are stroked/filled in a looser composition.
 */
export function generativeObject(
  seed: string,
  palette: Palette,
  opts: { solid?: boolean } = {},
): string {
  const r = rng(hashString(seed));
  const fill = opts.solid ? palette.contrast : palette.accent;
  const stroke = palette.contrast;
  const pick = <T>(arr: T[]): T => arr[Math.floor(r() * arr.length)];

  const parts: string[] = [];
  const variant = Math.floor(r() * 4);

  // A large primary form, always centred-ish, that reads as the silhouette.
  const cx = 50 + (r() - 0.5) * 14;
  const cy = 50 + (r() - 0.5) * 14;
  if (variant === 0) {
    const rad = 26 + r() * 10;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${fill}"/>`);
    // a slim crescent bite
    parts.push(
      `<circle cx="${cx + rad * 0.5}" cy="${cy - rad * 0.4}" r="${rad * 0.8}" fill="${palette.key}"/>`,
    );
  } else if (variant === 1) {
    const w = 34 + r() * 16;
    const h = 34 + r() * 24;
    parts.push(
      `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${pick([0, 0, 2, w / 2])}" fill="${fill}"/>`,
    );
    parts.push(
      `<line x1="${cx - w / 2}" y1="${cy}" x2="${cx + w / 2}" y2="${cy}" stroke="${palette.key}" stroke-width="${1 + r() * 3}"/>`,
    );
  } else if (variant === 2) {
    // a quarter-arc sweep
    const rad = 30 + r() * 12;
    const a0 = r() * Math.PI * 2;
    const a1 = a0 + Math.PI * (0.6 + r() * 0.7);
    const x0 = cx + rad * Math.cos(a0);
    const y0 = cy + rad * Math.sin(a0);
    const x1 = cx + rad * Math.cos(a1);
    const y1 = cy + rad * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    parts.push(
      `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${rad} ${rad} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${fill}" stroke-width="${7 + r() * 7}" stroke-linecap="${pick(["butt", "round"])}"/>`,
    );
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${3 + r() * 4}" fill="${stroke}"/>`);
  } else {
    // a triangle wedge
    const s = 30 + r() * 14;
    const rot = r() * 360;
    const pts = [0, 120, 240]
      .map((d) => {
        const a = ((d + rot) * Math.PI) / 180;
        return `${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`;
      })
      .join(" ");
    parts.push(`<polygon points="${pts}" fill="${fill}"/>`);
  }

  // One or two thin satellite marks for tension — skipped in solid mode to
  // keep the silhouette clean.
  if (!opts.solid) {
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const t = pick(["dot", "bar", "ring"]);
      const x = 12 + r() * 76;
      const y = 12 + r() * 76;
      if (t === "dot") parts.push(`<circle cx="${x}" cy="${y}" r="${2 + r() * 3}" fill="${stroke}"/>`);
      else if (t === "ring")
        parts.push(`<circle cx="${x}" cy="${y}" r="${5 + r() * 5}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`);
      else
        parts.push(
          `<line x1="${x}" y1="${y}" x2="${x + (r() - 0.5) * 30}" y2="${y + (r() - 0.5) * 30}" stroke="${stroke}" stroke-width="1.5"/>`,
        );
    }
  }

  return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${parts.join("")}</svg>`;
}
