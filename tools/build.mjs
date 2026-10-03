// Bundles the app into dist/, which the helper on your computer serves at /app/.
//   node tools/build.mjs          production bundle
//   import { ... } for the dev server (tools/dev.mjs)
import * as esbuild from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dist = path.join(root, "dist");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

export function esbuildOptions({ dev = false } = {}) {
  return {
    absWorkingDir: root,
    entryPoints: { app: "src/main.ts" },
    bundle: true,
    outdir: "dist",
    // ES modules, so hls.js (only for browsers without HLS of their own, never an
    // iPhone) is a separate file loaded when needed.
    format: "esm",
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    target: ["es2021", "safari16"],
    loader: { ".ttf": "file", ".png": "file", ".svg": "file" },
    assetNames: "assets/[name]-[hash]",
    define: { __APP_VERSION__: JSON.stringify(pkg.version), __DEV__: String(dev) },
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    logLevel: "info",
  };
}

export function copyStatic() {
  mkdirSync(path.join(dist, "icons"), { recursive: true });
  for (const file of ["index.html", "manifest.webmanifest", "THIRD_PARTY_NOTICES.txt"]) copyFileSync(path.join(root, file), path.join(dist, file));
  const icons = path.join(root, "assets", "icons");
  if (existsSync(icons)) for (const file of readdirSync(icons)) copyFileSync(path.join(icons, file), path.join(dist, "icons", file));
  for (const file of ["OFL-Fredoka.txt", "OFL-Nunito.txt"]) copyFileSync(path.join(root, "assets", "fonts", file), path.join(dist, file));
}

export async function build({ dev = false } = {}) {
  rmSync(dist, { recursive: true, force: true });
  await esbuild.build(esbuildOptions({ dev }));
  copyStatic();
  writeFileSync(path.join(dist, "build.txt"), `ARAN+ for iPhone ${pkg.version} built ${new Date().toISOString()}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
