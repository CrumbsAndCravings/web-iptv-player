// The tabs: Home, Movies, Series, Categories and Search along the bottom, as on the TV
// (where they run along the top), with the logo and the account button above. Each tab
// keeps its place while you're on another; a tap on the tab you're on goes back to its
// top (and on Search, brings up the keyboard).
//
// The tab bar is iOS 26's floating glass: a pill over the page, with a glass bubble behind
// the tab you're on that springs to the next. Press and it swells; drag along the bar and
// it follows your finger, choosing the tab you let go on.

import type { App, Screen } from "../app";
import type { Category } from "../core/xtream";
import { ApiError } from "../data/api";
import { h, iconButton, onTap, toggle } from "../ui/dom";
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

const LENS_INSET = 4; // the bubble's gap from the bar's edge (shell.css)
const DRAG_START_PX = 8; // a press that moves this far is a drag, not a tap

export class Shell implements Screen {
  readonly el: HTMLElement;
  private header: HTMLElement;
  private views: { [name in TabName]: View };
  private tabEls: { [name in TabName]?: HTMLElement } = {};
  private current: TabName = "home";
  private lists: Promise<CategoryLists> | null = null;
  private bar: HTMLElement;
  private lens: HTMLElement; // the glass bubble behind the tab you're on
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
    this.lens = h("div", { class: "tab-lens", attrs: { "aria-hidden": "true" } });
    const bar = h("nav", { class: "tab-bar", attrs: { "aria-label": "Sections" } }, [this.lens]);
    this.bar = bar;
    for (const tab of TABS) {
      const el = h("button", { class: "tab", attrs: { type: "button", "aria-label": tab.label } });
      el.innerHTML = tab.icon;
      el.appendChild(h("span", { text: tab.label }));
      onTap(el, () => this.select(tab.name));
      this.tabEls[tab.name] = el;
      bar.appendChild(el);
    }
    this.dragAlongBar();
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

  // Pressing the bar swells the bubble; moving along it carries the bubble with the
  // finger (the tab under it lights up), and letting go there chooses that tab.
  private dragAlongBar(): void {
    const bar = this.bar;
    let start = -1; // where the finger went down, or -1
    let dragged = false;
    let ignoreClicksUntil = 0; // the click a drag ends with isn't a tap
    bar.addEventListener(
      "click",
      (event) => {
        if (Date.now() < ignoreClicksUntil) event.stopPropagation();
      },
      { capture: true },
    );
    const place = (clientX: number) => {
      const rect = bar.getBoundingClientRect();
      const inner = rect.width - 2 * LENS_INSET;
      const width = inner / TABS.length;
      const left = Math.max(0, Math.min(inner - width, clientX - rect.left - LENS_INSET - width / 2));
      this.lens.style.setProperty("--drag-x", left + "px");
      const under = Math.round(left / width);
      TABS.forEach((tab, i) => toggle(this.tabEls[tab.name] as HTMLElement, "is-under", i === under));
      return under;
    };
    const finish = () => {
      start = -1;
      bar.classList.remove("is-pressed", "is-dragging");
      for (const tab of TABS) toggle(this.tabEls[tab.name] as HTMLElement, "is-under", false);
    };
    bar.addEventListener("pointerdown", (event) => {
      start = event.clientX;
      dragged = false;
      bar.classList.add("is-pressed");
    });
    bar.addEventListener("pointermove", (event) => {
      if (start < 0) return;
      if (!dragged && Math.abs(event.clientX - start) < DRAG_START_PX) return;
      if (!dragged) {
        dragged = true;
        bar.setPointerCapture(event.pointerId);
        bar.classList.add("is-dragging");
      }
      place(event.clientX);
    });
    bar.addEventListener("pointerup", (event) => {
      if (start < 0) return;
      if (dragged) {
        // The bubble springs from where the finger left it to the tab there (the CSS).
        const under = TABS[place(event.clientX)].name;
        finish();
        ignoreClicksUntil = Date.now() + 400;
        if (under !== this.current) this.select(under);
      } else finish();
    });
    bar.addEventListener("pointercancel", finish);
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
    this.lens.style.setProperty("--i", String(TABS.findIndex((tab) => tab.name === name)));
    for (const tab of TABS) {
      const on = tab.name === name;
      toggle(this.views[tab.name].el, "is-active", on);
      const el = this.tabEls[tab.name];
      if (el) {
        toggle(el, "is-selected", on);
        el.setAttribute("aria-current", on ? "page" : "false");
      }
    }
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
