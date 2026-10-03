// The helper on your computer (helper/ in the Samsung repo), which serves this app and
// does everything a web page on a phone can't: it holds the provider login, asks the
// provider for lists, passes MP4 files on as they are, and converts the rest into HLS
// while you watch. The app is served by the helper, so its address is the page's own;
// the key comes from the link the helper prints ("?key=..."), kept in storage.

import type { Item } from "../core/items";
import { loadHelperKey, saveHelperKey } from "../core/storage";
import { field, fieldStr, isArr, isObj, Json, toInt } from "../core/utils";
import { helperSaid, isHelperError, NO_HELPER, send } from "../platform/http";

export function helperKey(): string {
  return loadHelperKey();
}

// The key in the page's address wins (a new link from the helper); the address keeps
// it, so a Home Screen icon made from this page has it too.
export function keyFromAddress(): string {
  let given: string;
  try {
    given = new URLSearchParams(window.location.search).get("key") || "";
  } catch {
    given = "";
  }
  given = given.trim();
  if (given !== "" && given !== loadHelperKey()) saveHelperKey(given);
  return loadHelperKey();
}

export function setHelperKey(key: string): void {
  saveHelperKey(key.trim());
}

// "/v1/xtream?key=...&action=get_vod_streams&category_id=12"
export function helperUrl(path: string, params?: { [name: string]: string | number | boolean }): string {
  let url = path + "?key=" + encodeURIComponent(helperKey());
  if (params) {
    for (const name of Object.keys(params)) {
      const value = params[name];
      url += "&" + name + "=" + encodeURIComponent(typeof value === "boolean" ? (value ? "1" : "0") : String(value));
    }
  }
  return url;
}

function kindOf(item: Item): "movie" | "series" {
  return item.kind === "episode" ? "series" : "movie";
}

function extOf(item: Item): string {
  return (item.ext || "mp4").trim().toLowerCase();
}

function titleParams(item: Item): { kind: string; id: string; ext: string } {
  return { kind: kindOf(item), id: item.itemId, ext: extOf(item) };
}

// Why a request to the helper failed, in words for the screen.
function failure(code: number, timedOut: boolean, res: Parameters<typeof helperSaid>[0]): string {
  if (code === 0 || timedOut) return NO_HELPER;
  return helperSaid(res);
}

// The account and settings from the helper's personal.json (GET /v1/app).
export function fetchSettings(): Promise<Json> {
  return send({ url: helperUrl("/v1/app"), timeoutMs: 15000 }).promise.then((res) => {
    if (res.code !== 200) throw new Error(failure(res.code, res.timedOut, res));
    return JSON.parse(res.text) as Json;
  });
}

// The provider's file as it is (MP4s), passed on by the helper.
export function fileUrl(item: Item): string {
  return helperUrl("/v1/file/" + kindOf(item) + "/" + encodeURIComponent(item.itemId) + "." + encodeURIComponent(extOf(item)));
}

export interface HlsTrack {
  index: number;
  codec: string;
  channels: number;
  language: string;
  title: string;
}

export interface HlsSubtitle {
  index: number;
  language: string;
  title: string;
  forced: boolean;
  url: string;
}

export interface HlsStart {
  url: string; // the playlist
  start: number; // seconds into the file where it begins
  duration: number; // the whole file's, seconds (0 when unknown)
  video: "copy" | "convert";
  videoCodec: string;
  audioTrack: number;
  audioPlan: string; // "copy", "aac", ...
  audio: HlsTrack[];
  subtitles: HlsSubtitle[];
}

export interface HlsOptions {
  start: number;
  video: "copy" | "convert";
  audioTrack: number; // -1: the first in `audioLanguage`, else the file's first
  audioLanguage: string;
  height: number;
}

// Starts converting from `start` seconds; resolves once the first pieces are ready
// (the provider, then FFmpeg: a few seconds, sometimes more).
export function startHls(item: Item, options: HlsOptions): { promise: Promise<HlsStart>; abort: () => void } {
  const request = send({
    url: helperUrl("/v1/hls/start", {
      ...titleParams(item),
      start: Math.max(0, Math.floor(options.start)),
      video: options.video,
      ...(options.audioTrack >= 0 ? { a: options.audioTrack } : options.audioLanguage ? { alang: options.audioLanguage } : {}),
      audio: "aac",
      height: options.height,
      format: "fmp4",
      subs: true,
    }),
    timeoutMs: 110000,
  });
  const promise = request.promise.then((res) => {
    if (res.code !== 200) throw new Error(failure(res.code, res.timedOut, res));
    const data: Json = JSON.parse(res.text);
    const audio = field(data, "audio");
    const subtitles = field(data, "subtitles");
    return {
      url: fieldStr(data, "url"),
      start: toInt(field(data, "start")),
      duration: toInt(field(data, "duration")),
      video: fieldStr(data, "video") === "convert" ? "convert" : "copy",
      videoCodec: fieldStr(data, "videoCodec"),
      audioTrack: toInt(field(data, "audioTrack")),
      audioPlan: fieldStr(data, "audioPlan"),
      audio: isArr(audio)
        ? audio.filter(isObj).map((a, index) => ({ index, codec: fieldStr(a, "codec"), channels: toInt(a.channels), language: fieldStr(a, "language"), title: fieldStr(a, "title") }))
        : [],
      subtitles: isArr(subtitles)
        ? subtitles.filter(isObj).map((s) => ({ index: toInt(s.index), language: fieldStr(s, "language"), title: fieldStr(s, "title"), forced: s.forced === true, url: fieldStr(s, "url") }))
        : [],
    } as HlsStart;
  });
  return { promise, abort: request.abort };
}

// Stops FFmpeg and frees the provider's one connection (leaving the player).
export function stopHelper(): void {
  send({ url: helperUrl("/v1/stop"), timeoutMs: 5000 });
}

// The file's OpenSubtitles moviehash ("" when it can't be had).
export function helperHash(item: Item): Promise<string> {
  return send({ url: helperUrl("/v1/hash", titleParams(item)), timeoutMs: 30000 }).promise.then(
    (res) => {
      if (res.code !== 200 || isHelperError(res)) return "";
      try {
        return fieldStr(JSON.parse(res.text), "hash");
      } catch {
        return "";
      }
    },
    () => "",
  );
}

// Why the helper's last stream failed ("" when it doesn't say).
export function helperLastError(): Promise<string> {
  return send({ url: helperUrl("/v1/last-error"), timeoutMs: 8000 }).promise.then(
    (res) => {
      if (res.code !== 200) return "";
      try {
        return fieldStr(JSON.parse(res.text), "error");
      } catch {
        return "";
      }
    },
    () => "",
  );
}

// OpenSubtitles through the helper (a web page can't call it, and can't name itself).
export function fetchUrl(url: string): string {
  return helperUrl("/v1/fetch", { url });
}
