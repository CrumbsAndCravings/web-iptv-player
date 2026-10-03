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
  session: string; // the helper's name for it
  url: string; // the playlist
  // The playlist lists the whole film (the helper makes each piece when it's asked for),
  // so the video's clock is the film's and it jumps by itself. Otherwise the playlist
  // grows from `start` as the helper converts.
  vod: boolean;
  from: number; // where a whole-film playlist starts playing, seconds
  start: number; // seconds into the file where the video's clock starts
  duration: number; // the whole file's, seconds (0 when unknown)
  video: "copy" | "convert";
  videoCodec: string;
  audioTrack: number;
  audioPlan: string; // "copy", "aac", ...
  audio: HlsTrack[];
  subtitles: HlsSubtitle[];
  // Pictures of the film for dragging the bar, one every `every` seconds, made from what
  // the helper has converted: `prefix` + the 5-digit number + ".jpg". Null without.
  previews: { every: number; prefix: string } | null;
}

// The preview picture for `seconds` into the film, or "" without previews.
export function previewUrl(session: HlsStart, seconds: number): string {
  const previews = session.previews;
  if (!previews || previews.every <= 0 || seconds < 0) return "";
  return previews.prefix + String(Math.floor(seconds / previews.every)).padStart(5, "0") + ".jpg";
}

export interface HlsOptions {
  start: number;
  video: "copy" | "convert";
  audioTrack: number; // -1: the first in `audioLanguage`, else the file's first
  audioLanguage: string;
  height: number;
  hevc: boolean; // this device plays HEVC pictures, so the helper may keep them
}

// Starts converting from `start` seconds; resolves once the first pieces are ready
// (the provider, then FFmpeg: a few seconds, sometimes more). The helper lists the whole
// film when it knows its length, as Safari likes best.
export function startHls(item: Item, options: HlsOptions): { promise: Promise<HlsStart>; abort: () => void } {
  const request = send({
    url: helperUrl("/v1/hls/start", {
      ...titleParams(item),
      start: Math.max(0, Math.floor(options.start)),
      video: options.video,
      hevc: options.hevc,
      ...(options.audioTrack >= 0 ? { a: options.audioTrack } : options.audioLanguage ? { alang: options.audioLanguage } : {}),
      audio: "aac",
      height: options.height,
      format: "fmp4",
      subs: true,
      vod: 1,
    }),
    timeoutMs: 110000,
  });
  const promise = request.promise.then((res) => {
    if (res.code !== 200) throw new Error(failure(res.code, res.timedOut, res));
    const data: Json = JSON.parse(res.text);
    const audio = field(data, "audio");
    const subtitles = field(data, "subtitles");
    const previews = field(data, "previews");
    return {
      session: fieldStr(data, "session"),
      url: fieldStr(data, "url"),
      vod: field(data, "vod") === true,
      from: toInt(field(data, "from")),
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
      previews: isObj(previews) && toInt(previews.every) > 0 && fieldStr(previews, "prefix") ? { every: toInt(previews.every), prefix: fieldStr(previews, "prefix") } : null,
    } as HlsStart;
  });
  return { promise, abort: request.abort };
}

// Stops the session's FFmpeg and frees the provider's one connection (leaving the
// player). Only that session: the TV may have started something on the helper since.
export function stopHelper(session: string): void {
  if (session) send({ url: helperUrl("/v1/stop", { session }), timeoutMs: 5000 });
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
