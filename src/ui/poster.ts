// Poster tiles for rows, grids and search, in the TV apps' look: sharp corners, posters
// close together, a pink progress strip along the bottom for Continue Watching and
// badges ("S1:E4") on a dark band at the bottom of the poster. Placeholders pulse while
// a row loads. Category and See all cards are the name on a tinted card. Nothing is
// marked "Won't play": the helper on your computer converts whatever Safari can't play.

import { Item, makeItem } from "../core/items";
import { h, onHold, onTap } from "./dom";
import { ICONS } from "./icons";

export interface PosterActions {
  open(item: Item): void;
  // A long press (or the ⋯ button) on a Continue Watching poster.
  more?(item: Item): void;
}

function image(src: string, className: string): HTMLImageElement | null {
  if (!src) return null;
  const img = h("img", { class: className, attrs: { alt: "", loading: "lazy", decoding: "async", draggable: "false" } });
  img.onerror = () => img.parentNode && img.parentNode.removeChild(img);
  img.src = src;
  return img;
}

export function posterEl(item: Item, actions: PosterActions): HTMLElement {
  if (item.placeholder) return h("div", { class: "poster is-placeholder" }, [h("div", { class: "poster-card" })]);
  if (item.kind === "seeAll") {
    const tile = h("button", { class: "poster is-see-all", attrs: { type: "button" } }, [h("div", { class: "poster-card" }, [h("span", { text: "See all" })])]);
    tile.querySelector(".poster-card")!.insertAdjacentHTML("beforeend", ICONS.chevron);
    return onTap(tile, () => actions.open(item));
  }
  if (item.kind === "category") {
    const card = h("div", { class: "poster-card" }, [h("div", { class: "poster-category-name", text: item.title }), h("div", { class: "poster-category-caption", text: item.caption })]);
    return onTap(h("button", { class: "poster is-category", attrs: { type: "button" } }, [card]), () => actions.open(item));
  }
  const card = h("div", { class: "poster-card" }, [h("div", { class: "poster-fallback", text: item.title }), image(item.poster, "poster-img")]);
  if (item.caption) card.appendChild(h("div", { class: "poster-badge" + (item.progress > 0 ? " has-progress" : ""), text: item.caption }));
  if (item.progress > 0) {
    card.appendChild(h("div", { class: "poster-progress" }, [h("div", { class: "poster-fill", attrs: { style: "width:" + Math.round(item.progress * 100) + "%" } })]));
  }
  const tile = h("button", { class: "poster", attrs: { type: "button", "aria-label": item.title } }, [card]);
  onTap(tile, () => actions.open(item));
  const more = actions.more;
  if (more) {
    onHold(tile, 550, () => more(item));
    const button = h("span", { class: "poster-more", attrs: { role: "button", "aria-label": "More for " + item.title } });
    button.innerHTML = ICONS.more;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      more(item);
    });
    tile.appendChild(button);
  }
  return tile;
}

// A row: its title, then posters that scroll sideways.
export function rowEl(title: string, items: Item[], actions: PosterActions, className = ""): { el: HTMLElement; strip: HTMLElement; fill(items: Item[]): void } {
  const strip = h("div", { class: "row-strip" });
  const fill = (list: Item[]) => {
    while (strip.firstChild) strip.removeChild(strip.firstChild);
    for (const item of list) strip.appendChild(posterEl(item, actions));
  };
  fill(items);
  const el = h("section", { class: "row" + (className ? " " + className : "") }, [h("h2", { class: "row-title", text: title }), strip]);
  return { el, strip, fill };
}

export function placeholders(count = 6): Item[] {
  const list: Item[] = [];
  for (let i = 0; i < count; i++) list.push(makeItem({ placeholder: true }));
  return list;
}
