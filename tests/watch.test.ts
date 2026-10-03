// Continue Watching rules from the Roku player (PlayerScreen.brs), and the jump preview.
import { describe, expect, it } from "vitest";
import { makeItem } from "../src/core/items";
import { dueForSave, entryFor, finishedChange, hasNext, resumeFrom, saveAction, Watching } from "../src/core/watch";

const movie: Watching = { kind: "movie", movie: makeItem({ kind: "movie", itemId: "9", title: "Heist", poster: "p", backdrop: "b", ext: "mkv" }) };
const show: Watching = {
  kind: "episode",
  seriesId: "55",
  seriesName: "Breaking Bad",
  poster: "sp",
  backdrop: "sb",
  queue: [
    makeItem({ kind: "episode", itemId: "801", seasonNo: 1, episodeNo: 1, title: "Pilot", ext: "mp4" }),
    makeItem({ kind: "episode", itemId: "802", seasonNo: 1, episodeNo: 2, title: "Cat", ext: "mkv" }),
  ],
};

describe("resume and saving", () => {
  it("resumes 5 s early once past 10 s", () => {
    expect(resumeFrom(0)).toBe(0);
    expect(resumeFrom(10)).toBe(0);
    expect(resumeFrom(11)).toBe(6);
    expect(resumeFrom(600)).toBe(595);
  });
  it("saves every 15 s, never under 10 s, and finishes at 95 %", () => {
    expect(dueForSave(29, 15)).toBe(false);
    expect(dueForSave(30, 15)).toBe(true);
    expect(dueForSave(0, 600)).toBe(true); // a jump back counts too
    expect(saveAction(9, 100)).toBe("skip");
    expect(saveAction(94, 100)).toBe("save");
    expect(saveAction(95, 100)).toBe("finished");
    expect(saveAction(5000, 0)).toBe("save"); // unknown length
  });
});

describe("Continue Watching entries", () => {
  it("keys movies by stream id with the movie's details", () => {
    expect(entryFor(movie, 0, 600, 6000)).toEqual({ k: "m:9", kind: "movie", id: "9", name: "Heist", poster: "p", bd: "b", ext: "mkv", pos: 600, dur: 6000 });
  });
  it("keys series by series id with the episode", () => {
    expect(entryFor(show, 1, 100, 2880)).toEqual({
      k: "s:55",
      kind: "episode",
      sid: "55",
      id: "802",
      ext: "mkv",
      name: "Breaking Bad",
      poster: "sp",
      bd: "sb",
      season: 1,
      episode: 2,
      etitle: "Cat",
      pos: 100,
      dur: 2880,
    });
  });
  it("drops a finished movie, and moves a series on or drops it after the last episode", () => {
    expect(finishedChange(movie, 0)).toEqual({ remove: "m:9" });
    expect(finishedChange(show, 0).put).toMatchObject({ k: "s:55", id: "802", pos: 0, dur: 0 });
    expect(finishedChange(show, 1)).toEqual({ remove: "s:55" });
    expect(hasNext(show, 0)).toBe(true);
    expect(hasNext(show, 1)).toBe(false);
    expect(hasNext(movie, 0)).toBe(false);
  });
});

