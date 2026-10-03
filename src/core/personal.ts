// What the helper on your computer says about this setup (GET /v1/app, from its
// personal.json): the account (server and username; the password never leaves the
// computer), the languages whose categories to show, and the sync service for Continue
// Watching. The Samsung app bakes the same file into its package; the phone asks the
// helper each launch and keeps the last answer, so Home can draw before it arrives.

import { readJson, writeJson } from "./storage";
import { Creds, field, fieldStr, isArr, isObj, Json, normalizeServer, toStr } from "./utils";

let data: Json = readSaved();

function readSaved(): Json {
  try {
    return readJson("helper", "settings");
  } catch {
    return undefined;
  }
}

// For tests, and when the helper answers.
export function usePersonal(value: Json): void {
  data = value;
}

export function savePersonal(value: Json): void {
  data = value;
  writeJson("helper", "settings", value);
}

// The provider account the helper signs in with, without its password: enough to name
// the stored library and the sync space, which every device must build the same way.
export function accountCreds(): Creds | null {
  const account = field(data, "account");
  const server = normalizeServer(fieldStr(account, "server"));
  const username = fieldStr(account, "username");
  if (server === "" || username === "") return null;
  return { server, username, password: "" };
}

// Languages whose categories to show, like ["en", "hi", "pa"]; empty means all of them.
// A choice made on the phone ("prefs:languages") comes first, then personal.json's.
export function languagePrefs(): string[] {
  const saved = readJson("prefs", "languages");
  if (isArr(saved)) return saved.map(toStr);
  const fromHelper = field(data, "languages");
  if (isArr(fromHelper)) return fromHelper.map(toStr);
  return [];
}

// Where Continue Watching syncs to, or null when there's no sync service.
export function syncConfig(): { url: string; key: string } | null {
  const sync = field(data, "sync");
  if (!isObj(sync)) return null;
  let url = fieldStr(sync, "url");
  const key = fieldStr(sync, "key");
  if (url === "" || key === "") return null;
  if (url.charAt(url.length - 1) === "/") url = url.slice(0, -1);
  return { url, key };
}

// The helper's version and how it converts pictures, for the account sheet.
export function helperVersion(): { version: string; encoder: string } {
  return { version: fieldStr(data, "version"), encoder: fieldStr(data, "encoder") };
}
