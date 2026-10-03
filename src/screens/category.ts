// A category's page, "See all" (the TV apps' CategoryScreen, docs/features.md §5.3 in
// the Roku repo): every title in one category, newest first, from the stored library,
// so nothing is asked of the provider. A grid of posters, capped at the newest 1,000
// with the count line saying so. The search box at the top narrows the grid as you
// type, with the same matching as Search. While the library is still loading, the page
// says so and asks again every 5 s as it grows.

import type { App, Screen } from "../app";
import type { Item } from "../core/items";
import { commas } from "../core/utils";
import { h, iconButton, onTap, setText } from "../ui/dom";
import { ICONS } from "../ui/icons";
import { stagger } from "../ui/motion";
import { posterEl } from "../ui/poster";
import { DetailsScreen } from "./details";

export interface CategoryRef {
  kind: "movie" | "series";
  categoryId: string;
  title: string;
}

const LIMIT = 1000;
const PAGE = 60; // posters added to the page at a time, as you scroll
const ASK_AGAIN_MS = 5000;
const TYPING_MS = 250;

export class CategoryScreen implements Screen {
  readonly el: HTMLElement;
  private scroller: HTMLElement;
  private grid: HTMLElement;
  private countEl: HTMLElement;
  private messageEl: HTMLElement;
  private input: HTMLInputElement;
  private sentinel: HTMLElement;
  private observer: IntersectionObserver | null = null;
  private items: Item[] = [];
  private shown = 0;
  private query = "";
  private allCount = -1;
  private loading = false;
  private lastAsked = 0;
  private typingTimer = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private app: App,
    private category: CategoryRef,
  ) {
    this.countEl = h("div", { class: "page-count" });
    this.messageEl = h("div", { class: "page-message", text: "Gathering titles…" });
    this.input = h("input", {
      class: "field search-field",
      attrs: { type: "search", placeholder: "Search this category", enterkeyhint: "search", autocapitalize: "off", autocorrect: "off", spellcheck: "false", "aria-label": "Search " + category.title },
    });
    this.input.addEventListener("input", () => {
      window.clearTimeout(this.typingTimer);
      this.typingTimer = window.setTimeout(() => this.setQuery(this.input.value), TYPING_MS);
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.input.blur();
    });
    this.grid = h("div", { class: "poster-grid" });
    this.sentinel = h("div", { class: "rows-sentinel" });
    const back = onTap(iconButton("round-button", ICONS.back, "Back"), () => this.app.back());
    this.scroller = h("div", { class: "page-body" }, [this.input, this.countEl, this.messageEl, this.grid, this.sentinel]);
    this.el = h("div", { class: "page" }, [h("header", { class: "page-header" }, [back, h("h1", { class: "page-title", text: category.title })]), this.scroller]);
    const library = app.library;
    if (library) {
      library.start();
      this.unsubscribe = library.onChange(() => {
        if (this.loading && Date.now() - this.lastAsked >= ASK_AGAIN_MS) this.ask();
      });
    }
    this.ask();
    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && this.more(), { root: this.scroller, rootMargin: "0px 0px 800px 0px" });
      this.observer.observe(this.sentinel);
    }
  }

  destroy(): void {
    if (this.unsubscribe) this.unsubscribe();
    if (this.observer) this.observer.disconnect();
    window.clearTimeout(this.typingTimer);
  }

  private setQuery(text: string): void {
    const query = text.trim();
    if (query === this.query) return;
    this.query = query;
    this.ask();
  }

  private ask(): void {
    const library = this.app.library;
    if (!library) return;
    this.lastAsked = Date.now();
    const found = library.browse(this.category.kind, this.category.categoryId, LIMIT, this.query);
    this.loading = found.loading;
    if (this.query === "") this.allCount = found.total;
    this.show(found.items, found.total);
  }

  private show(items: Item[], total: number): void {
    // When the list grows behind a search, the posters already shown stay.
    const same = items.length >= this.shown && this.items.slice(0, this.shown).every((item, i) => items[i] && items[i].itemId === item.itemId);
    this.items = items;
    if (!same) {
      this.grid.textContent = "";
      this.shown = 0;
    }
    this.more();
    if (items.length === 0) {
      if (this.query !== "") setText(this.messageEl, "Nothing here matches “" + this.query + "”.");
      else if (this.loading) setText(this.messageEl, "Your library is still loading. This category's titles will appear here as they arrive.");
      else setText(this.messageEl, "Nothing in this category yet.");
      setText(this.countEl, "");
      return;
    }
    setText(this.messageEl, "");
    let text: string;
    if (this.query !== "") {
      text = commas(total) + " matching “" + this.query + "”";
      if (this.allCount >= 0) text += " of " + commas(this.allCount);
    } else {
      text = commas(total) + (total === 1 ? " title" : " titles") + ", newest first";
      if (items.length < total) text = "The newest " + commas(items.length) + " of " + commas(total) + " titles";
    }
    if (this.loading) text += ". Still loading your library.";
    setText(this.countEl, text);
  }

  // The next page of posters.
  private more(): void {
    const until = Math.min(this.items.length, this.shown + PAGE);
    const first = this.shown === 0;
    for (let i = this.shown; i < until; i++) this.grid.appendChild(posterEl(this.items[i], { open: (item) => this.app.push(new DetailsScreen(this.app, item)) }));
    // The first screenful builds in; more further down just appears as you scroll.
    if (first) stagger(this.grid.children, 12);
    this.shown = until;
  }
}
