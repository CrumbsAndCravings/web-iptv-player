// The Home Screen icons (assets/icons), drawn as HTML and photographed with Chromium
// (playwright-core): the ARAN+ "A+" in Fredoka on night plum with soft lavender and
// pink glows, like the TV apps' artwork. Run after changing the design: npm run icons.
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./browser.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "assets", "icons");
mkdirSync(out, { recursive: true });
// Inline, since a page set from a string can't load files.
const font = "data:font/ttf;base64," + readFileSync(path.join(root, "assets", "fonts", "Fredoka-SemiBold.ttf")).toString("base64");

function page(size, inset) {
  return `<!doctype html><html><head><style>
@font-face { font-family: Fredoka; src: url("${font}"); font-weight: 600; }
html, body { margin: 0; width: ${size}px; height: ${size}px; overflow: hidden; }
body { background: #151028; position: relative; }
.glow { position: absolute; border-radius: 50%; filter: blur(${size * 0.09}px); opacity: 0.55; }
.lav { width: 70%; height: 70%; left: -12%; top: -14%; background: #8f78e8; }
.pink { width: 62%; height: 62%; right: -16%; bottom: -18%; background: #ff7fbf; opacity: 0.45; }
.mark { position: absolute; inset: ${inset}px; display: flex; align-items: center; justify-content: center;
  font-family: Fredoka; font-weight: 600; font-size: ${(size - inset * 2) * 0.62}px; color: #f7f3ff; letter-spacing: -0.02em; }
.plus { color: #ff9ecf; margin-left: 0.02em; }
</style></head><body><div class="glow lav"></div><div class="glow pink"></div><div class="mark"><span>A</span><span class="plus">+</span></div></body></html>`;
}

const browser = await launchChromium();
const tab = await browser.newPage();
// Maskable icons keep their mark inside the middle 80 %.
for (const [name, size, inset] of [
  ["apple-touch-icon.png", 180, 18],
  ["icon-192.png", 192, 24],
  ["icon-512.png", 512, 64],
]) {
  await tab.setViewportSize({ width: size, height: size });
  await tab.setContent(page(size, inset));
  await tab.evaluate(() => document.fonts.load("600 40px Fredoka").then(() => document.fonts.ready));
  await tab.screenshot({ path: path.join(out, name) });
  console.log("made", name);
}
await browser.close();
