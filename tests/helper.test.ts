// The helper's settings (core/personal.ts) and the addresses the app asks it for
// (data/helper.ts).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accountCreds, languagePrefs, syncConfig, usePersonal } from "../src/core/personal";
import { MemoryStore, saveHelperKey, useStore, writeJson } from "../src/core/storage";
import { syncSpaceText } from "../src/core/utils";
import { helperUrl } from "../src/data/helper";

const settings = {
  account: { server: "HTTP://Line.Example:80/", username: "jane" },
  languages: ["en", "pa"],
  sync: { url: "https://aranplus-sync.example.workers.dev/", key: "s3cret" },
};

describe("the helper's settings", () => {
  beforeEach(() => {
    useStore(new MemoryStore());
    usePersonal(settings);
  });
  afterEach(() => usePersonal(undefined));

  it("give the account without a password, the same for sync as on the TV", () => {
    const creds = accountCreds();
    expect(creds).toEqual({ server: "HTTP://Line.Example:80", username: "jane", password: "" });
    expect(syncSpaceText(creds!)).toBe("http://line.example\njane");
  });

  it("give the languages, unless the phone has its own choice", () => {
    expect(languagePrefs()).toEqual(["en", "pa"]);
    writeJson("prefs", "languages", ["hi"]);
    expect(languagePrefs()).toEqual(["hi"]);
  });

  it("give the sync service, without its trailing slash", () => {
    expect(syncConfig()).toEqual({ url: "https://aranplus-sync.example.workers.dev", key: "s3cret" });
    usePersonal({ ...settings, sync: null });
    expect(syncConfig()).toBeNull();
  });

  it("have no account until the helper says which", () => {
    usePersonal(undefined);
    expect(accountCreds()).toBeNull();
    expect(languagePrefs()).toEqual([]);
  });
});

describe("addresses for the helper", () => {
  beforeEach(() => useStore(new MemoryStore()));

  it("carry the key and the parameters, encoded", () => {
    saveHelperKey("k&1");
    expect(helperUrl("/v1/xtream", { action: "get_vod_info", vod_id: 12 })).toBe("/v1/xtream?key=k%261&action=get_vod_info&vod_id=12");
    expect(helperUrl("/v1/hls/start", { subs: true, hevc: false, alang: "hin" })).toBe("/v1/hls/start?key=k%261&subs=1&hevc=0&alang=hin");
    expect(helperUrl("/v1/fetch", { url: "https://api.opensubtitles.com/api/v1/subtitles?query=a b" })).toBe(
      "/v1/fetch?key=k%261&url=https%3A%2F%2Fapi.opensubtitles.com%2Fapi%2Fv1%2Fsubtitles%3Fquery%3Da%20b",
    );
  });
});
