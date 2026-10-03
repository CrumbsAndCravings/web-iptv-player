// Starts Chromium for the tools that photograph pages (icons, screenshots): Playwright's
// own download, else the one CHROMIUM names (an installed Chrome or Chromium).
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

export async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (err) {
    const candidates = [process.env.CHROMIUM, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].filter(Boolean);
    for (const executablePath of candidates) if (existsSync(executablePath)) return chromium.launch({ executablePath });
    throw new Error("No Chromium to use. Run npx playwright install chromium, or set CHROMIUM to an installed Chrome.", { cause: err });
  }
}
