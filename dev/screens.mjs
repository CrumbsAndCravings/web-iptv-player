// Screenshots of each screen at iPhone size (390 x 844 points, 3x), from the dev harness
// with the fake helper and fake provider, into out/screens. Also a check: any error the
// page logs is printed, and the run fails if there were any.
//   npm run screens
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../tools/browser.mjs";

process.env.ARANPLUS_DEV_CODEC = process.env.ARANPLUS_DEV_CODEC || "vp9"; // the test browser has no H.264
process.env.MOCK_DELAY_MS = "30";
const { startDevServer } = await import("../tools/dev.mjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out", "screens");
mkdirSync(out, { recursive: true });
const port = 8123;
const server = await startDevServer({ port, watch: false });
const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function shot(name) {
  await wait(400);
  await page.screenshot({ path: path.join(out, name + ".png") });
  console.log("shot", name);
}

await page.goto(`http://localhost:${port}/`);
// The intro plays while the app opens, and flies into Home once its first row is in.
await page.waitForSelector(".intro.is-playing");
await wait(1200);
await shot("00-intro");
await page.waitForSelector(".intro", { state: "detached", timeout: 8000 });
await page.waitForSelector(".row .poster:not(.is-placeholder)", { timeout: 15000 });
await wait(800);
await shot("01-home");
await page.evaluate(() => document.querySelector(".view.is-active")?.scrollBy(0, 700));
await shot("02-home-rows");

await page.click(".tab:nth-child(2)");
await page.waitForSelector(".view.browse-movie.is-active .row .poster:not(.is-placeholder)");
await shot("03-movies");

await page.click(".tab:nth-child(4)");
await page.waitForSelector(".category-grid .poster");
await wait(1500);
await shot("04-categories");

await page.click(".tab:nth-child(5)");
await page.fill(".view.search .search-field", "the");
await wait(2500);
await shot("05-search");

await page.click(".tab:nth-child(1)");
await page.click(".view.browse-home .row:not(.is-continue) .poster:not(.is-see-all)");
await page.waitForSelector(".details-title");
await wait(1000);
await shot("06-details-movie");
await page.click(".details-back");
await wait(400);

await page.click(".tab:nth-child(3)");
await page.waitForSelector(".view.browse-series.is-active .row .poster:not(.is-placeholder)");
await page.click(".view.browse-series.is-active .row .poster:not(.is-see-all)");
await page.waitForSelector(".episode");
await wait(800);
await shot("07-details-series");
await page.evaluate(() => document.querySelector(".details-scroll")?.scrollBy(0, 500));
await shot("08-episodes");

// An episode plays through the (fake) helper.
await page.click(".episode");
await page.waitForSelector(".player");
await page
  .waitForFunction(() => {
    const v = document.querySelector(".player-video");
    return v && v.currentTime > 2;
  }, null, { timeout: 40000 })
  .then(
    () => console.log("the video plays"),
    () => console.log("the video didn't get going"),
  );
// The controls show on a tap of the picture (not on the play button in its middle).
if (!(await page.$(".player.controls-shown"))) await page.mouse.click(60, 300);
await shot("09-player");
console.log("player:", await page.evaluate(() => {
  const v = document.querySelector(".player-video");
  return { time: v.currentTime, paused: v.paused, error: v.error && v.error.code, bar: document.querySelector(".player-time")?.textContent, rest: document.querySelector(".player-time.is-right")?.textContent };
}));
await page.click(".player-tool:first-child");
await wait(600);
await shot("10-player-tracks");
await page.click(".player-panel .round-button");
await page.click(".player-top .round-button");
await wait(600);
await page.click(".details-back");
await wait(500);

await page.click(".tab:nth-child(1)");
await wait(800);
await shot("11-home-continue");
await page.click(".header-account");
await page.waitForSelector(".settings");
await shot("12-settings");

console.log(errors.length ? "Errors in the page:\n" + errors.join("\n") : "No errors in the page.");
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
