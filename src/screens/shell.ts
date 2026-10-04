// The tabs: Home, Movies, Series, Categories and Search along the bottom, as on the TV
// (where they run along the top), with the logo and the account button above. Each tab
// keeps its place while you're on another; a tap on the tab you're on goes back to its
// top (and on Search, brings up the keyboard).
//
// The tab bar is iOS 26's floating glass: a pill over the page, with a glass lens behind
// the tab you're on (ui/glass-lens.ts) that lifts and magnifies under a finger, stretches
// as it's dragged along the bar, and springs onto the tab you let go on.

import type { App, Screen } from "../app";
import type { Category } from "../core/xtream";
import { ApiError } from "../data/api";
import { h, iconButton, onTap, toggle } from "../ui/dom";
import { GlassLens } from "../ui/glass-lens";
import { ICONS } from "../ui/icons";
import { BrowseView } from "./browse";
import { CategoriesView } from "./categories";
import { SearchView } from "./search";
import { SettingsScreen } from "./settings";

type TabName = "home" | "movies" | "series" | "categories" | "search";

interface View {
  readonly el: HTMLElement;
  onShow(): void;
  reload?(): void;
  invalidate?(): void;
}

const TABS: { name: TabName; label: string; icon: string }[] = [
  { name: "home", label: "Home", icon: ICONS.home },
  { name: "movies", label: "Movies", icon: ICONS.movies },
  { name: "series", label: "Series", icon: ICONS.series },
  { name: "categories", label: "Categories", icon: ICONS.categories },
  { name: "search", label: "Search", icon: ICONS.search },
];

type CategoryLists = { movies: Category[]; series: Category[]; error: ApiError | null };


export class Shell implements Screen {
  readonly el: HTMLElement;
  private header: HTMLElement;
  private views: { [name in TabName]: View };
  private tabEls: { [name in TabName]?: HTMLElement } = {};
  private current: TabName = "home";
  private lists: Promise<CategoryLists> | null = null;
  private glass: GlassLens;
  private unsubscribeSync: (() => void) | null = null;

  constructor(private app: App) {
    const categories = () => this.categories();
    const home = new BrowseView(app, "home", categories);
    const search = new SearchView(app);
    this.views = {
      home,
      movies: new BrowseView(app, "movie", categories),
      series: new BrowseView(app, "series", categories),
      categories: new CategoriesView(app, categories),
      search,
    };
    const account = onTap(iconButton("round-button header-account", ICONS.account, "Account and settings"), () => this.app.push(new SettingsScreen(this.app, () => this.reloadAll())));
    this.header = h("header", { class: "shell-header" }, [h("div", { class: "logo" }, [h("span", { class: "logo-name", text: "ARAN" }), h("span", { class: "logo-plus", text: "+" })]), account]);
    const bar = h("nav", { class: "tab-bar", attrs: { "aria-label": "Sections" } });
    for (const tab of TABS) {
      const el = h("button", { class: "tab", attrs: { type: "button", "aria-label": tab.label } });
      el.innerHTML = tab.icon;
      el.appendChild(h("span", { text: tab.label }));
      onTap(el, () => this.select(tab.name));
      this.tabEls[tab.name] = el;
      bar.appendChild(el);
    }
    this.glass = new GlassLens(
      bar,
      TABS.map((tab) => this.tabEls[tab.name] as HTMLElement),
      (index) => this.select(TABS[index].name),
    );
    const stack = h("div", { class: "views" }, TABS.map((tab) => this.views[tab.name].el));
    this.el = h("div", { class: "shell" }, [stack, this.header, bar]);
    // The header turns solid once the view scrolls under it.
    for (const tab of TABS) {
      const view = this.views[tab.name].el;
      view.addEventListener("scroll", () => {
        if (tab.name === this.current) toggle(this.header, "is-solid", view.scrollTop > 24);
      }, { passive: true });
    }
    this.followSync();
    this.select("home");
  }

  // Continue Watching changed on another device.
  private followSync(): void {
    if (this.unsubscribeSync) this.unsubscribeSync();
    this.unsubscribeSync = null;
    const home = this.views.home as BrowseView;
    if (this.app.sync) this.unsubscribeSync = this.app.sync.onChange(() => home.refreshContinueWatching());
  }

  destroy(): void {
    if (this.unsubscribeSync) this.unsubscribeSync();
  }

  // Back from Details, the player or Settings.
  onShow(): void {
    if (this.app.sync) this.app.sync.soon();
    if (this.current === "home") (this.views.home as BrowseView).refreshContinueWatching();
  }

  private select(name: TabName): void {
    const view = this.views[name];
    if (name === this.current && view.el.classList.contains("is-active")) {
      // Again: to the top, or the keyboard on Search.
      if (name === "search" && view.el.scrollTop < 8) (view as SearchView).focus();
      view.el.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    this.current = name;
    this.glass.moveTo(TABS.findIndex((tab) => tab.name === name));
    TABS.forEach((tab, i) => {
      const on = tab.name === name;
      toggle(this.views[tab.name].el, "is-active", on);
      this.glass.mark(i, "is-selected", on);
      const el = this.tabEls[tab.name];
      if (el) {
        toggle(el, "is-selected", on);
        el.setAttribute("aria-current", on ? "page" : "false");
      }
    });
    toggle(this.header, "is-solid", view.el.scrollTop > 24);
    toggle(this.el, "on-home", name === "home");
    view.onShow();
  }

  // Both category lists, once per session; asked again after a failure.
  private categories(): Promise<CategoryLists> {
    const api = this.app.api;
    if (!api) return Promise.resolve({ movies: [], series: [], error: null });
    if (!this.lists) {
      let error: ApiError | null = null;
      const note = (err: Error) => {
        error = err instanceof ApiError ? err : new ApiError(err.message);
        return [] as Category[];
      };
      this.lists = Promise.all([api.categories("movie").catch(note), api.categories("series").catch(note)]).then(([movies, series]) => {
        if (error && movies.length === 0 && series.length === 0) this.lists = null;
        return { movies, series, error };
      });
    }
    return this.lists;
  }

  // After the languages change: every tab builds again, the others when they next show.
  reloadAll(): void {
    this.lists = null;
    this.followSync();
    for (const tab of TABS) {
      const view = this.views[tab.name];
      if (tab.name === this.current && view.reload) view.reload();
      else if (view.invalidate) view.invalidate();
    }
  }
}
