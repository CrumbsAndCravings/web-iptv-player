// The tab bar's glass lens, after iOS 26's. At rest it's a quiet pill behind the tab
// you're on. Touch the bar and the bar swells, and the pill lifts into a lens over the
// tab under your finger, bigger than the bar, magnifying what's beneath it as a drop of
// glass would. Drag along the bar and it follows, stretching like rubber in the direction
// it's pulled (more the faster it goes, and more again pulled past either end, where it
// gives less the further it goes); let go and it carries on at the speed it had, landing
// where a flick would carry it, and wobbles back into shape. A quick tap still shows the
// glass: it stays lifted a moment before settling.
//
// It moves on springs, as Apple's do (spring.ts): always from where it is and at the
// speed it has, so it can be caught mid-flight; settling without overshoot unless a drag
// gave it momentum. The magnifying is a copy of the tabs inside the lens, moved and
// scaled so the point under the lens's middle stays put (shell.css).

import { h } from "./dom";
import { reducedMotion } from "./motion";
import { project, rubberBand, Spring, VelocityTracker } from "./spring";

const INSET = 4; // the lens's gap from the bar's edge (shell.css)
const DRAG_START_PX = 8; // a press that moves this far is a drag, not a tap
const LIFT_X = 1.15; // lifted under a finger: bigger, more so in height (past the bar's edges)
const LIFT_Y = 1.26;
const SWELL = 1.04; // the bar grows this much while pressed (shell.css, .tab-bar.is-pressed)
const MIN_LIFT_MS = 240; // a tap keeps the lens lifted at least this long
const SPEED_STRETCH = 0.22; // stretch per px/ms of its speed
const MAX_SPEED_STRETCH = 0.45;
const STRETCH_MS = 70; // how quickly the stretch comes and goes
const OVERPULL_STRETCH = 0.7; // stretch per lens-width pulled past the ends
const MAX_OVERPULL_STRETCH = 0.55;
const FLICK_RATE = 0.99; // how far a flick carries on: a snappy scroll's deceleration

// Springs as { damping ratio, response in seconds }. Between tabs and back into shape
// it settles without overshoot; it bounces only where a gesture gave it momentum.
interface SpringParams {
  damping: number;
  response: number;
}
const FOLLOW: SpringParams = { damping: 1, response: 0.09 }; // after the finger, a hair behind
const SLIDE: SpringParams = { damping: 1, response: 0.38 };
const SLIDE_AFTER_DRAG: SpringParams = { damping: 0.8, response: 0.38 };
const LIFT: SpringParams = { damping: 0.8, response: 0.3 };
const SETTLE: SpringParams = { damping: 1, response: 0.35 };
const WOBBLE: SpringParams = { damping: 0.6, response: 0.42 };

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
  private finger = new VelocityTracker();
  private x = new Spring(0, 0.05); // where the lens is (px from the first tab)
  private sx = new Spring(1, 0.0005); // its shape
  private sy = new Spring(1, 0.0005);
  private speed = 0; // its speed while following, px/ms, smoothed
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
    if (this.start < 0 && !this.releaseTimer) this.settle(SLIDE, SETTLE);
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
    if (this.start < 0 && !this.releaseTimer) {
      this.x.set(this.index * width);
      this.sx.set(1);
      this.sy.set(1);
      this.place();
    }
  }

  // Where the lens is and its shape, as the springs have them.
  private place(): void {
    this.el.style.setProperty("--t", this.x.value.toFixed(1) + "px");
    this.el.style.setProperty("--sx", this.sx.value.toFixed(3));
    this.el.style.setProperty("--sy", this.sy.value.toFixed(3));
  }

  // A spring towards `target`; with Reduce Motion, straight there.
  private aim(spring: Spring, target: number, params: SpringParams): void {
    if (reducedMotion()) spring.set(target);
    else spring.to(target, params.damping, params.response);
  }

  // Runs the springs, or follows the finger, every frame until everything is still.
  private kick(): void {
    if (this.frame) return;
    this.lastFrame = performance.now();
    const step = (time: number) => {
      const ms = Math.min(50, Math.max(1, time - this.lastFrame));
      this.lastFrame = time;
      let moving = this.dragging;
      if (this.dragging) this.follow(ms);
      else for (const spring of [this.x, this.sx, this.sy]) moving = spring.step(ms / 1000) || moving;
      this.place();
      this.frame = moving ? window.requestAnimationFrame(step) : 0;
    };
    this.frame = window.requestAnimationFrame(step);
  }

  // Onto its tab and back into shape.
  private settle(slide: SpringParams, shape: SpringParams): void {
    if (!this.width) this.measure();
    if (!this.width) return;
    this.aim(this.x, this.index * this.width, slide);
    this.aim(this.sx, 1, shape);
    this.aim(this.sy, 1, shape);
    this.kick();
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
      this.finger.reset();
      this.finger.add(event.clientX, performance.now());
      this.dragging = false;
      this.pressedAt = performance.now();
      const box = bar.getBoundingClientRect();
      this.barMid = box.left + box.width / 2;
      // Where the finger is on the bar as it looks now (it may still be shrinking back).
      const scaleNow = bar.offsetWidth > 0 ? box.width / bar.offsetWidth : 1;
      bar.classList.add("is-pressed");
      // It lifts over the tab touched, and magnifies it: from wherever it is, even
      // mid-flight.
      const touched = Math.max(0, Math.min(this.tabs.length - 1, Math.floor((this.along(event.clientX, scaleNow) - INSET) / this.width)));
      this.setUnder(touched);
      this.aim(this.x, touched * this.width, SLIDE);
      this.aim(this.sx, LIFT_X, LIFT);
      this.aim(this.sy, LIFT_Y, LIFT);
      this.kick();
    });
    bar.addEventListener("pointermove", (event) => {
      if (this.start < 0) return;
      this.fingerX = event.clientX;
      this.finger.add(event.clientX, performance.now());
      if (!this.dragging && Math.abs(event.clientX - this.start) >= DRAG_START_PX) this.startFollowing(event.pointerId);
    });
    // Safari may take a touch back (pointercancel) as it ends; a drag still chooses the
    // tab it was dragged to.
    bar.addEventListener("pointerup", () => this.end());
    bar.addEventListener("pointercancel", () => this.end());
  }

  // From here the lens follows the finger on a stiff spring, from wherever it is and at
  // the speed it has, so catching up with a finger far away is smooth too.
  private startFollowing(pointerId: number): void {
    this.dragging = true;
    try {
      this.bar.setPointerCapture(pointerId);
    } catch {
      // Not ours to capture; the bar still hears it.
    }
    this.speed = this.x.velocity / 1000;
    this.stretch = 1;
    this.kick();
  }

  // One frame of following: towards the finger, stretched by its speed and by how far
  // past either end it's pulled.
  private follow(ms: number): void {
    const width = this.width;
    const last = (this.tabs.length - 1) * width;
    const wanted = this.along(this.fingerX, SWELL) - INSET - width / 2;
    const over = wanted < 0 ? wanted : wanted > last ? wanted - last : 0;
    const target = Math.max(0, Math.min(last, wanted)) + rubberBand(over, width);
    // Far behind the finger (a drag begun on another tab), it catches up about as fast as
    // it slides between tabs, then keeps close.
    const behind = Math.max(0, Math.min(1, (Math.abs(target - this.x.value) - width / 2) / width));
    this.x.to(target, FOLLOW.damping, FOLLOW.response + behind * (SLIDE.response - FOLLOW.response) * 0.6);
    this.x.step(ms / 1000);
    this.speed = this.speed * 0.7 + (this.x.velocity / 1000) * 0.3;
    const goal = 1 + Math.min(MAX_SPEED_STRETCH, Math.abs(this.speed) * SPEED_STRETCH) + Math.min(MAX_OVERPULL_STRETCH, (Math.abs(over) / width) * OVERPULL_STRETCH);
    this.stretch += (goal - this.stretch) * (1 - Math.exp(-ms / STRETCH_MS));
    // Longer one way, thinner the other, as a stretched drop is; the shape keeps its
    // speed too, so letting go doesn't snap it.
    const sx = LIFT_X * this.stretch;
    const sy = LIFT_Y / Math.sqrt(this.stretch);
    this.sx.set(sx, ((sx - this.sx.value) / ms) * 1000);
    this.sy.set(sy, ((sy - this.sy.value) / ms) * 1000);
    this.setUnder(Math.round(Math.max(0, Math.min(last, wanted)) / width));
  }

  private end(): void {
    if (this.start < 0) return;
    const dragged = this.dragging;
    this.start = -1;
    this.dragging = false;
    if (dragged) {
      // The click that ends a drag isn't a tap.
      this.ignoreClicksUntil = Date.now() + 400;
      // It lands where the flick would carry it, not just where the finger let go.
      const last = (this.tabs.length - 1) * this.width;
      const carried = this.x.value + project(this.finger.velocity(performance.now()) / SWELL, FLICK_RATE);
      const landing = Math.round(Math.max(0, Math.min(last, carried)) / this.width);
      if (landing !== this.index) this.pick(landing);
      return this.release(true);
    }
    // A tap's click picks its tab straight after; the lens stays lifted over it long
    // enough to be seen, then settles.
    const left = MIN_LIFT_MS - (performance.now() - this.pressedAt);
    if (left > 0) this.releaseTimer = window.setTimeout(() => this.release(false), left);
    else this.release(false);
  }

  // Onto its tab as the bar shrinks back: after a drag at the speed it had, overshooting
  // a touch and wobbling back into shape; after a tap, smoothly.
  private release(afterDrag: boolean): void {
    this.releaseTimer = 0;
    this.bar.classList.remove("is-pressed");
    this.setUnder(-1);
    this.settle(afterDrag ? SLIDE_AFTER_DRAG : SLIDE, afterDrag ? WOBBLE : SETTLE);
  }
}
