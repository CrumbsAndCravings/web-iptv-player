// Lists kept on the phone between launches (src/data/kept.ts): used at once when young,
// shown while a new copy is fetched when older, fetched first when too old, and a stand-in
// when the provider doesn't answer.
import { describe, expect, it } from "vitest";
import { FRESH_MS, KeptLists, MAX_KEPT } from "../src/data/kept";
import { MemoryTextStore } from "../src/platform/files";

const DAY = 24 * 3600 * 1000;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const store = new MemoryTextStore();
  let now = 1_000_000;
  const kept = new KeptLists(store, "lists:acct:", () => now);
  let calls = 0;
  let answer: string | Error = "first";
  const load = () => {
    calls++;
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return {
    store,
    kept,
    load,
    calls: () => calls,
    answer: (value: string | Error) => (answer = value),
    later: (ms: number) => (now += ms),
  };
}

describe("lists kept on the phone", () => {
  it("asks once, then uses the kept copy while it's young", async () => {
    const t = setup();
    expect(await t.kept.get("cats:movie", DAY, t.load)).toBe("first");
    t.later(FRESH_MS - 1000);
    t.answer("second");
    expect(await t.kept.get("cats:movie", DAY, t.load)).toBe("first");
    expect(t.calls()).toBe(1);
    expect(Object.keys(t.store.data).sort()).toEqual(["lists:acct:cats:movie", "lists:acct:index"]);
  });

  it("shows an older copy at once and fetches a new one for next time", async () => {
    const t = setup();
    await t.kept.get("row:movie:7:40", DAY, t.load);
    t.later(FRESH_MS + 1000);
    t.answer("second");
    expect(await t.kept.get("row:movie:7:40", DAY, t.load)).toBe("first");
    await settle();
    expect(t.calls()).toBe(2);
    expect(await t.kept.get("row:movie:7:40", DAY, t.load)).toBe("second");
    expect(t.calls()).toBe(2);
  });

  it("fetches first when the copy is too old, and falls back on it when that fails", async () => {
    const t = setup();
    await t.kept.get("series:9", DAY, t.load);
    t.later(DAY + 1000);
    t.answer("second");
    expect(await t.kept.get("series:9", DAY, t.load)).toBe("second");
    t.later(DAY + 1000);
    t.answer(new Error("HTTP 503"));
    expect(await t.kept.get("series:9", DAY, t.load)).toBe("second");
    await expect(t.kept.get("series:10", DAY, t.load)).rejects.toThrow("HTTP 503");
  });

  it("keeps at most MAX_KEPT copies, dropping the oldest", async () => {
    const t = setup();
    for (let i = 0; i < MAX_KEPT + 2; i++) {
      await t.kept.get("vod:" + i, DAY, t.load);
      t.later(1);
    }
    expect(t.store.data["lists:acct:vod:0"]).toBeUndefined();
    expect(t.store.data["lists:acct:vod:1"]).toBeUndefined();
    expect(t.store.data["lists:acct:vod:2"]).toBeDefined();
    expect(Object.keys(JSON.parse(t.store.data["lists:acct:index"])).length).toBe(MAX_KEPT);
  });
});
