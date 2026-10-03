import { beforeEach, describe, expect, it } from "vitest";
import { clearAccount, loadHelperKey, loadOsAccount, MemoryStore, readOsFields, saveHelperKey, saveOsAccount, useStore, writeJson, readJson } from "../src/core/storage";

describe("storage", () => {
  beforeEach(() => useStore(new MemoryStore()));

  it("keeps the helper's key", () => {
    expect(loadHelperKey()).toBe("");
    saveHelperKey("abc123");
    expect(loadHelperKey()).toBe("abc123");
  });

  it("keeps OpenSubtitles fields even before they work", () => {
    saveOsAccount({ apiKey: "", username: "me", password: "pw", token: "", baseUrl: "" });
    expect(loadOsAccount()).toBeNull();
    expect(readOsFields().username).toBe("me");
    saveOsAccount({ apiKey: "k", username: "me", password: "pw", token: "t", baseUrl: "vip-api.opensubtitles.com" });
    expect(loadOsAccount()).toMatchObject({ apiKey: "k", token: "t" });
  });

  it("forgets the helper and Continue Watching, but keeps OpenSubtitles", () => {
    saveHelperKey("abc123");
    writeJson("progress", "items", [{ k: "m:1" }]);
    saveOsAccount({ apiKey: "k", username: "", password: "", token: "", baseUrl: "" });
    clearAccount();
    expect(loadHelperKey()).toBe("");
    expect(readJson("progress", "items")).toBeUndefined();
    expect(loadOsAccount()).not.toBeNull();
  });
});
