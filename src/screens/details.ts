// A movie or a series (the TV apps' DetailsScreen, docs/features.md §5.4 in the Roku
// repo): backdrop, title, meta line, plot, cast and director. Movies get Resume / Play
// from start (or just Play). Series get Resume S1:E4 (or Play S1:E1), season pills and
// the episode list; a tap on an episode plays it. A title on Continue Watching also
// gets Remove from Continue Watching (the whole show, for a series). A quiet note says
// when the helper on your computer converts the file.

import type { App, Screen } from "../app";
import { factsKey, playRoute, routeNote } from "../core/compat";
import { applyInfo, Item, metaLine } from "../core/items";
import { log } from "../core/log";
import { progressFind, progressFraction, ProgressEntry, progressRemove } from "../core/progress";
import { episodeCode, formatClock, formatRuntime, sizedImage, toInt } from "../core/utils";
import { BACKDROP_SIZE, episodeItem, POSTER_SIZE, Season } from "../core/xtream";
import { canPlayHevc } from "../platform/video";
import { h, iconButton, onTap, setText, toggle } from "../ui/dom";
import { ICONS } from "../ui/icons";
import { playEpisode, playMovie, playOrder } from "./play";

export class DetailsScreen implements Screen {
  readonly el: HTMLElement;
  private art: HTMLElement;
  private titleEl: HTMLElement;
  private metaEl: HTMLElement;
  private plotEl: HTMLElement;
  private creditsEl: HTMLElement;
  private buttonsEl: HTMLElement;
  private noteEl: HTMLElement;
  private statusEl: HTMLElement;
  private seasonsEl: HTMLElement;
  private episodesEl: HTMLElement;
  private seasons: Season[] = [];
  private seasonIndex = 0;
  private entry: ProgressEntry | null = null;
  private alive = true;
  private shownOnce = false;

  constructor(
    private app: App,
    private item: Item,
  ) {
    this.art = h("div", { class: "details-art" });
    this.titleEl = h("h1", { class: "details-title" });
    this.metaEl = h("div", { class: "details-meta" });
    this.plotEl = h("p", { class: "details-plot" });
    this.creditsEl = h("div", { class: "details-credits" });
    this.buttonsEl = h("div", { class: "details-buttons" });
    this.noteEl = h("div", { class: "details-note" });
    this.statusEl = h("div", { class: "details-status" });
    this.seasonsEl = h("div", { class: "season-strip", attrs: { role: "tablist" } });
    this.episodesEl = h("div", { class: "episodes" });
    const back = onTap(iconButton("round-button details-back", ICONS.back, "Back"), () => this.app.back());
    this.el = h("div", { class: "details" }, [
      h("div", { class: "details-scroll" }, [
        this.art,
        h("div", { class: "details-body" }, [this.titleEl, this.metaEl, this.buttonsEl, this.noteEl, this.plotEl, this.creditsEl, this.statusEl, this.seasonsEl, this.episodesEl]),
      ]),
      back,
    ]);
    this.showInfo();
    if (item.kind === "series") this.loadSeries();
    else this.loadMovie();
  }

  // Back from the player: where we got to, and what changed on other devices.
  onShow(): void {
    if (!this.shownOnce) {
      this.shownOnce = true;
      return;
    }
    if (this.item.kind === "series") {
      if (this.seasons.length) this.seriesProgress(false);
    } else this.movieButtons();
  }

  destroy(): void {
    this.alive = false;
  }

  // --- Info -----------------------------------------------------------------------

  private showInfo(): void {
    const item = this.item;
    setText(this.titleEl, item.title);
    setText(this.metaEl, metaLine(item));
    setText(this.plotEl, item.description);
    const credits: string[] = [];
    if (item.starring) credits.push("Starring " + item.starring);
    if (item.directedBy) credits.push("Directed by " + item.directedBy);
    setText(this.creditsEl, credits.join("  ·  "));
    const image = item.backdrop || (item.poster ? sizedImage(item.poster, BACKDROP_SIZE) : "");
    toggle(this.art, "is-poster", !item.backdrop);
    if (image) this.art.style.backgroundImage = 'url("' + image.replace(/"/g, "%22") + '")';
  }

  // --- Movies ---------------------------------------------------------------------

  private loadMovie(): void {
    this.movieButtons();
    this.movieNote();
    const api = this.app.api;
    if (!api || this.item.hasInfo) return;
    api
      .vodInfo(this.item.itemId)
      .then((info) => {
        if (!this.alive) return;
        applyInfo(this.item, info);
        if (!this.item.poster && info.poster) this.item.poster = sizedImage(info.poster, POSTER_SIZE);
        this.showInfo();
        this.movieNote();
      })
      .catch((err: Error) => log("vod info failed:", err.message));
  }

  private movieNote(): void {
    const item = this.item;
    const facts = { key: factsKey("movie", item.itemId), ext: item.ext, videoCodec: item.videoCodec, audioCodec: item.audioCodec };
    setText(this.noteEl, routeNote(facts, playRoute(facts, canPlayHevc())));
  }

  private movieButtons(): void {
    this.entry = progressFind("m:" + this.item.itemId);
    const pos = this.entry ? toInt(this.entry.pos) : 0;
    const buttons: HTMLElement[] = [];
    if (pos > 0) {
      buttons.push(this.button("Resume from " + formatClock(pos), true, () => playMovie(this.app, this.item, pos)));
      buttons.push(this.button("Play from start", false, () => playMovie(this.app, this.item, 0)));
    } else buttons.push(this.button("Play", true, () => playMovie(this.app, this.item, 0)));
    if (this.entry) buttons.push(this.forgetButton());
    this.setButtons(buttons);
  }

  // --- Series ---------------------------------------------------------------------

  private loadSeries(): void {
    const api = this.app.api;
    if (!api) return;
    setText(this.statusEl, "Loading episodes…");
    api
      .seriesInfo(this.item.itemId)
      .then(({ info, seasons }) => {
        if (!this.alive) return;
        applyInfo(this.item, info);
        if (!this.item.poster && info.poster) this.item.poster = sizedImage(info.poster, POSTER_SIZE);
        this.showInfo();
        if (seasons.length === 0) {
          setText(this.statusEl, "Your provider hasn't listed any episodes for this show.");
          return;
        }
        setText(this.statusEl, "");
        this.seasons = seasons;
        this.seriesProgress(true);
      })
      .catch((err: Error) => {
        if (this.alive) setText(this.statusEl, err.message);
      });
  }

  // Reads Continue Watching and sets the buttons, the season shown and progress bars.
  private seriesProgress(pickSeason: boolean): void {
    this.entry = progressFind("s:" + this.item.itemId);
    const entry = this.entry;
    const entryId = entry ? entry.id : "";
    const entrySeason = this.seasons.findIndex((season) => season.episodes.some((ep) => ep.id === entryId));
    if (pickSeason) {
      const firstRegular = this.seasons.findIndex((s) => s.seasonNo > 0);
      this.showSeason(entrySeason >= 0 ? entrySeason : Math.max(0, firstRegular));
    } else this.showSeason(this.seasonIndex);
    const order = playOrder(this.seasons, this.item.itemId);
    const buttons: HTMLElement[] = [];
    if (entrySeason >= 0 && entry) {
      const verb = toInt(entry.pos) > 0 ? "Resume " : "Play ";
      buttons.push(this.button(verb + episodeCode(entry.season, entry.episode), true, () => playEpisode(this.app, this.item, this.seasons, entry.id, toInt(entry.pos))));
    } else if (order.length > 0) {
      const first = order[0];
      buttons.push(this.button("Play " + episodeCode(first.seasonNo, first.episodeNo), true, () => playEpisode(this.app, this.item, this.seasons, first.itemId, 0)));
    }
    if (entry && buttons.length > 0) buttons.push(this.forgetButton());
    this.setButtons(buttons);
    this.seriesNote();
  }

  private seriesNote(): void {
    let converted = 0;
    let total = 0;
    let sample = "";
    const hevc = canPlayHevc();
    for (const season of this.seasons) {
      for (const ep of season.episodes) {
        total++;
        const facts = { key: factsKey("episode", ep.id), ext: ep.ext, videoCodec: ep.videoCodec, audioCodec: ep.audioCodec };
        const route = playRoute(facts, hevc);
        if (route === "helper") {
          converted++;
          if (!sample) sample = routeNote(facts, route);
        }
      }
    }
    if (converted === 0) setText(this.noteEl, "");
    else if (converted === total) setText(this.noteEl, sample);
    else setText(this.noteEl, converted + " of " + total + " episodes play through the helper on your computer, which converts them while you watch.");
  }

  private showSeason(index: number): void {
    this.seasonIndex = index;
    this.seasonsEl.textContent = "";
    if (this.seasons.length > 1) {
      this.seasons.forEach((season, i) => {
        const pill = h("button", { class: "pill" + (i === index ? " is-selected" : ""), text: season.title, attrs: { type: "button", role: "tab", "aria-selected": String(i === index) } });
        this.seasonsEl.appendChild(onTap(pill, () => this.showSeason(i)));
      });
      const chosen = this.seasonsEl.children[index] as HTMLElement | undefined;
      if (chosen) chosen.scrollIntoView({ block: "nearest", inline: "center" });
    } else if (this.seasons.length === 1) this.seasonsEl.appendChild(h("div", { class: "season-single", text: this.seasons[0].title }));
    this.renderEpisodes();
  }

  private renderEpisodes(): void {
    this.episodesEl.textContent = "";
    const season = this.seasons[this.seasonIndex];
    if (!season) return;
    season.episodes.forEach((ep, i) => {
      const item = episodeItem(ep, this.item.itemId);
      this.episodesEl.appendChild(this.episodeEl(item, ep.episodeNo || i + 1));
    });
  }

  private episodeEl(ep: Item, number: number): HTMLElement {
    const still = h("div", { class: "episode-still" });
    if (ep.poster) {
      const img = h("img", { attrs: { alt: "", loading: "lazy", decoding: "async" } });
      img.onerror = () => img.remove();
      img.src = ep.poster;
      still.appendChild(img);
    }
    const play = h("span", { class: "episode-play" });
    play.innerHTML = ICONS.play;
    still.appendChild(play);
    const progress = this.entry && this.entry.id === ep.itemId ? progressFraction(this.entry) : 0;
    if (progress > 0) still.appendChild(h("div", { class: "poster-progress" }, [h("div", { class: "poster-fill", attrs: { style: "width:" + Math.round(progress * 100) + "%" } })]));
    const runtime = ep.durationSecs > 0 ? formatRuntime(ep.durationSecs) : "";
    const row = h("button", { class: "episode", attrs: { type: "button" } }, [
      still,
      h("div", { class: "episode-text" }, [h("div", { class: "episode-title", text: number + ".  " + ep.title }), h("div", { class: "episode-runtime", text: runtime })]),
      ep.description ? h("div", { class: "episode-plot", text: ep.description }) : null,
    ]);
    return onTap(row, () => {
      const resume = this.entry && this.entry.id === ep.itemId ? toInt(this.entry.pos) : 0;
      playEpisode(this.app, this.item, this.seasons, ep.itemId, resume);
    });
  }

  // --- Buttons ----------------------------------------------------------------------

  private button(label: string, primary: boolean, action: () => void): HTMLElement {
    const el = h("button", { class: "button" + (primary ? " is-primary" : ""), attrs: { type: "button" } });
    if (primary) el.innerHTML = ICONS.play;
    el.appendChild(h("span", { text: label }));
    return onTap(el, action);
  }

  private forgetButton(): HTMLElement {
    return this.button("Remove from Continue Watching", false, () => {
      progressRemove((this.item.kind === "series" ? "s:" : "m:") + this.item.itemId);
      if (this.app.sync) this.app.sync.now();
      this.app.toast("Removed from Continue Watching.");
      if (this.item.kind === "series") this.seriesProgress(false);
      else this.movieButtons();
    });
  }

  private setButtons(buttons: HTMLElement[]): void {
    this.buttonsEl.textContent = "";
    for (const b of buttons) this.buttonsEl.appendChild(b);
  }
}
