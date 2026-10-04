// The intro when ARAN+ opens, with its sting (sting.ts): ARAN+'s own take on a streaming
// service's opening. A soft knock and the plus pulses; a boom and ARAN punches in out of a
// glow, light rays bursting out behind it; the plus spins and sparks with two pings;
// then the intro flies through the plus into the app, which has been loading underneath
// all along.
//
// iPhones keep web pages quiet until they're touched, so with sound the intro waits on
// a glowing plus for a tap; without, it plays straight away. Settings has the choice:
// with sound, animation only, or off.

import { loadPrefs } from "../core/storage";
import { h } from "./dom";
import { playStingNow } from "./sting";

export type IntroMode = "sound" | "silent" | "off";

export function introMode(): IntroMode {
  const mode = loadPrefs().intro;
  return mode === "silent" || mode === "off" ? mode : "sound";
}

// How long the intro runs once it starts (intro.css times everything inside this).
const PLAY_MS = 2550;
const RAY_COLORS = ["var(--lavender)", "var(--pink)", "var(--butter)", "#ffffff"];
const RAYS = 16;
const SPARKS = 6;

// Shows the intro over the app as it opens. `waitForTap`: with sound, so it waits.
export function showIntro(mode: IntroMode): void {
  if (mode === "off") return;
  const intro = buildIntro();
  document.body.appendChild(intro.el);
  if (mode === "silent") {
    intro.play(false);
    return;
  }
  intro.el.classList.add("is-waiting");
  const go = (event: Event) => {
    event.preventDefault();
    intro.el.removeEventListener("click", go);
    intro.el.removeEventListener("keydown", onKey);
    intro.play(true);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") go(event);
  };
  intro.el.addEventListener("click", go);
  intro.el.addEventListener("keydown", onKey);
  intro.el.focus();
}

// Plays the intro now, from a tap (Settings' Play it now), with sound.
export function playIntroNow(): void {
  const intro = buildIntro();
  document.body.appendChild(intro.el);
  intro.play(true);
}

function buildIntro(): { el: HTMLElement; play(sound: boolean): void } {
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
  const el = h("div", { class: "intro", attrs: { role: "button", tabindex: "0", "aria-label": "Start ARAN+" } }, [
    h("div", { class: "intro-glow" }),
    h("div", { class: "intro-rays" }, rays),
    logo,
    h("div", { class: "intro-hint", text: "Tap to start" }),
  ]);
  let played = false;
  return {
    el,
    play(sound: boolean) {
      if (played) return;
      played = true;
      // The sound first, while the tap still counts.
      if (sound) playStingNow();
      // Flying through the plus: the zoom centres on it.
      const box = logo.getBoundingClientRect();
      const mark = plus.getBoundingClientRect();
      if (box.width > 0) {
        logo.style.setProperty("--ox", Math.round(mark.left + mark.width / 2 - box.left) + "px");
        logo.style.setProperty("--oy", Math.round(mark.top + mark.height / 2 - box.top) + "px");
      }
      el.classList.remove("is-waiting");
      el.classList.add("is-playing");
      el.setAttribute("aria-label", "ARAN+");
      window.setTimeout(() => el.remove(), PLAY_MS);
    },
  };
}
