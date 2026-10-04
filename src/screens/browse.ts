// Home, Movies and Series (the TV apps' HomeScreen, docs/features.md §4.4 and §5.1 in the
// Roku repo), for a phone: a hero at the top of Home, then rows of posters that scroll
// sideways. Rows load a few at a time as you scroll down, so a big library doesn't
// choke the phone or the provider.
//
// Home holds Continue Watching, then up to 18 rows: new releases first, then the rest,
// movies and series taking turns and each language you watch taking turns. Movies and
// Series list every wanted category. Each row ends with a See all tile for its whole
// category. A long press (or ⋯) on a Continue Watching poster offers to remove it. When
// the provider refuses a row, no more are asked for (a burst of requests can keep a
// block going), and the screen says why.

import type { App } from "../app";
import { languageTurns, organizeCategories, OrganizedCategory, takeTurns } from "../core/categories";
import { applyInfo, Item, makeItem, metaLine } from "../core/items";
import { log } from "../core/log";
import { languagePrefs } from "../core/personal";
import { continueWatchingRow, progressFind, progressRemove } from "../core/progress";
import { isRefusalCode, refusalHint } from "../core/refusals";
import { episodeCode, formatClock, sizedImage, toInt } from "../core/utils";
import type { Category } from "../core/xtream";
import { BACKDROP_SIZE } from "../core/xtream";
import { ApiError } from "../data/api";
import { h, onTap, toggle } from "../ui/dom";
import { ICONS } from "../ui/icons";
import { introReady } from "../ui/intro";
import { fadeInBackground, noteTapped } from "../ui/motion";
import { placeholders, PosterActions, rowEl } from "../ui/poster";
import { CategoryScreen } from "./category";
import { DetailsScreen } from "./details";
import { resumeEntry } from "./play";

export type BrowseMode = "home" | "movie" | "series";

const FIRST_ROWS = 5;
const MORE_ROWS = 3;
const HOME_ROWS = 18;

interface PlanEntry {
  kind: "movie" | "series";
  categoryId: string;
  title: string;
  lang: string;
  demoted: boolean;
}

// Every wanted category, organized. 4K categories aren't moved last: the helper fits
// what it converts to the phone, and HEVC 4K plays on recent iPhones as it is.
export function organized(list: Category[]): OrganizedCategory[] {
  return organizeCategories(list, languagePrefs(), new Date().getFullYear());
}

function entries(list: OrganizedCategory[], kind: "movie" | "series", wantNew: boolean | null): PlanEntry[] {
  return list.filter((c) => wantNew === null || c.isNew === wantNew).map((c) => ({ kind, categoryId: c.id, title: c.label, lang: c.lang, demoted: c.demoted }));
}

// Which category rows a tab shows. Categories in languages you don't watch are left
// out, names are tidied ("EN | ACTION ★" becomes "Action"), and new releases come first.
export function buildPlan(mode: BrowseMode, movieCats: Category[], seriesCats: Category[]): PlanEntry[] {
  const movies = organized(movieCats);
  const series = organized(seriesCats);
  if (mode === "movie") return entries(movies, "movie", null);
  if (mode === "series") return entries(series, "series", null);
  const newest = takeTurns(entries(movies, "movie", true), entries(series, "series", true));
  const rest = languageTurns(takeTurns(entries(movies, "movie", false), entries(series, "series", false)), languagePrefs());
  return newest
    .concat(rest)
    .slice(0, HOME_ROWS)
    .map((entry) => ({ ...entry, title: entry.title + (entry.kind === "series" ? "  ·  Series" : "  ·  Movies") }));
}

export class BrowseView {
  readonly el: HTMLElement;
  private heroEl: HTMLElement;
  private rowsEl: HTMLElement;
  private statusEl: HTMLElement;
  private sentinel: HTMLElement;
  private observer: IntersectionObserver | null = null;
  private cwRow: { el: HTMLElement; fill(items: Item[]): void } | null = null;
  private plan: PlanEntry[] = [];
  private planIndex = 0;
  private generation = 0;
  private lastError = "";
  private refused = false;
  private cfBlock = false;
  private loaded = false;
  private heroItem: Item | null = null;
  private actions: PosterActions;

  constructor(
    private app: App,
    readonly mode: BrowseMode,
    private categories: () => Promise<{ movies: Category[]; series: Category[]; error: ApiError | null }>,
  ) {
    this.heroEl = h("div", { class: "hero is-empty" });
    this.rowsEl = h("div", { class: "rows" });
    this.statusEl = h("div", { class: "browse-status" });
    this.sentinel = h("div", { class: "rows-sentinel" });
    this.el = h("div", { class: "view browse browse-" + mode }, [mode === "home" ? this.heroEl : null, this.rowsEl, this.statusEl, this.sentinel]);
    this.actions = {
      open: (item) => this.open(item),
    };
  }

  // The first time the tab shows, its rows start loading; afterwards, Continue Watching
  // is brought up to date.
  onShow(): void {
    if (!this.loaded) {
      this.loaded = true;
      this.load();
    } else this.refreshContinueWatching();
  }

  reload(): void {
    this.loaded = true;
    this.load();
  }

  invalidate(): void {
    this.loaded = false;
    this.heroItem = null;
  }

  private load(): void {
    this.generation++;
    const generation = this.generation;
    this.lastError = "";
    this.refused = false;
    this.cfBlock = false;
    this.rowsEl.textContent = "";
    this.cwRow = null;
    this.setStatus("Loading your library…", false);
    if (this.mode === "home") this.refreshContinueWatching();
    this.categories().then(({ movies, series, error }) => {
      if (generation !== this.generation) return;
      if (error) this.noteError(error);
      this.plan = buildPlan(this.mode, movies, series);
      this.planIndex = 0;
      if (this.plan.length === 0) {
        if (this.lastError) this.showError();
        else this.setStatus("Your provider didn't list anything here.", false);
        if (this.mode === "home") introReady();
        return;
      }
      this.setStatus("", false);
      this.appendRows(FIRST_ROWS);
      this.watchEnd();
    });
  }

  // More rows as the end of the list comes into view.
  private watchEnd(): void {
    if (this.observer) this.observer.disconnect();
    if (typeof IntersectionObserver === "undefined") {
      this.appendRows(this.plan.length);
      return;
    }
    this.observer = new IntersectionObserver(
      (seen) => {
        if (seen.some((entry) => entry.isIntersecting)) this.appendRows(MORE_ROWS);
      },
      { root: this.el, rootMargin: "0px 0px 600px 0px" },
    );
    this.observer.observe(this.sentinel);
  }

  private appendRows(count: number): void {
    const api = this.app.api;
    if (!api) return;
    const generation = this.generation;
    for (let added = 0; added < count && this.planIndex < this.plan.length; added++) {
      const entry = this.plan[this.planIndex++];
      const row = rowEl(entry.title, placeholders(), this.actions);
      this.rowsEl.appendChild(row.el);
      api
        .row(entry.kind, entry.categoryId, entry.title)
        .then((loaded) => {
          if (generation !== this.generation) return;
          if (loaded.items.length === 0) {
            row.el.remove();
            this.appendRows(1);
            return;
          }
          // A See all tile ends the row; its page lists the whole category.
          const title = this.mode === "home" ? entry.title : entry.title + (entry.kind === "series" ? "  ·  Series" : "  ·  Movies");
          row.fill(loaded.items.concat([makeItem({ kind: "seeAll", title, categoryId: entry.categoryId, listKind: entry.kind })]));
          // Something to show: the intro may fly into it.
          if (this.mode === "home") introReady();
          if (this.mode === "home" && !this.heroItem) this.showHero(loaded.items[0]);
        })
        .catch((err: Error) => {
          if (generation !== this.generation) return;
          log("row failed:", entry.title, err.message);
          // The provider is saying no or not answering. Asking for every other category
          // would look like a flood and could keep the block going longer.
          this.noteError(err);
          this.planIndex = this.plan.length;
          row.el.remove();
          if (!this.rowsEl.querySelector(".row:not(.is-continue)")) this.showError();
          else this.setStatus(this.errorText(), true);
          if (this.mode === "home") introReady();
        });
    }
  }

  private noteError(err: Error): void {
    this.lastError = err.message;
    this.refused = err instanceof ApiError && !err.helper && (isRefusalCode(err.code) || err.cfBlock);
    this.cfBlock = err instanceof ApiError && err.cfBlock;
  }

  private errorText(): string {
    let text = "Couldn't load all of your library. " + this.lastError;
    if (this.refused) text += " " + refusalHint(403, this.cfBlock);
    return text;
  }

  private showError(): void {
    this.setStatus(this.errorText().replace("all of your", "your"), true);
  }

  private setStatus(text: string, retry: boolean): void {
    this.statusEl.textContent = "";
    toggle(this.statusEl, "is-visible", text !== "");
    if (!text) return;
    this.statusEl.appendChild(h("p", { text }));
    if (retry) this.statusEl.appendChild(onTap(h("button", { class: "pill", text: "Try again", attrs: { type: "button" } }), () => this.reload()));
  }

  // --- Continue Watching and the hero -------------------------------------------------

  refreshContinueWatching(): void {
    if (this.mode !== "home") return;
    const cw = continueWatchingRow();
    if (!cw) {
      if (this.cwRow) this.cwRow.el.remove();
      this.cwRow = null;
    } else if (this.cwRow) this.cwRow.fill(cw.items);
    else {
      this.cwRow = rowEl(cw.title, cw.items, { open: (item) => this.open(item), more: (item) => this.continueMenu(item) }, "is-continue");
      this.rowsEl.insertBefore(this.cwRow.el, this.rowsEl.firstChild);
    }
    // Home's hero is what you were watching last, otherwise the newest title.
    if (cw) this.showHero(cw.items[0]);
    else if (this.heroItem && progressFind(this.heroKey(this.heroItem))) this.heroItem = null;
  }

  private heroKey(item: Item): string {
    return (item.kind === "series" ? "s:" : "m:") + item.itemId;
  }

  private showHero(item: Item): void {
    if (this.mode !== "home" || !item) return;
    this.heroItem = item;
    const entry = progressFind(this.heroKey(item));
    const backdrop = item.backdrop || (item.poster ? sizedImage(item.poster, BACKDROP_SIZE) : "");
    // The same title again (its details arrived): no second entrance.
    const again = this.heroEl.dataset.title === item.itemId;
    this.heroEl.dataset.title = item.itemId;
    const art = h("div", { class: "hero-art" + (item.backdrop ? "" : " is-poster") });
    // The picture fades in and settles once it's here, rather than drawing in strips.
    if (backdrop) fadeInBackground(art, backdrop);
    const play = h("button", { class: "button is-primary", attrs: { type: "button" } });
    play.innerHTML = ICONS.play;
    let label = "Play";
    if (entry && entry.kind === "episode") label = (toInt(entry.pos) > 0 ? "Resume " : "Play ") + episodeCode(entry.season, entry.episode);
    else if (entry && toInt(entry.pos) > 0) label = "Resume from " + formatClock(toInt(entry.pos));
    play.appendChild(h("span", { text: label }));
    onTap(play, () => {
      if (entry) resumeEntry(this.app, entry, item);
      else this.open(item);
    });
    const more = onTap(h("button", { class: "button", text: "Details", attrs: { type: "button" } }), () => {
      // Its page grows out of the big picture.
      noteTapped(art);
      this.open(item);
    });
    const meta = metaLine(item);
    this.heroEl.textContent = "";
    this.heroEl.className = "hero" + (again ? " is-settled" : "");
    this.heroEl.appendChild(art);
    this.heroEl.appendChild(
      h("div", { class: "hero-body" }, [
        h("div", { class: "hero-eyebrow", text: entry ? "CONTINUE WATCHING" : "NEW TO WATCH" }),
        h("h1", { class: "hero-title", text: item.title }),
        meta ? h("div", { class: "hero-meta", text: meta }) : null,
        h("div", { class: "hero-buttons" }, [play, more]),
      ]),
    );
    // Movies in lists have no backdrop or details; ask once.
    if (item.kind === "movie" && !item.hasInfo && this.app.api) {
      this.app.api
        .vodInfo(item.itemId)
        .then((info) => {
          applyInfo(item, info);
          if (this.heroItem === item) this.showHero(item);
        })
        .catch((err: Error) => log("hero info failed:", err.message));
    }
  }

  private continueMenu(item: Item): void {
    this.app.sheet({
      title: item.title,
      message: "Remove it from Continue Watching? Where you stopped is forgotten.",
      buttons: [
        {
          label: "Remove from Continue Watching",
          style: "danger",
          action: () => {
            progressRemove(this.heroKey(item));
            if (this.app.sync) this.app.sync.now();
            if (this.heroItem && this.heroKey(this.heroItem) === this.heroKey(item)) this.heroItem = null;
            this.refreshContinueWatching();
            if (!this.heroItem) {
              const first = this.rowsEl.querySelector(".row:not(.is-continue)");
              if (!first) this.heroEl.className = "hero is-empty";
            }
          },
        },
      ],
      cancel: "Keep it",
    });
  }

  private open(item: Item): void {
    if (item.placeholder) return;
    if (item.kind === "seeAll") {
      this.app.push(new CategoryScreen(this.app, { kind: item.listKind === "series" ? "series" : "movie", categoryId: item.categoryId, title: item.title }));
      return;
    }
    this.app.push(new DetailsScreen(this.app, item));
  }
}
