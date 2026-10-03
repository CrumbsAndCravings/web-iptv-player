// Every call to the Xtream server goes through here, by way of the helper on your
// computer (which adds the login): the Roku app's XtreamTask with a session cache, so
// going back to Home never refetches, and a gentle queue. The real provider seemed to
// stop answering after a burst of requests (docs/m0-findings.md in the Samsung repo),
// so at most three run at once and each starts a little after the one before. Home's and
// Details' lists are also kept on the phone between launches (kept.ts).

import type { Creds } from "../core/utils";
import { Category, parseCategories, parseSeriesInfo, parseVodInfo, buildRow, SeriesInfo, Season, VodInfo } from "../core/xtream";
import type { Row } from "../core/items";
import { log } from "../core/log";
import { files, TextStore } from "../platform/files";
import { getJson, JsonResult } from "../platform/http";
import { helperUrl } from "./helper";
import { KeptLists } from "./kept";

const MAX_IN_FLIGHT = 3;
const SPACING_MS = 120;
// The helper gives the provider 45 seconds, then says so itself.
const TIMEOUT_MS = 50000;
// How old a kept copy may be and still be shown while a new one is fetched: categories
// and film details hardly change; rows get new titles daily; a series gets new episodes.
const HOUR = 3600 * 1000;
const KEEP_CATEGORIES = 7 * 24 * HOUR;
const KEEP_ROW = 24 * HOUR;
const KEEP_VOD_INFO = 7 * 24 * HOUR;
const KEEP_SERIES_INFO = 6 * HOUR;

// A failed request, with the HTTP status (0 when there was no answer) so screens can
// tell a refusal from a hiccup.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code = 0,
    readonly cfBlock = false,
    readonly helper = false, // the helper's own trouble (no answer, wrong key)
  ) {
    super(message);
  }
}

type Job = { url: string; timeoutMs: number; resolve: (r: JsonResult) => void };

export class XtreamApi {
  private queue: Job[] = [];
  private inFlight = 0;
  private lastStart = 0;
  private timer = 0;
  private cache: { [key: string]: Promise<unknown> } = {};
  // Every whole category that arrives is handed here too, so Search can index what
  // Home already loaded instead of asking for it again.
  onList: ((kind: "movie" | "series", categoryId: string, data: unknown) => void) | null = null;

  private kept: KeptLists;

  // `creds` is the helper's account without its password: it names the stored library,
  // and the lists kept on the phone.
  constructor(
    readonly creds: Creds,
    store: TextStore = files,
  ) {
    this.kept = new KeptLists(store, "lists:" + creds.server + "|" + creds.username + ":");
  }

  private fetch(url: string, timeoutMs = TIMEOUT_MS): Promise<JsonResult> {
    return new Promise((resolve) => {
      this.queue.push({ url, timeoutMs, resolve });
      this.pump();
    });
  }

  private pump(): void {
    if (this.timer || this.inFlight >= MAX_IN_FLIGHT || this.queue.length === 0) return;
    const wait = this.lastStart + SPACING_MS - Date.now();
    if (wait > 0) {
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.pump();
      }, wait);
      return;
    }
    const job = this.queue.shift() as Job;
    this.inFlight++;
    this.lastStart = Date.now();
    getJson(job.url, job.timeoutMs).then((res) => {
      this.inFlight--;
      job.resolve(res);
      this.pump();
    });
    this.pump();
  }

  // Cached for the session; a failed request isn't cached, so it can be retried.
  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.cache[key]) {
      this.cache[key] = load().catch((err: Error) => {
        delete this.cache[key];
        throw err;
      });
    }
    return this.cache[key] as Promise<T>;
  }

  private json(action: string, params?: { [key: string]: string }, timeoutMs?: number): Promise<unknown> {
    return this.fetch(helperUrl("/v1/xtream", { action, ...(params || {}) }), timeoutMs).then((res) => {
      if (!res.ok) {
        log("api", action, "failed:", res.error);
        throw new ApiError(res.error, res.code, res.cfBlock, res.helper);
      }
      return res.data;
    });
  }

  categories(kind: "movie" | "series"): Promise<Category[]> {
    const action = kind === "series" ? "get_series_categories" : "get_vod_categories";
    return this.cached("cats:" + kind, () => this.kept.get("cats:" + kind, KEEP_CATEGORIES, () => this.json(action).then(parseCategories)));
  }

  // The newest `limit` titles of one category.
  row(kind: "movie" | "series", categoryId: string, title: string, limit = 40): Promise<Row> {
    const action = kind === "series" ? "get_series" : "get_vod_streams";
    const key = "row:" + kind + ":" + categoryId;
    return this.cached(key, () =>
      this.kept
        .get(key + ":" + limit, KEEP_ROW, () =>
          this.json(action, { category_id: categoryId }).then((data) => {
            if (this.onList) this.onList(kind, categoryId, data);
            return buildRow(data, kind, title, limit);
          }),
        )
        .then((row) => ({ ...row, title })),
    );
  }

  // A whole category, or the whole library when `categoryId` is "", uncached (for the
  // search index, which keeps only what it needs).
  list(kind: "movie" | "series", categoryId: string, timeoutMs: number): Promise<unknown> {
    // The helper waits up to 45 s for the provider, so give it a little longer.
    timeoutMs = Math.max(timeoutMs, TIMEOUT_MS);
    const action = kind === "series" ? "get_series" : "get_vod_streams";
    return this.json(action, categoryId ? { category_id: categoryId } : undefined, timeoutMs);
  }

  vodInfo(id: string): Promise<VodInfo> {
    return this.cached("vod:" + id, () => this.kept.get("vod:" + id, KEEP_VOD_INFO, () => this.json("get_vod_info", { vod_id: id }).then(parseVodInfo)));
  }

  seriesInfo(id: string): Promise<{ info: SeriesInfo; seasons: Season[] }> {
    return this.cached("series:" + id, () => this.kept.get("series:" + id, KEEP_SERIES_INFO, () => this.json("get_series_info", { series_id: id }).then(parseSeriesInfo)));
  }
}
