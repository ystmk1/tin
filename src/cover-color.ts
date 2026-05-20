// Extract a representative tint color from a book cover.
// The image is loaded through /api/img-proxy (adds CORS headers) so the
// canvas isn't tainted and we can read pixels. Returns an "r,g,b" string
// or null on failure. Called once when a cover is first linked; the result
// is cached in note metadata so it never recomputes.

export function extractCoverColor(coverUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const w = 24;
        const h = Math.max(1, Math.round((img.height / img.width) * w)) || 36;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 200) continue; // skip transparent
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
        if (!n) return resolve(null);
        resolve(`${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)}`);
      } catch {
        resolve(null); // tainted canvas / decode error — no tint
      }
    };
    img.onerror = () => resolve(null);
    img.src = `/api/img-proxy?url=${encodeURIComponent(coverUrl)}`;
  });
}
