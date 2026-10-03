// A fake helper for the dev harness (npm run dev): the real helper's endpoints
// (helper/aranplus-helper.mjs in the Samsung repo), backed by the fake Xtream server in
// mock-xtream.mjs, so the app can be built and tried without a provider, a login or the
// Samsung repo. The key is "dev".
//
// HLS is made from dev/media/sample.<ext> (npm run sample) with FFmpeg when it is
// installed: H.264 and AAC, as the real helper keeps or makes them for an iPhone, or
// VP9 and Opus with ARANPLUS_DEV_CODEC=vp9, for test browsers without H.264 (the
// Chromium that npm run screens uses). Like the real helper, it starts from `start`
// seconds, writes the file's own subtitles as WebVTT, and answers once two pieces are
// ready. With vod=1 (as the app asks), it lists the whole sample in six-second pieces
// as the real helper does, converting it from the start and answering each piece once
// it's made (the real one starts FFmpeg again for a jump; a sample is quick enough).

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleMock, playerApi } from "./mock-xtream.mjs";

export const FAKE_KEY = "dev";

const here = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.join(here, "media");
const OUT = path.join(here, "..", "out", "dev-hls");
const VP9 = process.env.ARANPLUS_DEV_CODEC === "vp9";
const sessions = new Map();
let running = null;

function json(res, code, body, helperError = false) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (helperError) headers["X-ARANplus-Helper"] = "error";
  res.writeHead(code, headers);
  res.end(JSON.stringify(body));
}

function sample(ext) {
  for (const name of ["sample." + ext, "sample.mp4"]) {
    const file = path.join(MEDIA, name);
    if (existsSync(file)) return file;
  }
  return null;
}

// What `ffmpeg -i` says about a sample: its length, sound tracks and subtitle tracks.
function probe(file) {
  const text = spawnSync("ffmpeg", ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr || "";
  const d = /Duration:\s*(\d+):(\d+):(\d+)/.exec(text);
  const out = { duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0, video: "", audio: [], subtitles: [] };
  for (const line of text.split("\n")) {
    const m = /Stream #0:\d+(?:\[[^\]]*\])?(?:\(([a-z]{2,3})\))?[^:]*:\s*(Video|Audio|Subtitle):\s*([a-z0-9_]+)/i.exec(line);
    if (!m) continue;
    if (m[2] === "Video" && !out.video) out.video = m[3];
    else if (m[2] === "Audio") out.audio.push({ codec: m[3], channels: /5\.1/.test(line) ? 6 : 2, language: m[1] || "", title: "" });
    else if (m[2] === "Subtitle") out.subtitles.push({ codec: m[3], language: m[1] || "" });
  }
  return out;
}

function stopRunning() {
  if (running) running.kill();
  running = null;
}

// The whole sample's playlist, in six-second pieces, starting at `from`.
function vodPlaylist(session) {
  const count = Math.max(1, Math.ceil(session.duration / 6));
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-TARGETDURATION:6", "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-INDEPENDENT-SEGMENTS"];
  if (session.from > 0) lines.push("#EXT-X-START:TIME-OFFSET=" + session.from + ",PRECISE=YES");
  lines.push('#EXT-X-MAP:URI="init.mp4"');
  for (let n = 0; n < count; n++) lines.push("#EXTINF:" + (n < count - 1 ? 6 : session.duration - 6 * (count - 1)).toFixed(3) + ",", "seg" + String(n).padStart(5, "0") + ".m4s");
  lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}

async function startHls(params) {
  const ext = (params.get("ext") || "mp4").toLowerCase();
  const file = sample(ext);
  if (!file) throw new Error("No sample video. Run npm run sample (it needs FFmpeg).");
  const info = probe(file);
  const start = Math.max(0, Math.floor(Number(params.get("start")) || 0));
  let track = params.has("a") ? Number(params.get("a")) || 0 : 0;
  const alang = params.get("alang") || "";
  if (!params.has("a") && alang) track = Math.max(0, info.audio.findIndex((a) => a.language === alang));
  if (track >= info.audio.length) track = 0;
  stopRunning();
  const id = randomBytes(16).toString("hex");
  const dir = path.join(OUT, id);
  mkdirSync(dir, { recursive: true });
  const video = VP9 ? ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "800k", "-vf", "scale=-2:360", "-g", "48"] : ["-c:v", "libx264", "-preset", "veryfast", "-g", "48", "-pix_fmt", "yuv420p"];
  const audio = VP9 ? ["-c:a", "libopus", "-b:a", "96k", "-ac", "2"] : ["-c:a", "aac", "-b:a", "128k", "-ac", "2"];
  const vod = params.get("vod") === "1" && info.duration > 0;
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error"];
  if (start > 0 && !vod) args.push("-ss", String(start));
  args.push("-i", file, "-map", "0:V:0?", "-map", "0:a:" + track + "?", ...video, ...audio, "-sn", "-dn");
  // A keyframe every six seconds, so every piece is six seconds, as the playlist says.
  if (vod) args.push("-force_key_frames", "expr:gte(t,n_forced*6)");
  args.push("-f", "hls", "-hls_time", "6", "-hls_list_size", "0", "-hls_playlist_type", "event", "-hls_flags", "independent_segments+temp_file");
  args.push("-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4", "-hls_segment_filename", path.join(dir, "seg%05d.m4s"), path.join(dir, "index.m3u8"));
  info.subtitles.forEach((sub, n) => args.push("-map", "0:s:" + n, "-c:s", "webvtt", "-flush_packets", "1", "-f", "webvtt", path.join(dir, "sub" + n + ".vtt")));
  // A picture of each six-second piece, for dragging the bar, as the real helper makes.
  if (vod) args.push("-map", "0:V:0", "-vf", "fps=1/6,scale=-2:180", "-q:v", "5", "-f", "image2", "-frame_pts", "1", path.join(dir, "p%05d.jpg"));
  const child = spawn("ffmpeg", args);
  running = child;
  let stderr = "";
  child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
  const session = { id, dir, ended: false, vod, from: vod ? start : 0, duration: info.duration };
  sessions.set(id, session);
  child.on("close", () => {
    session.ended = true;
    if (running === child) running = null;
  });
  child.on("error", () => (session.ended = true));
  const deadline = Date.now() + 30000;
  for (;;) {
    let text;
    try {
      text = readFileSync(path.join(dir, "index.m3u8"), "utf8");
    } catch {
      text = "";
    }
    const pieces = (text.match(/^#EXTINF:/gm) || []).length;
    const wanted = vod ? Math.floor(start / 6) + 1 : 2;
    if (pieces >= wanted || (pieces > 0 && /#EXT-X-ENDLIST/.test(text))) break;
    if (session.ended || Date.now() > deadline) throw new Error("FFmpeg didn't make the first pieces: " + (stderr.trim() || "no reason given"));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const base = "/v1/hls/s/" + id + "/";
  return {
    session: id,
    url: base + "index.m3u8",
    vod,
    from: vod ? start : 0,
    start: vod ? 0 : start,
    duration: info.duration,
    video: params.get("video") === "convert" ? "convert" : "copy",
    videoCodec: info.video,
    audioTrack: track,
    audioPlan: info.audio[track] && info.audio[track].codec === "aac" ? "copy" : "aac",
    audio: info.audio,
    subtitles: info.subtitles.map((s, n) => ({ index: n, language: s.language, title: "", forced: false, url: base + "sub" + n + ".vtt" })),
    previews: vod ? { every: 6, prefix: base + "p" } : null,
  };
}

async function serveSessionFile(res, id, name) {
  const session = sessions.get(id);
  if (!session || !/^(index\.m3u8|init\.mp4|seg\d{5}\.m4s|sub\d\.vtt|p\d{5}\.jpg)$/.test(name)) return json(res, 404, { error: "That stream has ended." });
  const file = path.join(session.dir, name);
  if (name.endsWith(".jpg")) {
    if (!existsSync(file)) return json(res, 404, { error: "Not converted yet." });
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": statSync(file).size, "Cache-Control": "private, max-age=86400" });
    return createReadStream(file).pipe(res);
  }
  if (session.vod && name === "index.m3u8") {
    res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" });
    return res.end(vodPlaylist(session));
  }
  // A piece not made yet is waited for.
  for (let i = 0; session.vod && i < 240 && !existsSync(file) && !session.ended && !name.endsWith(".vtt"); i++) await new Promise((resolve) => setTimeout(resolve, 250));
  if (name.endsWith(".vtt") && !existsSync(file)) {
    res.writeHead(200, { "Content-Type": "text/vtt" });
    return res.end("WEBVTT\n\n");
  }
  if (!existsSync(file)) return json(res, 404, { error: "No such piece." });
  if (name === "index.m3u8") {
    res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" });
    return res.end(readFileSync(file, "utf8").replace(/^#EXTM3U\n/, "#EXTM3U\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES\n"));
  }
  const types = { mp4: "video/mp4", m4s: "video/iso.segment", vtt: "text/vtt" };
  res.writeHead(200, { "Content-Type": types[name.split(".").pop()], "Content-Length": statSync(file).size, "Cache-Control": "no-store" });
  createReadStream(file).pipe(res);
}

// Handles a request if it belongs to the fake helper; returns false otherwise.
export function handleFakeHelper(req, res, port) {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith("/v1/")) return false;
  const piece = /^\/v1\/hls\/s\/([0-9a-f]{32})\/([^/]+)$/.exec(url.pathname);
  if (piece) {
    serveSessionFile(res, piece[1], piece[2]).catch(() => res.destroy());
    return true;
  }
  if (url.searchParams.get("key") !== FAKE_KEY) {
    json(res, 401, { error: "Wrong or missing key." }, true);
    return true;
  }
  const p = url.searchParams;
  switch (url.pathname) {
    case "/v1/app":
      json(res, 200, {
        ok: true,
        service: "aranplus-helper",
        version: "dev",
        encoder: "libx264",
        account: { server: "http://localhost:" + port, username: "demo" },
        languages: (process.env.ARANPLUS_LANGUAGES || "en,hi,pa").split(",").filter(Boolean),
        sync: null,
      });
      return true;
    case "/v1/xtream": {
      const params = new URLSearchParams({ username: "demo", password: "demo" });
      for (const name of ["action", "category_id", "vod_id", "series_id"]) if (p.get(name)) params.set(name, p.get(name));
      setTimeout(() => json(res, 200, playerApi(params)), Number(process.env.MOCK_DELAY_MS || 120));
      return true;
    }
    case "/v1/hls/start":
      startHls(p).then(
        (started) => json(res, 200, started),
        (err) => json(res, 502, { error: err.message }, true),
      );
      return true;
    case "/v1/hash":
      json(res, 200, { hash: "", size: 0 });
      return true;
    case "/v1/last-error":
      json(res, 200, { error: "" });
      return true;
    case "/v1/stop":
      stopRunning();
      json(res, 200, { ok: true });
      return true;
    default:
      break;
  }
  const file = /^\/v1\/file\/(movie|series)\/([0-9A-Za-z_-]+)\.([0-9a-z]+)$/.exec(url.pathname);
  if (file) {
    // The fake provider's own stream address, which serves the sample with ranges.
    req.url = "/" + file[1] + "/demo/demo/" + file[2] + "." + file[3];
    handleMock(req, res);
    return true;
  }
  json(res, 404, { error: "Nothing here." }, true);
  return true;
}

// Old sessions from an earlier run.
rmSync(OUT, { recursive: true, force: true });
