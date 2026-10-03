// The provider's lists kept on the phone between launches, so Home and Details open at
// once instead of asking the provider (through the helper, perhaps over 5G) each time.
// A kept copy younger than FRESH_MS is used as it is. An older one is still shown at once
// while a new copy is fetched for next time, so a list is at most one launch behind. One
// older than its `maxAgeMs` (or none) is fetched first, with the kept copy standing in if
// that fails. At most MAX_KEPT copies are kept; the oldest go first.

import { log } from "../core/log";
import type { TextStore } from "../platform/files";

export const FRESH_MS = 30 * 60 * 1000;
export const MAX_KEPT = 400;

interface Kept<T> {
  at: number;
  value: T;
}

export class KeptLists {
  private refreshing = new Set<string>();
  private index: Promise<{ [name: string]: number }> | null = null;

  // `prefix` names this account's copies, so another account never sees them.
  constructor(
    private store: TextStore,
    private prefix: string,
    private now: () => number = () => Date.now(),
  ) {}

  async get<T>(key: string, maxAgeMs: number, load: () => Promise<T>): Promise<T> {
    const name = this.prefix + key;
    const kept = await this.read<T>(name);
    const age = kept ? this.now() - kept.at : Infinity;
    if (kept && age < FRESH_MS) return kept.value;
    if (kept && age < maxAgeMs) {
      this.refresh(name, load);
      return kept.value;
    }
    try {
      const value = await load();
      await this.write(name, value);
      return value;
    } catch (err) {
      if (!kept) throw err;
      log("kept: the provider didn't answer for", key + "; showing the copy from", Math.round(age / 3600000), "h ago");
      return kept.value;
    }
  }

  private refresh<T>(name: string, load: () => Promise<T>): void {
    if (this.refreshing.has(name)) return;
    this.refreshing.add(name);
    load()
      .then((value) => this.write(name, value))
      .catch(() => undefined)
      .then(() => this.refreshing.delete(name));
  }

  private async read<T>(name: string): Promise<Kept<T> | null> {
    const text = await this.store.load(name);
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as Kept<T>;
      if (parsed && typeof parsed.at === "number" && "value" in parsed) return parsed;
    } catch {
      // Not ours, or cut short: fetched again.
    }
    return null;
  }

  private async write<T>(name: string, value: T): Promise<void> {
    const at = this.now();
    await this.store.save(name, JSON.stringify({ at, value }));
    const index = await this.loadIndex();
    index[name] = at;
    const names = Object.keys(index);
    if (names.length > MAX_KEPT) {
      names.sort((a, b) => index[a] - index[b]);
      for (const old of names.slice(0, names.length - MAX_KEPT)) {
        delete index[old];
        await this.store.remove(old);
      }
    }
    await this.store.save(this.prefix + "index", JSON.stringify(index));
  }

  private loadIndex(): Promise<{ [name: string]: number }> {
    if (!this.index) {
      this.index = this.store.load(this.prefix + "index").then((text) => {
        try {
          const parsed: unknown = text ? JSON.parse(text) : null;
          if (parsed && typeof parsed === "object") return parsed as { [name: string]: number };
        } catch {
          // Started again.
        }
        return {};
      });
    }
    return this.index;
  }
}
