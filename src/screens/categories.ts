// The Categories tab (the TV apps' CategoriesScreen, docs/features.md §5.2 in the Roku
// repo): every category in your languages as cards. New releases first, then for each
// language in the order you chose its movies and its series, or one group for both when
// a language has 8 categories or fewer. A card shows its tidy name and how many titles
// it holds ("Movies · 104", from the stored library, so just "Movies" until that has
// loaded); a tap opens the category's page.

import type { App } from "../app";
import { LANGUAGE_NAMES, OrganizedCategory, takeTurns } from "../core/categories";
import { makeItem } from "../core/items";
import { languagePrefs } from "../core/personal";
import { commas } from "../core/utils";
import type { Category } from "../core/xtream";
import type { ApiError } from "../data/api";
import { h, setText } from "../ui/dom";
import { posterEl } from "../ui/poster";
import { organized } from "./browse";
import { CategoryScreen } from "./category";

type Kind = "movie" | "series";

interface Tile {
  kind: Kind;
  id: string;
  label: string;
}

const COUNTS_MS = 3000; // how often counts catch up while the library loads

function languageName(lang: string): string {
  return LANGUAGE_NAMES[lang] || lang.toUpperCase();
}

// The groups, from the organized category lists.
export function categoryGroups(movies: OrganizedCategory[], series: OrganizedCategory[], langs: string[]): { title: string; tiles: Tile[] }[] {
  const tile = (c: OrganizedCategory, kind: Kind): Tile => ({ kind, id: c.id, label: c.label });
  const groups: { title: string; tiles: Tile[] }[] = [];
  const add = (title: string, tiles: Tile[]) => {
    if (tiles.length > 0) groups.push({ title, tiles });
  };
  add(
    "New releases",
    takeTurns(
      movies.filter((c) => c.isNew).map((c) => tile(c, "movie")),
      series.filter((c) => c.isNew).map((c) => tile(c, "series")),
    ),
  );
  const order: string[] = langs.map((l) => l.toLowerCase());
  for (const lang of ["en", "hi", "pa", "other"]) if (order.indexOf(lang) < 0) order.push(lang);
  // Categories that don't say count as your first language.
  const first = order.length > 0 ? order[0] : "";
  const byLanguage = (list: OrganizedCategory[], kind: Kind, lang: string) => list.filter((c) => !c.isNew && (c.lang || first) === lang).map((c) => tile(c, kind));
  for (const lang of order) {
    const m = byLanguage(movies, "movie", lang);
    const s = byLanguage(series, "series", lang);
    if (m.length + s.length <= 8) add(languageName(lang), m.concat(s));
    else {
      add(languageName(lang) + " movies", m);
      add(languageName(lang) + " series", s);
    }
  }
  return groups;
}

export class CategoriesView {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private intro: HTMLElement;
  private loaded = false;
  private groups: { title: string; tiles: Tile[] }[] = [];
  private captions: { tile: Tile; el: HTMLElement }[] = [];
  private countsTimer = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private app: App,
    private categories: () => Promise<{ movies: Category[]; series: Category[]; error: ApiError | null }>,
  ) {
    this.intro = h("p", { class: "view-intro" });
    this.body = h("div", { class: "category-groups" });
    this.el = h("div", { class: "view categories" }, [h("h1", { class: "view-title", text: "Categories" }), this.intro, this.body]);
  }

  onShow(): void {
    if (this.app.library) {
      this.app.library.start();
      if (!this.unsubscribe) this.unsubscribe = this.app.library.onChange(() => this.countsSoon());
    }
    if (!this.loaded) {
      this.loaded = true;
      this.load();
    } else this.refreshCounts();
  }

  reload(): void {
    this.loaded = true;
    this.load();
  }

  invalidate(): void {
    this.loaded = false;
  }

  private load(): void {
    setText(this.intro, "Loading your categories…");
    this.body.textContent = "";
    this.categories().then(({ movies, series, error }) => {
      const m = organized(movies);
      const s = organized(series);
      this.groups = categoryGroups(m, s, languagePrefs());
      const total = m.length + s.length;
      if (total === 0) setText(this.intro, error ? "Couldn't load your categories. " + error.message : "Your provider didn't list any categories in your languages.");
      else setText(this.intro, commas(total) + " categories in your languages.");
      this.render();
    });
  }

  private render(): void {
    this.body.textContent = "";
    this.captions = [];
    const counts = this.app.library ? this.app.library.counts() : {};
    for (const group of this.groups) {
      const grid = h("div", { class: "category-grid" });
      for (const tile of group.tiles) {
        const card = posterEl(makeItem({ kind: "category", title: tile.label, caption: this.caption(tile, counts), categoryId: tile.id, listKind: tile.kind }), {
          open: () => this.app.push(new CategoryScreen(this.app, { kind: tile.kind, categoryId: tile.id, title: tile.label + (tile.kind === "series" ? "  ·  Series" : "  ·  Movies") })),
        });
        const caption = card.querySelector(".poster-category-caption") as HTMLElement | null;
        if (caption) this.captions.push({ tile, el: caption });
        grid.appendChild(card);
      }
      this.body.appendChild(h("section", { class: "category-group" }, [h("h2", { class: "row-title", text: group.title }), grid]));
    }
  }

  private caption(tile: Tile, counts: { [key: string]: number }): string {
    const kindName = tile.kind === "series" ? "Series" : "Movies";
    const count = counts[tile.kind + ":" + tile.id];
    return count > 0 ? kindName + " · " + commas(count) : kindName;
  }

  private countsSoon(): void {
    if (this.countsTimer) return;
    this.countsTimer = window.setTimeout(() => {
      this.countsTimer = 0;
      this.refreshCounts();
    }, COUNTS_MS);
  }

  private refreshCounts(): void {
    if (!this.app.library) return;
    const counts = this.app.library.counts();
    for (const c of this.captions) setText(c.el, this.caption(c.tile, counts));
  }
}
