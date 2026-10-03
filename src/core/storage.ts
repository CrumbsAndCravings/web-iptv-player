// Persistent key/value storage, ported from the Roku app's Registry.brs by way of the
// Samsung app. localStorage keeps it on the phone (a web app added to the Home Screen
// has its own, apart from Safari's). Keys look like "aranplus:<section>:<key>",
// mirroring Roku's registry sections.

import { fieldStr, isObj, Json } from "./utils";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// A stand-in when localStorage is unavailable (and for tests).
export class MemoryStore implements KeyValueStore {
  private data: { [key: string]: string } = {};
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
  }
  setItem(key: string, value: string): void {
    this.data[key] = value;
  }
  removeItem(key: string): void {
    delete this.data[key];
  }
}

let backing: KeyValueStore | null = null;

export function useStore(store: KeyValueStore): void {
  backing = store;
}

function store(): KeyValueStore {
  if (!backing) {
    try {
      backing = window.localStorage;
    } catch {
      backing = new MemoryStore();
    }
  }
  return backing;
}

function storageKey(section: string, key: string): string {
  return "aranplus:" + section + ":" + key;
}

export function regRead(section: string, key: string): string | null {
  return store().getItem(storageKey(section, key));
}

export function regWrite(section: string, key: string, value: string): void {
  store().setItem(storageKey(section, key), value);
}

export function regDelete(section: string, key: string): void {
  store().removeItem(storageKey(section, key));
}

export function readJson(section: string, key: string): Json {
  const raw = regRead(section, key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function writeJson(section: string, key: string, value: Json): void {
  regWrite(section, key, JSON.stringify(value));
}

// The helper's key, from the link it prints ("?key=..."); without it the helper turns
// every request away.
export function loadHelperKey(): string {
  return regRead("helper", "key") || "";
}

export function saveHelperKey(key: string): void {
  regWrite("helper", "key", key);
}

// Forgetting this setup (a different helper, or a different provider behind it):
// Continue Watching belongs to the old provider, so it goes too. Online subtitles stay.
export function clearAccount(): void {
  regDelete("helper", "key");
  regDelete("helper", "settings");
  regDelete("progress", "items");
  regDelete("progress", "removed");
}

// Player preferences, e.g. { audio: "hin", subtitles: "eng" } (language codes, "off"
// or "online").
export function loadPrefs(): { [key: string]: string } {
  const prefs = readJson("prefs", "player");
  const out: { [key: string]: string } = {};
  if (isObj(prefs)) for (const key of Object.keys(prefs)) out[key] = fieldStr(prefs, key);
  return out;
}

export function savePref(key: string, value: string): void {
  const prefs = loadPrefs();
  prefs[key] = value;
  writeJson("prefs", "player", prefs);
}

// OpenSubtitles account. Stays on the phone.
export interface OsAccount {
  apiKey: string;
  username: string;
  password: string;
  token: string;
  baseUrl: string;
}

// Whatever was typed, even when incomplete: forms save before they check.
export function readOsFields(): OsAccount {
  const raw = readJson("opensubtitles", "account");
  return {
    apiKey: fieldStr(raw, "apiKey"),
    username: fieldStr(raw, "username"),
    password: fieldStr(raw, "password"),
    token: fieldStr(raw, "token"),
    baseUrl: fieldStr(raw, "baseUrl"),
  };
}

// A usable account needs at least the API key.
export function loadOsAccount(): OsAccount | null {
  const account = readOsFields();
  return account.apiKey === "" ? null : account;
}

export function saveOsAccount(account: OsAccount): void {
  writeJson("opensubtitles", "account", {
    apiKey: account.apiKey,
    username: account.username,
    password: account.password,
    token: account.token,
    baseUrl: account.baseUrl,
  });
}
