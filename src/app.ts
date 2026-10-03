// The screen stack: the tabs at the bottom, then Details, a category's page, Settings
// and the player on top, as in the TV apps. Each screen pushed is also a step in the
// browser's history, so Safari's swipe back (and Android's back button) closes it like
// the on-screen back button does. Action sheets and short notes sit over everything.

import { log } from "./core/log";
import { accountCreds, syncConfig } from "./core/personal";
import { credsSecrets, Secret, setSecrets } from "./core/redact";
import { readOsFields } from "./core/storage";
import type { Creds } from "./core/utils";
import { XtreamApi } from "./data/api";
import { helperKey } from "./data/helper";
import { SearchLibrary } from "./data/library";
import { ProgressSync } from "./data/sync";
import { h, onTap, setText, toggle } from "./ui/dom";
import { morph, reducedMotion } from "./ui/motion";

const LEAVE_MS = 260; // a closing screen's slide out (base.css)

export interface Screen {
  readonly el: HTMLElement;
  // A page that grows out of what was tapped (Details out of its poster): `morphFrom` on
  // the screen below, `morphTo` on this one, and back again when it closes.
  readonly morphFrom?: HTMLElement | null;
  readonly morphTo?: HTMLElement | null;
  // Called each time the screen comes back to the top (after Details closes, say).
  onShow?(): void;
  onHide?(): void;
  destroy?(): void;
}

export interface SheetButton {
  label: string;
  action?: () => void;
  style?: "danger" | "primary";
}

export interface SheetOptions {
  title?: string;
  message?: string;
  buttons: SheetButton[];
  cancel?: string; // "" for no Cancel button
}

export class App {
  private stack: Screen[] = [];
  // A page change waiting for Safari to picture the page as it was (a frame or so, while
  // a poster grows), and the changes asked for meanwhile, done after it in order.
  private waiting = false;
  private queued: (() => void)[] = [];
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private sheetEl: HTMLElement | null = null;
  api: XtreamApi | null = null;
  // The whole library for this account: searched, browsed by category and counted. It
  // starts on the first search, category page or Categories tab.
  library: SearchLibrary | null = null;
  // Continue Watching between devices, when the helper's personal.json has "sync".
  sync: ProgressSync | null = null;

  constructor(readonly root: HTMLElement) {
    this.toastEl = h("div", { class: "toast", attrs: { role: "status" } });
    root.appendChild(this.toastEl);
    window.addEventListener("popstate", (event) => {
      const state = event.state as { aranplus?: number } | null;
      const depth = state && typeof state.aranplus === "number" ? state.aranplus : 0;
      if (this.sheetEl) this.closeSheet();
      this.inTurn(() => {
        // One screen back grows back into its poster; several at once just close.
        const count = this.stack.length - 1 - depth;
        for (let i = 0; i < count && this.stack.length > 1; i++) this.popNow(count === 1);
      });
    });
    try {
      window.history.replaceState({ aranplus: 0 }, "");
    } catch {
      // History isn't available (a sandboxed frame); the back buttons still work.
    }
  }

  get top(): Screen | null {
    return this.stack.length ? this.stack[this.stack.length - 1] : null;
  }

  // Sets the account every screen uses, and what the logs must hide.
  useAccount(creds: Creds | null): void {
    if (this.library) this.library.stop();
    if (this.sync) this.sync.stop();
    this.api = creds ? new XtreamApi(creds) : null;
    this.library = this.api ? new SearchLibrary(this.api) : null;
    this.sync = ProgressSync.forCreds(creds);
    if (this.sync) this.sync.now(); // at launch
    this.refreshSecrets();
  }

  // What logs and on-screen messages must hide; again after the OpenSubtitles details
  // change.
  refreshSecrets(): void {
    const creds = accountCreds();
    const secrets: Secret[] = creds ? credsSecrets(creds.server, creds.username, "") : [];
    const os = readOsFields();
    secrets.push({ value: os.apiKey, label: "<api key>" }, { value: os.username, label: "<os user>" }, { value: os.password, label: "<os password>" });
    const sync = syncConfig();
    if (sync) secrets.push({ value: sync.key, label: "<sync key>" });
    secrets.push({ value: helperKey(), label: "<helper key>" });
    setSecrets(secrets);
  }

  push(screen: Screen): void {
    this.inTurn(() => {
      // Grown out of the poster where Safari can; slid in otherwise (the CSS).
      if (this.stack.length > 0 && screen.morphFrom && screen.morphTo) {
        screen.el.classList.add("is-morphed");
        if (this.morphing(screen.morphFrom, screen.morphTo, () => this.place(screen))) return;
        screen.el.classList.remove("is-morphed");
      }
      this.place(screen);
    });
  }

  // Page changes happen one after another, never while one waits for Safari.
  private inTurn(change: () => void): void {
    if (this.waiting) this.queued.push(change);
    else change();
  }

  private morphing(from: HTMLElement, to: HTMLElement, update: () => void): boolean {
    this.waiting = true;
    const started = morph(from, to, () => {
      this.waiting = false;
      update();
      const queued = this.queued;
      this.queued = [];
      for (const change of queued) this.inTurn(change);
    });
    if (!started) this.waiting = false;
    return started;
  }

  private place(screen: Screen): void {
    const below = this.top;
    if (below) {
      if (below.onHide) below.onHide();
      below.el.classList.add("is-covered");
    }
    this.stack.push(screen);
    screen.el.classList.add("screen");
    this.root.insertBefore(screen.el, this.toastEl);
    if (this.stack.length > 1) {
      try {
        window.history.pushState({ aranplus: this.stack.length - 1 }, "");
      } catch {
        // See the constructor.
      }
    }
    if (screen.onShow) screen.onShow();
  }

  // The on-screen back button: through history, so Safari's own back stays in step.
  back(): void {
    if (this.stack.length <= 1) return;
    const state = window.history.state as { aranplus?: number } | null;
    if (state && typeof state.aranplus === "number" && state.aranplus === this.stack.length - 1) window.history.back();
    else this.inTurn(() => this.popNow(true));
  }

  private popNow(mayMorph: boolean): void {
    if (this.stack.length <= 1) return;
    const top = this.stack[this.stack.length - 1];
    // Back into the poster it grew out of, when that's still there.
    if (mayMorph && top.morphFrom && top.morphTo && this.morphing(top.morphTo, top.morphFrom, () => this.unplace(false))) return;
    this.unplace(mayMorph && !reducedMotion());
  }

  // Closes the top screen; with `animate`, it slides away over the one below.
  private unplace(animate: boolean): void {
    const top = this.stack.pop() as Screen;
    if (top.onHide) top.onHide();
    if (top.destroy) top.destroy();
    const below = this.top as Screen;
    below.el.classList.remove("is-covered");
    if (animate && top.el.parentNode) {
      top.el.classList.add("is-leaving");
      window.setTimeout(() => top.el.parentNode && top.el.parentNode.removeChild(top.el), LEAVE_MS);
    } else if (top.el.parentNode) top.el.parentNode.removeChild(top.el);
    if (below.onShow) below.onShow();
  }

  resetTo(screen: Screen): void {
    this.inTurn(() => this.resetNow(screen));
  }

  private resetNow(screen: Screen): void {
    while (this.stack.length) {
      const s = this.stack.pop() as Screen;
      if (s.onHide) s.onHide();
      if (s.destroy) s.destroy();
      if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
    }
    try {
      window.history.replaceState({ aranplus: 0 }, "");
    } catch {
      // See the constructor.
    }
    this.place(screen);
  }

  // A short note at the bottom of the screen.
  toast(text: string, ms = 3500): void {
    setText(this.toastEl, text);
    toggle(this.toastEl, "is-visible", true);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toggle(this.toastEl, "is-visible", false), ms);
  }

  // An action sheet from the bottom: a title, a message and buttons, with Cancel last.
  sheet(options: SheetOptions): void {
    this.closeSheet();
    const panel = h("div", { class: "sheet-panel", attrs: { role: "dialog", "aria-modal": "true" } });
    if (options.title) panel.appendChild(h("div", { class: "sheet-title", text: options.title }));
    if (options.message) panel.appendChild(h("div", { class: "sheet-message", text: options.message }));
    for (const button of options.buttons) {
      const el = h("button", { class: "sheet-button" + (button.style ? " is-" + button.style : ""), text: button.label, attrs: { type: "button" } });
      onTap(el, () => {
        this.closeSheet();
        if (button.action) button.action();
      });
      panel.appendChild(el);
    }
    const cancel = options.cancel === undefined ? "Cancel" : options.cancel;
    if (cancel) panel.appendChild(onTap(h("button", { class: "sheet-button is-cancel", text: cancel, attrs: { type: "button" } }), () => this.closeSheet()));
    const shade = onTap(h("div", { class: "sheet-shade" }), () => this.closeSheet());
    const sheet = h("div", { class: "sheet" }, [shade, panel]);
    this.sheetEl = sheet;
    this.root.appendChild(sheet);
    // Next frame, so it slides in.
    window.requestAnimationFrame(() => toggle(sheet, "is-open", true));
  }

  closeSheet(): void {
    const sheet = this.sheetEl;
    if (!sheet) return;
    this.sheetEl = null;
    toggle(sheet, "is-open", false);
    window.setTimeout(() => sheet.parentNode && sheet.parentNode.removeChild(sheet), 250);
  }

  // Set by main.ts: the helper turned this phone away (a new key is needed).
  onDisconnected: (reason: string) => void = (reason) => log("disconnected:", reason);
}
