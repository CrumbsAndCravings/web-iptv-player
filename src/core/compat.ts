// Which way a title plays on the phone:
//   "direct"  the provider's file as it is, passed on by the helper. Safari plays MP4,
//             M4V and MOV files with H.264 or HEVC pictures and AAC, AC-3, E-AC-3 or MP3
//             sound, and jumps by asking the helper for the part it needs.
//   "helper"  converted by the helper into HLS while you watch: MKV files (79 % of the
//             provider's movies in a sample, docs/m0-findings.md in the Samsung repo),
//             AVI, DTS sound, and anything that failed on its own before.
// A title that fails directly is tried through the helper, and remembered, so it goes
// straight there next time.

import { readJson, writeJson } from "./storage";
import { isArr, isObj, fieldStr } from "./utils";
import { canDecodeAudio } from "./tracks";

export interface FileFacts {
  key: string; // "m:<streamId>" or "e:<episodeId>"
  ext: string;
  videoCodec: string;
  audioCodec: string;
}

export type Route = "direct" | "helper";

const DIRECT_CONTAINERS = ["mp4", "m4v", "mov"];
const DIRECT_VIDEO = ["h264", "avc", "avc1", "hevc", "h265"];
const TITLES_MAX = 200;

export function factsKey(kind: string, itemId: string): string {
  return (kind === "episode" ? "e:" : "m:") + itemId;
}

// `hevc`: whether this device plays HEVC pictures (every recent iPhone does; most
// desktop browsers don't).
export function playRoute(f: FileFacts, hevc: boolean): Route {
  if (needsHelper(f.key)) return "helper";
  if (DIRECT_CONTAINERS.indexOf(f.ext.trim().toLowerCase()) < 0) return "helper";
  const video = f.videoCodec.trim().toLowerCase();
  if (video !== "" && DIRECT_VIDEO.indexOf(video) < 0) return "helper";
  if ((video === "hevc" || video === "h265") && !hevc) return "helper";
  if (!canDecodeAudio(f.audioCodec)) return "helper";
  return "direct";
}

// Plain words for what the helper does with a title, for Details.
export function routeNote(f: FileFacts, route: Route): string {
  if (route === "direct") return "";
  const ext = f.ext.trim().toUpperCase() || "This";
  if (needsHelper(f.key)) return "This file didn't play on its own last time, so the helper on your computer converts it while you watch.";
  if (DIRECT_CONTAINERS.indexOf(f.ext.trim().toLowerCase()) < 0) return ext + " files don't play in Safari, so the helper on your computer converts this one while you watch.";
  return "The helper on your computer converts this file while you watch.";
}

// Titles that failed on their own, newest first, so they go through the helper from the
// start next time.
export function needsHelper(key: string): boolean {
  const list = readJson("helper", "titles");
  return isArr(list) && list.indexOf(key) >= 0;
}

export function rememberNeedsHelper(key: string): void {
  const list = readJson("helper", "titles");
  const keys = isArr(list) ? list.filter((k): k is string => typeof k === "string" && k !== key) : [];
  writeJson("helper", "titles", [key].concat(keys).slice(0, TITLES_MAX));
}

// Whether a picture format the helper keeps as it is (HEVC) played here, or had to be
// converted: learned once per format, so the next file starts the right way.
export type VideoMode = "copy" | "convert";

export function learnedMode(codec: string): VideoMode | "" {
  const mode = fieldStr(readJson("helper", "modes"), codec);
  return mode === "copy" || mode === "convert" ? mode : "";
}

export function learnMode(codec: string, mode: VideoMode): void {
  if (!codec) return;
  const modes = readJson("helper", "modes");
  const next: { [codec: string]: string } = {};
  if (isObj(modes)) for (const k of Object.keys(modes)) next[k] = fieldStr(modes, k);
  next[codec] = mode;
  writeJson("helper", "modes", next);
}

// What to ask the helper to do with the picture. It knows the file's real format (the
// provider's listing can be wrong or missing), keeps H.264, keeps HEVC when told this
// device plays it, and converts the rest; so "copy" unless this format had to be
// converted here before.
export function helperVideoMode(codec: string): VideoMode {
  return learnedMode(codec.trim().toLowerCase()) === "convert" ? "convert" : "copy";
}
