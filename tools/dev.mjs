// Dev harness: rebuilds on save and serves the app at http://localhost:8080/app/, the way
// the helper does, with a fake helper (dev/fake-helper.mjs) in front of the fake Xtream
// server (dev/mock-xtream.mjs). No real provider, login or helper is ever needed.
// Open http://localhost:8080/ in a browser, or on a phone on the same Wi-Fi at this
// computer's address. Make the sample videos once with npm run sample.
import * as esbuild from "esbuild";
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleFakeHelper, FAKE_KEY } from "../dev/fake-helper.mjs";
import { handleMockOs } from "../dev/mock-opensubtitles.mjs";
import { handleMock } from "../dev/mock-xtream.mjs";
import { copyStatic, dist, esbuildOptions } from "./build.mjs";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

function serveApp(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/" || url.pathname === "/app") {
    res.writeHead(302, { Location: "/app/?key=" + FAKE_KEY });
    res.end();
    return;
  }
  if (!url.pathname.startsWith("/app/")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const relative = decodeURIComponent(url.pathname.slice(5)) || "index.html";
  const file = path.resolve(dist, relative);
  if (!file.startsWith(dist + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(file).pipe(res);
}

// Builds once (and keeps rebuilding when `watch`), then serves the app, the fake helper
// and the fake servers. Resolves with the running server.
export async function startDevServer({ port = Number(process.env.PORT || 8080), watch = true } = {}) {
  const ctx = await esbuild.context(esbuildOptions({ dev: true }));
  await ctx.rebuild();
  copyStatic();
  if (watch) await ctx.watch();
  else await ctx.dispose();
  const server = http.createServer((req, res) => {
    if (handleFakeHelper(req, res, port)) return;
    if (handleMock(req, res) || handleMockOs(req, res)) return;
    serveApp(req, res);
  });
  await new Promise((resolve) => server.listen(port, resolve));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  await startDevServer({ port });
  console.log(`ARAN+ dev harness on http://localhost:${port}/ (try a phone-sized window)`);
  console.log("The fake helper plays dev/media/sample.* (npm run sample makes them).");
}
