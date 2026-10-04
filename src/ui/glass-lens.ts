// The tab bar's glass lens, after iOS 26's. At rest it's a quiet pill behind the tab
// you're on. Touch the bar and it lifts into a lens over the tab under your finger and
// magnifies what's beneath it, as a drop of glass would. Drag along the bar and it
// follows, stretching like rubber in the direction it's pulled (more the faster it
// goes, and more again pulled past either end, where it gives a little and resists);
// let go and it springs onto its tab and wobbles back into shape.
//
// The magnifying is a copy of the tabs inside the lens, moved and scaled so the point
// under the lens's middle stays put (shell.css); the lens and the copy move together.

import { h } from "./dom";

const INSET = 4; // the lens's gap from the bar's edge (shell.css)
const DRAG_START_PX = 8; // a press that moves this far is a drag, not a tap
const LIFT_X = 1.08; // lifted under a finger: a little bigger, more so in height
const LIFT_Y = 1.14;
const SPEED_STRETCH = 0.2; // stretch per px/ms of speed
const MAX_SPEED_STRETCH = 0.45;
const OVERPULL_GIVE = 0.22; // how far it follows a finger past the ends
const OVERPULL_STRETCH = 0.7; // stretch per lens-width pulled past the ends
const MAX_OVERPULL_STRETCH = 0.55;

export class GlassLens {
  readonly el: HTMLElement;
  private copies: HTMLElement[];
  private width = 0; // one tab's width, px
  private index = 0; // the tab it rests on
  private start = -1; // where the finger went down, or -1
  private dragging = false;
  private speed = 0; // px/ms, smoothed
  private lastX = 0;
  private lastAt = 0;
  private relax = 0; // the frame easing the stretch when the finger pauses
  private under = -1;
  private ignoreClicksUntil = 0;

  constructor(
    private bar: HTMLElement,
    private tabs: HTMLElement[],
    private pick: (index: number) => void,
  ) {
    this.copies = tabs.map((tab) => {
      const copy = h("div", { class: "tab-copy" });
      copy.innerHTML = tab.innerHTML;
      return copy;
    });
    this.el = h("div", { class: "tab-lens", attrs: { "aria-hidden": "true" } }, [h("div", { class: "tab-lens-view" }, this.copies)]);
    // Last, so the tabs stay the bar's first children (it's positioned on its own).
    bar.appendChild(this.el);
    if (typeof ResizeObserver === "function") new ResizeObserver(() => this.measure()).observe(bar);
    this.listen();
  }

  // The tab it rests on (the one you're on).
  moveTo(index: number): void {
    this.index = index;
    if (this.start < 0) this.settle();
  }

  // Tab classes (is-selected) shown in the lens too.
  mark(index: number, className: string, on: boolean): void {
    this.copies[index].classList.toggle(className, on);
  }

  private measure(): void {
    const width = (this.bar.clientWidth - 2 * INSET) / this.tabs.length;
    if (width <= 0) return;
    this.width = width;
    this.el.style.setProperty("--w", width + "px");
    this.el.style.setProperty("--h", this.el.offsetHeight + "px");
    if (this.start < 0) this.place(this.index * width, 1, 1, true);
  }

  // Where the lens is (`x` from the first tab, px) and its shape; `spring` eases it there
  // with the wobble, otherwise it keeps up with a finger.
  private place(x: number, sx: number, sy: number, spring: boolean): void {
    this.el.classList.toggle("is-following", !spring);
    this.el.style.setProperty("--t", x.toFixed(1) + "px");
    this.el.style.setProperty("--sx", sx.toFixed(3));
    this.el.style.setProperty("--sy", sy.toFixed(3));
  }

  private settle(): void {
    if (!this.width) this.measure();
    this.place(this.index * this.width, 1, 1, true);
  }

  private setUnder(index: number): void {
    if (index === this.under) return;
    this.tabs.forEach((tab, i) => {
      tab.classList.toggle("is-under", i === index);
      this.copies[i].classList.toggle("is-under", i === index);
    });
    this.under = index;
  }

  // The lens under a finger at `clientX`: following it, stretched by its speed and by
  // how far past either end it's pulled.
  private follow(clientX: number): void {
    const rect = this.bar.getBoundingClientRect();
    const width = this.width;
    const last = (this.tabs.length - 1) * width;
    const wanted = clientX - rect.left - INSET - width / 2;
    const over = wanted < 0 ? wanted : wanted > last ? wanted - last : 0;
    const x = Math.max(0, Math.min(last, wanted)) + over * OVERPULL_GIVE;
    const stretch = 1 + Math.min(MAX_SPEED_STRETCH, Math.abs(this.speed) * SPEED_STRETCH) + Math.min(MAX_OVERPULL_STRETCH, (Math.abs(over) / width) * OVERPULL_STRETCH);
    // Longer one way, thinner the other, as a stretched drop is.
    this.place(x, LIFT_X * stretch, LIFT_Y / Math.sqrt(stretch), false);
    this.setUnder(Math.round(Math.max(0, Math.min(last, wanted)) / width));
  }

  private listen(): void {
    const bar = this.bar;
    bar.addEventListener(
      "click",
      (event) => {
        if (Date.now() < this.ignoreClicksUntil) event.stopPropagation();
      },
      { capture: true },
    );
    bar.addEventListener("pointerdown", (event) => {
      if (!this.width) this.measure();
      if (!this.width) return;
      this.start = event.clientX;
      this.dragging = false;
      this.speed = 0;
      this.lastX = event.clientX;
      this.lastAt = event.timeStamp;
      bar.classList.add("is-pressed");
      // It lifts over the tab touched, and magnifies it.
      const rect = bar.getBoundingClientRect();
      const touched = Math.max(0, Math.min(this.tabs.length - 1, Math.floor((event.clientX - rect.left - INSET) / this.width)));
      this.setUnder(touched);
      this.place(touched * this.width, LIFT_X, LIFT_Y, true);
    });
    bar.addEventListener("pointermove", (event) => {
      if (this.start < 0) return;
      if (!this.dragging && Math.abs(event.clientX - this.start) < DRAG_START_PX) return;
      if (!this.dragging) {
        this.dragging = true;
        bar.setPointerCapture(event.pointerId);
        this.relaxLoop();
      }
      const dt = Math.max(1, event.timeStamp - this.lastAt);
      this.speed = this.speed * 0.6 + ((event.clientX - this.lastX) / dt) * 0.4;
      this.lastX = event.clientX;
      this.lastAt = event.timeStamp;
      this.follow(event.clientX);
    });
    const end = (event: PointerEvent, cancelled: boolean) => {
      if (this.start < 0) return;
      const dragged = this.dragging;
      this.start = -1;
      this.dragging = false;
      window.cancelAnimationFrame(this.relax);
      bar.classList.remove("is-pressed");
      const under = this.under;
      this.setUnder(-1);
      if (dragged && !cancelled) {
        // The click that ends a drag isn't a tap.
        this.ignoreClicksUntil = Date.now() + 400;
        if (under >= 0 && under !== this.index) this.pick(under);
      }
      // Onto its tab (a tap's click picks it straight after), wobbling back into shape.
      this.settle();
      void event;
    };
    bar.addEventListener("pointerup", (event) => end(event, false));
    bar.addEventListener("pointercancel", (event) => end(event, true));
  }

  // While dragging: when the finger slows or pauses, the stretch eases off.
  private relaxLoop(): void {
    const step = () => {
      if (!this.dragging) return;
      if (performance.now() - this.lastAt > 40) {
        this.speed *= 0.82;
        this.follow(this.lastX);
      }
      this.relax = window.requestAnimationFrame(step);
    };
    this.relax = window.requestAnimationFrame(step);
  }
}
