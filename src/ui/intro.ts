// The intro when ARAN+ opens, with its sting (sting.ts): ARAN+'s own take on a streaming
// service's opening. A soft knock and the plus pulses; a boom and ARAN punches in out of a
// glow, light rays bursting out behind it; the plus spins and sparks with two pings;
// then, once Home has something to show (it loads underneath meanwhile), the intro flies
// through the plus into it.
//
// It plays by itself. iPhones keep a web page quiet until it's been touched, so at launch
// the sting is tried and usually goes unheard there; Settings' Play it now (a tap) plays
// it with sound. Settings can also turn the intro off.

import { loadPrefs } from "../core/storage";
import { h } from "./dom";
import { openStingAudio, playSting, playWhoosh, StingAudio } from "./sting";

export type IntroMode = "on" | "off";

export function introMode(): IntroMode {
  return loadPrefs().intro === "off" ? "off" : "on";
}

// The entrance (knock, boom, pings) takes this long; then the intro waits for the app,
// at most HOLD_MS more, and flies in (LEAVE_MS).
const ENTRANCE_MS = 1550;
const HOLD_MS = 4000;
const LEAVE_MS = 900;
const RAY_COLORS = ["var(--lavender)", "var(--pink)", "var(--butter)", "#ffffff"];
const RAYS = 16;
const SPARKS = 6;

let appReady = false;
let onAppReady: (() => void) | null = null;

// The app has something to show (Home's first row, or a screen that needs no loading):
// the intro may fly into it.
export function introReady(): void {
  if (appReady) return;
  appReady = true;
  if (onAppReady) onAppReady();
}

// Plays the intro over the app as it opens.
export function showIntro(mode: IntroMode): void {
  if (mode === "off") return;
  const intro = buildIntro();
  document.body.appendChild(intro.el);
  intro.play(true, false);
}

// Plays the intro now, from a tap (Settings' Play it now), so with sound; nothing to
// wait for.
export function playIntroNow(): void {
  const intro = buildIntro();
  document.body.appendChild(intro.el);
  intro.play(true, true);
}

function buildIntro(): { el: HTMLElement; play(sound: boolean, ready: boolean): void } {
  const letters = "ARAN".split("").map((letter, i) => h("span", { class: "intro-letter", text: letter, attrs: { style: "--i:" + i } }));
  const sparks = [];
  for (let i = 0; i < SPARKS; i++) sparks.push(h("span", { class: "intro-spark", attrs: { style: "--a:" + Math.round((360 / SPARKS) * i + 15) + "deg;--d:" + (i % 2) * 140 + "ms" } }));
  // Drawn, not typed: a drawn plus's middle is exactly the middle of its box, which the
  // flight through it centres on.
  const plus = h("span", { class: "intro-plus" }, [h("span", { class: "intro-plus-mark" }), ...sparks]);
  const logo = h("div", { class: "intro-logo", attrs: { "aria-hidden": "true" } }, [...letters, plus]);
  const rays = [];
  for (let i = 0; i < RAYS; i++) {
    const angle = Math.round((360 / RAYS) * i + (i % 2) * 7);
    rays.push(h("span", { class: "intro-ray", attrs: { style: "--a:" + angle + "deg;--c:" + RAY_COLORS[i % RAY_COLORS.length] + ";--d:" + (i % 3) * 40 + "ms" } }));
  }
  const el = h("div", { class: "intro", attrs: { role: "img", "aria-label": "ARAN+" } }, [h("div", { class: "intro-glow" }), h("div", { class: "intro-rays" }, rays), logo]);
  let played = false;
  return {
    el,
    play(sound: boolean, ready: boolean) {
      if (played) return;
      played = true;
      const audio: StingAudio | null = sound ? openStingAudio() : null;
      if (audio) playSting(audio.ctx);
      // Flying through the plus: the zoom centres on it.
      const box = logo.getBoundingClientRect();
      const mark = plus.getBoundingClientRect();
      if (box.width > 0) {
        logo.style.setProperty("--ox", Math.round(mark.left + mark.width / 2 - box.left) + "px");
        logo.style.setProperty("--oy", Math.round(mark.top + mark.height / 2 - box.top) + "px");
      }
      el.classList.add("is-playing");
      let left = false;
      const leave = () => {
        if (left) return;
        left = true;
        onAppReady = null;
        if (audio) {
          playWhoosh(audio.ctx);
          audio.done();
        }
        el.classList.add("is-leaving");
        window.setTimeout(() => el.remove(), LEAVE_MS);
      };
      // After the entrance: in as soon as the app is ready, or after HOLD_MS regardless.
      window.setTimeout(() => {
        if (ready || appReady) return leave();
        onAppReady = leave;
        window.setTimeout(leave, HOLD_MS);
      }, ENTRANCE_MS);
    },
  };
}
