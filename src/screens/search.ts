// Search (the TV apps' SearchScreen, docs/features.md §6 in the Roku repo): the phone's
// own keyboard, and rows that update as you type: Categories whose name matches (so
// "punjabi" reaches every Punjabi title), then Movies, then Series. Every word typed
// must appear; one or two letters only match the start of a word. Matching ignores
// capitals, accents and most punctuation. The whole library is searched, from the copy
// stored on the phone; the line under the box says how far loading has got.

import type { App } from "../app";
import type { Item } from "../core/items";
import { libraryStatusText } from "../core/search";
import { h, setText, toggle } from "../ui/dom";
import { rowEl } from "../ui/poster";
import { CategoryScreen } from "./category";
import { DetailsScreen } from "./details";

const TYPING_MS = 300;
const ROW_LIMIT = 40;
const REFRESH_MS = 1500; // while the library grows

export class SearchView {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private statusEl: HTMLElement;
  private results: HTMLElement;
  private query = "";
  private typingTimer = 0;
  private refreshTimer = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(private app: App) {
    this.input = h("input", {
      class: "field search-field",
      attrs: { type: "search", placeholder: "Titles and categories", enterkeyhint: "search", autocapitalize: "off", autocorrect: "off", spellcheck: "false", "aria-label": "Search" },
    });
    this.input.addEventListener("input", () => {
      window.clearTimeout(this.typingTimer);
      this.typingTimer = window.setTimeout(() => this.setQuery(this.input.value), TYPING_MS);
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.input.blur();
    });
    this.statusEl = h("div", { class: "search-status" });
    this.results = h("div", { class: "rows" });
    this.el = h("div", { class: "view search" }, [h("h1", { class: "view-title", text: "Search" }), this.input, this.statusEl, this.results]);
  }

  onShow(): void {
    const library = this.app.library;
    if (!library) return;
    library.start();
    if (!this.unsubscribe) this.unsubscribe = library.onChange(() => this.refreshSoon());
    this.showStatus();
  }

  // The tab was tapped again: the keyboard comes up.
  focus(): void {
    this.input.focus();
  }

  private setQuery(text: string): void {
    const query = text.trim();
    if (query === this.query) return;
    this.query = query;
    this.search();
  }

  private refreshSoon(): void {
    this.showStatus();
    if (this.refreshTimer || this.query === "") return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = 0;
      this.search();
    }, REFRESH_MS);
  }

  private showStatus(): void {
    const library = this.app.library;
    if (library) setText(this.statusEl, libraryStatusText(library.status));
  }

  private search(): void {
    const library = this.app.library;
    this.results.textContent = "";
    if (!library || this.query === "") return;
    const rows = library.search(this.query, ROW_LIMIT);
    toggle(this.results, "is-empty", rows.length === 0);
    if (rows.length === 0) {
      this.results.appendChild(h("p", { class: "view-intro", text: library.loading ? "Nothing yet for “" + this.query + "”. Your library is still loading." : "Nothing matches “" + this.query + "”." }));
      return;
    }
    for (const row of rows) this.results.appendChild(rowEl(row.title, row.items, { open: (item) => this.open(item) }, row.title === "Categories" ? "is-categories" : "").el);
  }

  private open(item: Item): void {
    this.input.blur();
    if (item.kind === "category") {
      this.app.push(new CategoryScreen(this.app, { kind: item.listKind === "series" ? "series" : "movie", categoryId: item.categoryId, title: item.title + (item.listKind === "series" ? "  ·  Series" : "  ·  Movies") }));
      return;
    }
    this.app.push(new DetailsScreen(this.app, item));
  }
}
