// Which way a title plays on the phone (core/compat.ts): as it is, or through the helper.
import { beforeEach, describe, expect, it } from "vitest";
import { helperVideoMode, learnMode, needsHelper, playRoute, rememberNeedsHelper, routeNote } from "../src/core/compat";
import { MemoryStore, useStore } from "../src/core/storage";

const file = (ext: string, videoCodec = "", audioCodec = "", key = "m:1") => ({ key, ext, videoCodec, audioCodec });

describe("the way a title plays", () => {
  beforeEach(() => useStore(new MemoryStore()));

  it("plays MP4s with pictures and sound Safari knows as they are", () => {
    expect(playRoute(file("mp4", "h264", "aac"), true)).toBe("direct");
    expect(playRoute(file("MP4", "h264", "eac3"), false)).toBe("direct");
    expect(playRoute(file("m4v"), false)).toBe("direct");
    expect(playRoute(file("mov", "hevc", "aac"), true)).toBe("direct");
  });

  it("sends the rest through the helper", () => {
    // MKV is most of the provider's library; Safari reads none of it.
    expect(playRoute(file("mkv", "h264", "aac"), true)).toBe("helper");
    expect(playRoute(file("avi", "mpeg4", "mp3"), true)).toBe("helper");
    expect(playRoute(file("ts"), true)).toBe("helper");
    // HEVC on a device without it, DTS sound, a picture format Safari doesn't know.
    expect(playRoute(file("mp4", "hevc", "aac"), false)).toBe("helper");
    expect(playRoute(file("mp4", "h264", "dts"), true)).toBe("helper");
    expect(playRoute(file("mp4", "mpeg4", "aac"), true)).toBe("helper");
  });

  it("remembers titles that didn't play on their own", () => {
    expect(needsHelper("m:1")).toBe(false);
    rememberNeedsHelper("m:1");
    rememberNeedsHelper("e:7");
    rememberNeedsHelper("m:1");
    expect(needsHelper("m:1")).toBe(true);
    expect(playRoute(file("mp4", "h264", "aac"), true)).toBe("helper");
    expect(routeNote(file("mp4", "h264", "aac"), "helper")).toMatch(/didn't play on its own last time/);
  });

  it("says why the helper converts a file", () => {
    expect(routeNote(file("mkv"), "helper")).toBe("MKV files don't play in Safari, so the helper on your computer converts this one while you watch.");
    expect(routeNote(file("mp4", "h264", "aac"), "direct")).toBe("");
  });

  it("asks the helper to keep pictures unless they had to be converted here before", () => {
    expect(helperVideoMode("hevc")).toBe("copy");
    expect(helperVideoMode("")).toBe("copy");
    learnMode("hevc", "convert");
    expect(helperVideoMode("HEVC")).toBe("convert");
    expect(helperVideoMode("h264")).toBe("copy");
  });
});
