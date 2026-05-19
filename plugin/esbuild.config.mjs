import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";

const banner = `/* DoKKi — built ${new Date().toISOString()} */`;

const deployPlugin = {
  name: "deploy-to-vault",
  setup(build) {
    build.onEnd(async () => {
      const target = process.env.DOKKI_VAULT;
      if (!target) return;
      const dest = path.join(target, ".obsidian", "plugins", "dokki");
      try {
        fs.mkdirSync(dest, { recursive: true });
        for (const f of ["main.js", "manifest.json", "styles.css"]) {
          if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dest, f));
        }
        console.log(`→ deployed to ${dest}`);
      } catch (e) {
        console.warn("deploy skipped:", e.message);
      }
    });
  },
};

const ctx = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
  plugins: [deployPlugin],
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
