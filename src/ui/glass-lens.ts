// The tab bar's glass lens, after iOS 26's. At rest it's a quiet pill behind the tab
// you're on. Touch the bar and the bar swells, and the pill lifts into a lens over the
// tab under your finger, bigger than the bar, magnifying what's beneath it as a drop of
// glass would. Drag along the bar and it follows, stretching like rubber in the direction
// it's pulled (more the faster it goes, and more again pulled past either end, where it
// gives a little and resists); let go and it springs onto its tab and wobbles back into
// shape. A quick tap still shows the glass: it stays lifted a moment before settling.
//
// The magnifying is a copy of the tabs inside the lens, moved and scaled so the point
// under the lens's middle stays put (shell.css); the lens and the copy move together.

import { h } from "./dom";

const INSET = 4; // the lens's gap from the bar's edge (shell.css)
const DRAG_START_PX = 8; // a press that moves this far is a drag, not a tap
const LIFT_X = 1.15; // lifted under a finger: bigger, more so in height (past the bar's edges)
const LIFT_Y = 1.26;
const SWELL = 1.04; // the bar grows this much while pressed (shell.css, .tab-bar.is-pressed)
const MIN_LIFT_MS = 240; // a tap keeps the lens lifted at least this long
const FOLLOW_MS = 26; // how closely it keeps up with the finger (a time constant)
const SPEED_STRETCH = 0.22; // stretch per px/ms of its speed
const MAX_SPEED_STRETCH = 0.45;
const STRETCH_MS = 70; // how quickly the stretch comes and goes
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
  private pressedAt = 0;
  private releaseTimer = 0; // a tap's lift, still showing
  private barMid = 0; // the bar's middle on screen, when the finger went down
  private fingerX = 0; // where the finger is now
  private x = 0; // where the lens is now (px from the first tab), while following
  private speed = 0; // its speed, px/ms, smoothed
  private stretch = 1;
  private frame = 0;
  private lastFrame = 0;
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
    if (this.start < 0 && !this.releaseTimer) this.settle();
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
    if (this.start < 0) this.place(this.index * width, 1, 1);
  }

  // Where the lens is (`x` from the first tab, px) and its shape. Springing (the CSS)
  // unless it's following a finger, when it's moved every frame instead.
  private place(x: number, sx: number, sy: number): void {
    this.el.style.setProperty("--t", x.toFixed(1) + "px");
    this.el.style.setProperty("--sx", sx.toFixed(3));
    this.el.style.setProperty("--sy", sy.toFixed(3));
  }

  private settle(): void {
    if (!this.width) this.measure();
    this.el.classList.remove("is-following");
    this.place(this.index * this.width, 1, 1);
  }

  private setUnder(index: number): void {
    if (index === this.under) return;
    this.tabs.forEach((tab, i) => {
      tab.classList.toggle("is-under", i === index);
      this.copies[i].classList.toggle("is-under", i === index);
    });
    this.under = index;
  }

  // A point on screen as px along the bar (unscaled), with the bar grown by `scale`
  // around its middle.
  private along(clientX: number, scale: number): number {
    return (clientX - this.barMid) / scale + this.bar.offsetWidth / 2;
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
      if (this.start >= 0) return; // a second finger
      if (!this.width) this.measure();
      if (!this.width) return;
      window.clearTimeout(this.releaseTimer);
      this.releaseTimer = 0;
      this.start = event.clientX;
      this.fingerX = event.clientX;
      this.dragging = false;
      this.pressedAt = performance.now();
      const box = bar.getBoundingClientRect();
      this.barMid = box.left + box.width / 2;
      // Where the finger is on the bar as it looks now (it may still be shrinking back).
      const scaleNow = bar.offsetWidth > 0 ? box.width / bar.offsetWidth : 1;
      bar.classList.add("is-pressed");
      // It lifts over the tab touched, and magnifies it.
      const touched = Math.max(0, Math.min(this.tabs.length - 1, Math.floor((this.along(event.clientX, scaleNow) - INSET) / this.width)));
      this.setUnder(touched);
      this.el.classList.remove("is-following");
      this.place(touched * this.width, LIFT_X, LIFT_Y);
    });
    bar.addEventListener("pointermove", (event) => {
      if (this.start < 0) return;
      this.fingerX = event.clientX;
      if (!this.dragging && Math.abs(event.clientX - this.start) >= DRAG_START_PX) this.startFollowing(event.pointerId);
    });
    // Safari may take a touch back (pointercancel) as it ends; a drag still chooses the
    // tab it was dragged to.
    bar.addEventListener("pointerup", () => this.end());
    bar.addEventListener("pointercancel", () => this.end());
  }

  // From here the lens is moved every frame, after the finger: no transitions to restart
  // on every movement, which made it hitch.
  private startFollowing(pointerId: number): void {
    this.dragging = true;
    try {
      this.bar.setPointerCapture(pointerId);
    } catch {
      // Not ours to capture; the bar still hears it.
    }
    // From wherever it is now (it may be springing to the tab first touched).
    const now = parseFloat(getComputedStyle(this.el).getPropertyValue("translate"));
    this.x = isFinite(now) ? now : this.under * this.width;
    this.speed = 0;
    this.stretch = 1;
    this.el.classList.add("is-following");
    this.lastFrame = performance.now();
    const step = (time: number) => {
      if (!this.dragging) return;
      this.follow(Math.min(50, Math.max(1, time - this.lastFrame)));
      this.lastFrame = time;
      this.frame = window.requestAnimationFrame(step);
    };
    this.frame = window.requestAnimationFrame(step);
  }

  // One frame of following: towards the finger, stretched by its speed and by how far
  // past either end it's pulled.
  private follow(dt: number): void {
    const width = this.width;
    const last = (this.tabs.length - 1) * width;
    const wanted = this.along(this.fingerX, SWELL) - INSET - width / 2;
    const over = wanted < 0 ? wanted : wanted > last ? wanted - last : 0;
    const target = Math.max(0, Math.min(last, wanted)) + over * OVERPULL_GIVE;
    const next = this.x + (target - this.x) * (1 - Math.exp(-dt / FOLLOW_MS));
    this.speed = this.speed * 0.7 + ((next - this.x) / dt) * 0.3;
    this.x = next;
    const goal = 1 + Math.min(MAX_SPEED_STRETCH, Math.abs(this.speed) * SPEED_STRETCH) + Math.min(MAX_OVERPULL_STRETCH, (Math.abs(over) / width) * OVERPULL_STRETCH);
    this.stretch += (goal - this.stretch) * (1 - Math.exp(-dt / STRETCH_MS));
    // Longer one way, thinner the other, as a stretched drop is.
    this.place(this.x, LIFT_X * this.stretch, LIFT_Y / Math.sqrt(this.stretch));
    this.setUnder(Math.round(Math.max(0, Math.min(last, wanted)) / width));
  }

  private end(): void {
    if (this.start < 0) return;
    const dragged = this.dragging;
    this.start = -1;
    this.dragging = false;
    window.cancelAnimationFrame(this.frame);
    const under = this.under;
    if (dragged) {
      // The click that ends a drag isn't a tap.
      this.ignoreClicksUntil = Date.now() + 400;
      if (under >= 0 && under !== this.index) this.pick(under);
      return this.release();
    }
    // A tap's click picks its tab straight after; the lens stays lifted over it long
    // enough to be seen, then settles.
    const left = MIN_LIFT_MS - (performance.now() - this.pressedAt);
    if (left > 0) this.releaseTimer = window.setTimeout(() => this.release(), left);
    else this.release();
  }

  // Onto its tab, wobbling back into shape, as the bar shrinks back.
  private release(): void {
    this.releaseTimer = 0;
    this.bar.classList.remove("is-pressed");
    this.setUnder(-1);
    this.settle();
  }
}
