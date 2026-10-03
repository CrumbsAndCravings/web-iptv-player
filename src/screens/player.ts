// The player (the TV apps' PlayerScreen), for touch: the video fills the screen, a tap
// shows the controls (close and the title on top; back 10 s, play/pause and forward
// 10 s in the middle; the bar, the times and Audio & subtitles, Episodes, Next episode,
// picture in picture, AirPlay and full screen at the bottom), and they hide after a few
// seconds of playing. Progress is saved for Continue Watching, episodes roll into the
// next one with Up Next, and a failure is retried before the error card explains it.
//
// Two ways to play (core/compat.ts):
//   direct  the provider's MP4 as it is, passed on by the helper; Safari jumps itself.
//   helper  the helper converts the file into HLS from where you start, as fast as the
//           computer can. Its timeline starts at that point, so the video's clock plus
//           `offset` is the position in the file. A jump into what is converted already
//           is the video's own; one further on starts the helper again from there.
// A title that doesn't play directly moves to the helper (and is remembered); an HEVC
// picture this device refuses is converted to H.264 instead (also remembered).
//
// Subtitles are a text track on the video, so Safari draws them, in full screen and
// picture in picture too: the file's own (written out as WebVTT by the helper as it
// converts) or English ones from OpenSubtitles, fetched once, so timing nudges cost no
// download.

import type { App, Screen } from "../app";
import { factsKey, FileFacts, helperVideoMode, learnedMode, learnMode, playRoute, rememberNeedsHelper, Route, VideoMode } from "../core/compat";
import type { Item } from "../core/items";
import { log, logError } from "../core/log";
import type { FindRequest } from "../core/opensubtitles";
import { barFraction, clampSeek } from "../core/playback";
import { progressPut, progressRemove } from "../core/progress";
import { redact } from "../core/redact";
import { httpDetail, isRefusalCode } from "../core/refusals";
import { Cue, parseSubtitles } from "../core/srt";
import { loadOsAccount, loadPrefs, savePref } from "../core/storage";
import { activeSubtitle, freshOnline, NUDGE_MS, OnlineStatus, SubtitleSource, subtitleMenu, subtitlePlan, tracksNote } from "../core/subtitles";
import { audioNowText, audioOptions, subtitleOptions, TrackOption } from "../core/tracks";
import { codecLabel, describeCodecs, episodeCode, formatClock } from "../core/utils";
import { currentOf, dueForSave, entryFor, finishedChange, hasNext, resumeFrom, saveAction, Watching } from "../core/watch";
import { fileUrl, helperHash, helperLastError, HlsStart, startHls, stopHelper } from "../data/helper";
import { OsClient } from "../data/opensubtitles";
import { send } from "../platform/http";
import { attachFile, attachHls, Attached, canPip, canPlayHevc, enterFullscreen, mediaErrorLabel, togglePip } from "../platform/video";
import { h, iconButton, onTap, setText, toggle } from "../ui/dom";
import { ICONS } from "../ui/icons";
import { SubtitleSetupScreen } from "./subtitle-setup";

const HIDE_AFTER_MS = 4000;
const NEVER_STARTED_MS = 30000; // opened without an error but no progress
const STUCK_MS = 45000; // playing, but the clock hasn't moved
const RETRY_AFTER_MS = 1500; // lets the provider free the one connection first
const UP_NEXT_SECS = 8;
const AUTO_SUBTITLES_AFTER_MS = 2500;
const SYNC_EVERY_MS = 5 * 60000;
const CHECK_STREAM_MS = 10000;
const SUBTITLE_REFRESH_MS = 15000; // the file's own subtitles grow while the helper works
const CONVERT_HEIGHT = 1080; // pictures the helper converts are made no taller than this
const NOTE_MS = 6000;

function factsOf(item: Item): FileFacts {
  return { key: factsKey(item.kind, item.itemId), ext: item.ext, videoCodec: item.videoCodec, audioCodec: item.audioCodec };
}

function fileLine(item: Item): string {
  const codecs = describeCodecs(item.videoCodec, item.videoProfile, item.audioCodec);
  return "File: " + (item.ext || "?").toUpperCase() + (codecs ? ", " + codecs + "." : ". Your provider didn't list its codecs.");
}

type Panel = "" | "tracks" | "episodes";

export class PlayerScreen implements Screen {
  readonly el: HTMLElement;
  private video: HTMLVideoElement;
  private stage: HTMLElement;
  private controls: HTMLElement;
  private titleEl: HTMLElement;
  private subtitleLine: HTMLElement;
  private playButton: HTMLButtonElement;
  private elapsedEl: HTMLElement;
  private remainingEl: HTMLElement;
  private bar: HTMLElement;
  private fillEl: HTMLElement;
  private bufferEl: HTMLElement;
  private knobEl: HTMLElement;
  private bubbleEl: HTMLElement;
  private noteEl: HTMLElement;
  private spinner: HTMLElement;
  private errorEl: HTMLElement;
  private upNextEl: HTMLElement;
  private panelEl: HTMLElement;
  private nextButton: HTMLButtonElement;
  private episodesButton: HTMLButtonElement;
  private airplayButton: HTMLButtonElement;
  private pipButton: HTMLButtonElement;

  private source: Attached | null = null;
  private token = 0;
  private closing = false;
  private route: Route = "direct";
  private helperTried = false;
  private helperFromStart = false;
  private session: HlsStart | null = null;
  private starting: { abort(): void } | null = null;
  private helperVideo: VideoMode = "copy";
  private convertTried = false;
  private audioTrack = -1; // the helper's sound track; -1 until chosen
  private offset = 0; // seconds into the file where the video's clock starts
  private duration = 0; // seconds
  private startSecs = 0;
  private attempt = 0;
  private errors: string[] = [];
  private started = false;
  private failed = false;
  private firstTime = -1;
  private lastSavedSecs = 0;
  private lastMoved = 0;
  private lastTime = -1;
  private seeking = -1; // a jump asked for, until the video gets there
  private dragging = false;
  private dragTarget = 0;
  private controlsShown = false;
  private panel: Panel = "";
  private hash = "";
  private waitingForTap = false; // Safari refused to start without a tap

  // Audio & subtitles
  private audioOpts: TrackOption[] = [];
  private embeddedOpts: TrackOption[] = subtitleOptions([]);
  private subSource: SubtitleSource = { kind: "off" };
  private online: OnlineStatus = freshOnline(false);
  private onlineCues: Cue[] | null = null;
  private fileCues: { [index: string]: Cue[] } = {};
  private textTrack: TextTrack | null = null;
  private osToken = 0;
  private tracksApplied = false;

  private hideTimer = 0;
  private stallTimer = 0;
  private stuckTimer = 0;
  private retryTimer = 0;
  private countdownTimer = 0;
  private noteTimer = 0;
  private autoTimer = 0;
  private syncTimer = 0;
  private subtitleTimer = 0;
  private secondsLeft = 0;
  private lastTap = 0;
  private onVisibility = () => {
    if (document.hidden) this.saveProgress();
  };

  constructor(
    private app: App,
    private watching: Watching,
    private index: number,
    startSecs: number,
  ) {
    this.video = h("video", { class: "player-video", attrs: { playsinline: "", "webkit-playsinline": "", preload: "auto", "x-webkit-airplay": "allow" } });
    this.video.playsInline = true;
    this.stage = h("div", { class: "player-stage" }, [this.video]);

    this.titleEl = h("div", { class: "player-title" });
    this.subtitleLine = h("div", { class: "player-subtitle-line" });
    const close = onTap(iconButton("round-button", ICONS.close, "Close"), () => this.app.back());
    this.playButton = onTap(iconButton("player-play", ICONS.pause, "Pause"), () => this.togglePause());
    const back10 = onTap(iconButton("player-skip", ICONS.back10, "Back 10 seconds"), () => this.jumpBy(-10));
    const fwd10 = onTap(iconButton("player-skip", ICONS.forward10, "Forward 10 seconds"), () => this.jumpBy(10));
    this.elapsedEl = h("div", { class: "player-time" });
    this.remainingEl = h("div", { class: "player-time is-right" });
    this.bufferEl = h("div", { class: "bar-buffer" });
    this.fillEl = h("div", { class: "bar-fill" });
    this.knobEl = h("div", { class: "bar-knob" });
    this.bubbleEl = h("div", { class: "bar-bubble" });
    this.bar = h("div", { class: "player-bar", attrs: { role: "slider", "aria-label": "Position" } }, [h("div", { class: "bar-track" }, [this.bufferEl, this.fillEl]), this.knobEl, this.bubbleEl]);
    const tracksButton = onTap(iconButton("player-tool", ICONS.subtitles, "Audio & subtitles", true), () => this.openPanel("tracks"));
    this.episodesButton = onTap(iconButton("player-tool", ICONS.episodes, "Episodes", true), () => this.openPanel("episodes"));
    this.nextButton = onTap(iconButton("player-tool", ICONS.next, "Next episode", true), () => this.playNext());
    this.pipButton = onTap(iconButton("player-tool is-icon", ICONS.pip, "Picture in picture"), () => togglePip(this.video));
    this.airplayButton = onTap(iconButton("player-tool is-icon is-hidden", ICONS.airplay, "AirPlay"), () => this.video.webkitShowPlaybackTargetPicker && this.video.webkitShowPlaybackTargetPicker());
    const fullButton = onTap(iconButton("player-tool is-icon", ICONS.fullscreen, "Full screen"), () => enterFullscreen(this.video, this.el));
    this.noteEl = h("div", { class: "player-note" });
    this.controls = h("div", { class: "player-controls" }, [
      h("div", { class: "player-top" }, [close, h("div", { class: "player-heading" }, [this.titleEl, this.subtitleLine])]),
      h("div", { class: "player-middle" }, [back10, this.playButton, fwd10]),
      h("div", { class: "player-bottom" }, [
        h("div", { class: "player-bar-row" }, [this.elapsedEl, this.bar, this.remainingEl]),
        h("div", { class: "player-tools" }, [tracksButton, this.episodesButton, this.nextButton, h("div", { class: "player-tools-gap" }), this.pipButton, this.airplayButton, fullButton]),
      ]),
    ]);
    this.spinner = h("div", { class: "player-spinner" });
    this.errorEl = h("div", { class: "player-card player-error" });
    this.upNextEl = h("div", { class: "player-card player-upnext" });
    this.panelEl = h("div", { class: "player-panel" });
    this.el = h("div", { class: "player" }, [this.stage, this.controls, this.noteEl, this.spinner, this.errorEl, this.upNextEl, this.panelEl]);
    if (!canPip(this.video)) this.pipButton.classList.add("is-hidden");

    this.listen();
    // Safari only lets a video start with sound from a tap. The player opens on one (Play,
    // an episode), but the video starts seconds later, once the helper is ready; asking
    // now, while the tap still counts, lets it start by itself then.
    this.video.play().catch(() => undefined);
    this.startItem(startSecs);
  }

  private get item(): Item {
    return currentOf(this.watching, this.index);
  }

  private get position(): number {
    return this.offset + (this.video.currentTime || 0);
  }

  // --- The video's events ---------------------------------------------------------------

  private listen(): void {
    const v = this.video;
    v.addEventListener("timeupdate", () => this.onTime());
    v.addEventListener("playing", () => {
      this.show(this.spinner, false);
      this.renderPlay();
    });
    v.addEventListener("pause", () => {
      this.renderPlay();
      if (this.started && !this.closing) {
        this.saveProgress();
        this.showControls();
      }
    });
    v.addEventListener("waiting", () => this.show(this.spinner, true));
    v.addEventListener("seeked", () => {
      this.seeking = -1;
      this.renderBar();
    });
    v.addEventListener("ended", () => this.onEnded());
    v.addEventListener("error", () => {
      if (!v.getAttribute("src") && !this.source) return;
      this.handleError("Safari's player says: " + mediaErrorLabel(v.error));
    });
    v.addEventListener("loadedmetadata", () => {
      if (this.route === "direct" && isFinite(v.duration) && v.duration > 0) this.duration = v.duration;
      this.renderBar();
    });
    v.addEventListener("progress", () => this.renderBar());
    // AirPlay shows up when there's somewhere to send the video.
    v.addEventListener("webkitplaybacktargetavailabilitychanged", (event) => {
      const available = (event as unknown as { availability?: string }).availability === "available";
      toggle(this.airplayButton, "is-hidden", !available);
    });
    document.addEventListener("visibilitychange", this.onVisibility);

    // A tap on the picture shows or hides the controls; a double tap on either side
    // jumps 10 seconds.
    this.stage.addEventListener("click", (event) => this.onStageTap(event));
    this.controls.addEventListener("click", (event) => {
      if (event.target === this.controls || (event.target as HTMLElement).classList.contains("player-middle")) this.onStageTap(event);
      else this.restartHideTimer();
    });
    this.listenToBar();
  }

  private onStageTap(event: MouseEvent): void {
    if (this.panel) return this.closePanel();
    const now = Date.now();
    const width = this.el.clientWidth || 1;
    const side = event.clientX < width * 0.35 ? -1 : event.clientX > width * 0.65 ? 1 : 0;
    if (now - this.lastTap < 300 && side !== 0 && this.started) {
      this.jumpBy(side * 10);
      this.lastTap = 0;
      return;
    }
    this.lastTap = now;
    if (this.controlsShown) this.hideControls();
    else this.showControls();
  }

  private listenToBar(): void {
    const at = (clientX: number) => {
      const rect = this.bar.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      return fraction * this.duration;
    };
    this.bar.addEventListener("pointerdown", (event) => {
      if (this.duration <= 0) return;
      this.dragging = true;
      this.dragTarget = at(event.clientX);
      this.bar.setPointerCapture(event.pointerId);
      window.clearTimeout(this.hideTimer);
      this.renderBar();
    });
    this.bar.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      this.dragTarget = at(event.clientX);
      this.renderBar();
    });
    const finish = (event: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.dragTarget = at(event.clientX);
      this.seekTo(this.dragTarget);
      this.restartHideTimer();
    };
    this.bar.addEventListener("pointerup", finish);
    this.bar.addEventListener("pointercancel", () => {
      this.dragging = false;
      this.renderBar();
    });
  }

  // --- Starting a title -------------------------------------------------------------

  private startItem(startSecs: number): void {
    this.clearTimers();
    this.stopSource();
    this.closePanel();
    this.show(this.errorEl, false);
    this.show(this.upNextEl, false);
    this.startSecs = startSecs;
    this.attempt = 0;
    this.errors = [];
    this.started = false;
    this.failed = false;
    this.firstTime = -1;
    this.lastSavedSecs = startSecs;
    this.offset = 0;
    this.seeking = -1;
    this.session = null;
    this.helperTried = false;
    this.helperFromStart = false;
    this.convertTried = false;
    this.audioTrack = -1;
    const item = this.item;
    this.duration = item.durationSecs;
    this.resetSubtitles();
    const w = this.watching;
    setText(this.titleEl, w.kind === "movie" ? item.title : w.seriesName || item.title);
    setText(this.subtitleLine, w.kind === "movie" ? "" : episodeCode(item.seasonNo, item.episodeNo) + "  " + item.title);
    toggle(this.episodesButton, "is-hidden", w.kind !== "episode");
    toggle(this.nextButton, "is-hidden", !hasNext(w, this.index));
    this.mediaSession();
    this.app.library?.hold(true);

    this.route = playRoute(factsOf(item), canPlayHevc());
    if (this.route === "helper") {
      this.helperTried = true;
      this.helperFromStart = true;
    }
    this.helperVideo = helperVideoMode(item.videoCodec);
    this.show(this.spinner, true);
    this.showControls();
    this.hashThenLoad();
    window.clearInterval(this.syncTimer);
    this.syncTimer = window.setInterval(() => {
      if (this.started && !this.video.paused && this.app.sync) this.app.sync.now();
    }, SYNC_EVERY_MS);
  }

  // Online subtitles "timed for this file" need the file's moviehash, which the helper
  // reads from its first and last 64 KB. The provider allows one connection, so that
  // happens before the video opens, and only when OpenSubtitles is set up and subtitles
  // weren't turned off.
  private hashThenLoad(): void {
    const wanted = this.online.configured && loadPrefs().subtitles !== "off";
    if (!wanted) return this.loadStream();
    const token = ++this.token;
    helperHash(this.item).then((hash) => {
      if (token !== this.token || this.closing) return;
      this.hash = hash;
      log("moviehash", hash ? "ready" : "unavailable");
      this.loadStream();
    });
  }

  private loadStream(): void {
    if (this.route === "helper") return this.loadHelper(resumeFrom(this.startSecs));
    const token = ++this.token;
    const item = this.item;
    log("play direct", factsOf(item).key, item.ext, item.videoCodec, item.audioCodec, "attempt", this.attempt + 1);
    this.offset = 0;
    this.source = attachFile(this.video, fileUrl(item));
    const from = resumeFrom(this.startSecs);
    const begin = () => {
      if (token !== this.token) return;
      if (from > 0) this.video.currentTime = from;
      this.play();
    };
    if (this.video.readyState >= 1) begin();
    else this.video.addEventListener("loadedmetadata", begin, { once: true });
    this.armStall(token, NEVER_STARTED_MS);
  }

  // The helper's HLS from `from` seconds: it answers once the first pieces are ready.
  private loadHelper(from: number): void {
    const token = ++this.token;
    const item = this.item;
    this.show(this.spinner, true);
    // The first time, the helper picks the sound in the language chosen before.
    const audioLanguage = this.audioTrack < 0 ? loadPrefs().audio || "" : "";
    log("play via helper", factsOf(item).key, "from", from, this.helperVideo, "audio", this.audioTrack < 0 ? audioLanguage || "first" : this.audioTrack, "attempt", this.attempt + 1);
    const hevc = canPlayHevc() && learnedMode("hevc") !== "convert";
    const request = startHls(item, { start: from, video: this.helperVideo, audioTrack: this.audioTrack, audioLanguage, height: CONVERT_HEIGHT, hevc });
    this.starting = request;
    request.promise.then(
      (session) => {
        if (token !== this.token || this.closing) return;
        this.starting = null;
        const first = this.session === null;
        this.session = session;
        this.offset = session.start;
        this.lastTime = -1;
        if (session.duration > 0) this.duration = session.duration;
        this.helperVideo = session.video;
        if (session.video === "convert") this.convertTried = true;
        this.audioTrack = session.audioTrack;
        log("helper:", session.videoCodec || "no picture", "->", session.video, "sound", session.audioPlan, "duration", session.duration, "subtitles", session.subtitles.length);
        if (first) this.readTracks(session);
        this.attach(token, session);
      },
      (err: Error) => {
        if (token !== this.token) return;
        this.starting = null;
        this.handleError("HELPER: " + err.message);
      },
    );
  }

  private attach(token: number, session: HlsStart): void {
    attachHls(this.video, session.url, (reason) => {
      if (token === this.token) this.handleError(reason);
    }).then((attached) => {
      if (token !== this.token) {
        attached.stop();
        return;
      }
      this.source = attached;
      this.play();
      this.armStall(token, NEVER_STARTED_MS);
      // The file's own subtitles start again with the new session.
      if (this.subSource.kind === "embedded") this.loadFileSubtitles(this.subSource.id, true);
      else this.rebuildCues();
    });
  }

  private armStall(token: number, ms: number): void {
    window.clearTimeout(this.stallTimer);
    this.stallTimer = window.setTimeout(() => {
      if (token === this.token && !this.started && !this.failed) this.handleError("NO_PROGRESS (it opened but never started)");
    }, ms);
  }

  private play(): void {
    const playing = this.video.play();
    if (playing && playing.catch) {
      playing.catch((err: Error) => {
        // Safari wants a tap before sound plays when the page wasn't tapped just now: wait
        // for one, without counting the wait as a stream that never started.
        log("play() refused:", err.name);
        if (err.name === "NotAllowedError") {
          window.clearTimeout(this.stallTimer);
          this.waitingForTap = true;
          this.show(this.spinner, false);
          this.showControls();
          this.note("Tap play to start.", NOTE_MS);
        }
      });
    }
  }

  private stopSource(): void {
    this.token++;
    if (this.starting) {
      this.starting.abort();
      this.starting = null;
    }
    if (this.source) {
      this.source.stop();
      this.source = null;
    }
  }

  // --- Time and progress ------------------------------------------------------------

  private onTime(): void {
    const t = this.video.currentTime;
    if (t !== this.lastTime) {
      this.lastTime = t;
      this.lastMoved = Date.now();
    }
    if (this.firstTime < 0 && t > 0) this.firstTime = t;
    // Only real progress counts as playing, not just opening (a Roku lesson).
    if (!this.started && this.firstTime >= 0 && t - this.firstTime >= 1) this.onStarted();
    if (this.started) {
      const pos = Math.floor(this.position);
      if (dueForSave(pos, this.lastSavedSecs)) this.saveProgress();
      // After a good stretch, a new failure gets its own retry.
      if (this.attempt > 0 && t - this.firstTime > 60) {
        this.attempt = 0;
        this.errors = [];
      }
    }
    if (this.controlsShown) this.renderBar();
  }

  private onStarted(): void {
    this.started = true;
    // A jump that restarted the helper is done once the new stream plays.
    this.seeking = -1;
    window.clearTimeout(this.stallTimer);
    this.show(this.spinner, false);
    if (this.route === "helper") {
      // It plays this way, so a later failure (after a jump, say) isn't the picture's.
      if (this.helperVideo === "copy" && this.session && this.session.videoCodec === "hevc") learnMode("hevc", "copy");
      this.convertTried = true;
    } else if (isFinite(this.video.duration) && this.video.duration > 0) this.duration = this.video.duration;
    if (this.route === "direct") this.readDirectTracks();
    this.applyTrackChoices();
    this.watchStuck();
    if (this.controlsShown) this.restartHideTimer();
  }

  // Playing, but the clock hasn't moved for a long while: the provider or the helper
  // stopped sending.
  private watchStuck(): void {
    window.clearInterval(this.stuckTimer);
    this.lastMoved = Date.now();
    this.stuckTimer = window.setInterval(() => {
      if (this.video.paused || this.failed || this.dragging || this.seeking >= 0) {
        this.lastMoved = Date.now();
        return;
      }
      if (Date.now() - this.lastMoved > STUCK_MS) this.handleError("STALLED (no new video for " + STUCK_MS / 1000 + " seconds)");
    }, 5000);
  }

  private saveProgress(): void {
    if (!this.started || this.failed) return;
    const pos = Math.floor(this.position);
    const dur = Math.floor(this.duration);
    const action = saveAction(pos, dur);
    if (action === "skip") return;
    this.lastSavedSecs = pos;
    if (action === "finished") this.applyFinished();
    else progressPut(entryFor(this.watching, this.index, pos, dur));
  }

  // Movies drop out of Continue Watching; series move on to the next episode.
  private applyFinished(): void {
    const change = finishedChange(this.watching, this.index);
    if (change.put) progressPut(change.put);
    if (change.remove) progressRemove(change.remove);
  }

  private onEnded(): void {
    if (this.failed || !this.started) return;
    // The helper's stream also ends when the provider's connection drops.
    if (this.route === "helper" && this.duration > 0 && this.position < this.duration - 60) {
      this.handleError("HELPER: the stream from your computer ended early");
      return;
    }
    this.applyFinished();
    this.stopSource();
    if (this.route === "helper" && this.session) stopHelper(this.session.session);
    if (hasNext(this.watching, this.index)) this.showUpNext();
    else this.app.back();
  }

  // --- Jumps --------------------------------------------------------------------------

  private jumpBy(secs: number): void {
    if (!this.started && this.route === "helper") return;
    this.seekTo(this.position + secs);
    this.showControls();
  }

  private seekTo(target: number): void {
    const t = clampSeek(target, this.duration);
    if (this.route === "direct") {
      this.seeking = t;
      this.video.currentTime = t;
      this.renderBar();
      return;
    }
    // Within what the helper has converted: the video's own jump.
    const relative = t - this.offset;
    const seekable = this.video.seekable;
    const end = seekable && seekable.length > 0 ? seekable.end(seekable.length - 1) : 0;
    if (relative >= 0 && relative <= end - 2) {
      this.seeking = t;
      this.video.currentTime = relative;
      this.renderBar();
      return;
    }
    // Further on (or before the start): the helper starts again from there.
    this.reopenAt(t);
  }

  private reopenAt(target: number): void {
    log("helper: reopening at", Math.floor(target));
    this.saveProgress();
    this.stopSource();
    this.seeking = target;
    this.offset = target;
    this.started = false;
    this.firstTime = -1;
    window.clearInterval(this.stuckTimer);
    this.show(this.spinner, true);
    this.renderBar();
    this.loadHelper(Math.floor(target));
  }

  // --- Errors -----------------------------------------------------------------------

  private handleError(label: string): void {
    if (this.failed || this.closing) return;
    this.errors.push(label);
    logError("playback error:", label, "(" + this.route + ")");
    window.clearTimeout(this.stallTimer);
    window.clearInterval(this.stuckTimer);
    const at = this.started ? Math.floor(this.position) : this.startSecs;
    this.stopSource();
    // This device refused the picture as it is (HEVC, usually): convert it instead, and
    // remember that for the next file like it.
    if (this.route === "helper" && !this.started && this.helperVideo === "copy" && !this.convertTried && this.session && label.indexOf("HELPER: ") !== 0) {
      this.convertTried = true;
      this.helperVideo = "convert";
      learnMode(this.session.videoCodec, "convert");
      log("helper: the picture didn't play as it is; converting it");
      this.retryTimer = window.setTimeout(() => this.loadHelper(resumeFrom(at)), RETRY_AFTER_MS);
      return;
    }
    // It didn't play on its own (the format, usually): the helper converts it, now and
    // next time.
    if (this.route === "direct" && (!this.started || this.attempt > 0)) {
      this.switchToHelper(at);
      return;
    }
    if (this.attempt === 0) {
      this.attempt = 1;
      this.started = false;
      this.firstTime = -1;
      this.startSecs = at;
      this.show(this.spinner, true);
      this.retryTimer = window.setTimeout(() => (this.route === "helper" ? this.loadHelper(resumeFrom(at)) : this.loadStream()), RETRY_AFTER_MS);
      return;
    }
    this.showError();
  }

  private switchToHelper(at: number): void {
    log("helper: switching, it didn't play on its own");
    rememberNeedsHelper(factsOf(this.item).key);
    this.route = "helper";
    this.helperTried = true;
    this.started = false;
    this.firstTime = -1;
    this.attempt = 0;
    this.startSecs = at;
    this.show(this.spinner, true);
    this.retryTimer = window.setTimeout(() => this.loadHelper(resumeFrom(at)), RETRY_AFTER_MS);
  }

  private showError(): void {
    this.failed = true;
    this.saveProgress();
    this.show(this.spinner, false);
    this.hideControls();
    this.closePanel();
    const detail = h("div", { class: "player-card-detail", text: this.diagnosis() });
    const again = onTap(h("button", { class: "button is-primary", text: "Try again", attrs: { type: "button" } }), () => this.startItem(this.started ? Math.floor(this.position) : this.startSecs));
    const back = onTap(h("button", { class: "button", text: "Close", attrs: { type: "button" } }), () => this.app.back());
    this.errorEl.textContent = "";
    this.errorEl.appendChild(h("div", { class: "player-card-title", text: "This video didn't play" }));
    this.errorEl.appendChild(detail);
    this.errorEl.appendChild(h("div", { class: "player-card-buttons" }, [again, back]));
    this.show(this.errorEl, true);
    const token = this.token;
    // The video only says the stream failed; the helper knows why.
    if (this.route === "helper" && (this.errors[this.errors.length - 1] || "").indexOf("HELPER: ") !== 0) {
      helperLastError().then((said) => {
        if (said && token === this.token && this.failed) setText(detail, detail.textContent + "\nYour computer says: " + said);
      });
    }
    this.checkStream(detail, token);
  }

  // Asks the provider for the start of the file, to say whether it refused it (a trial
  // that doesn't include it, one device at a time, an ended trial) rather than the
  // phone failing to play it.
  private checkStream(detail: HTMLElement, token: number): void {
    send({ url: fileUrl(this.item), headers: { Range: "bytes=0-1023" }, timeoutMs: CHECK_STREAM_MS, maxBytes: 65536 }).promise.then((res) => {
      if (token !== this.token || !this.failed) return;
      let line = "";
      if (res.timedOut) line = "Asked the provider for the file again: no answer in 10 seconds.";
      else if (res.code === 0) line = "Asked the helper for the file again: no answer.";
      else if (res.code >= 400) {
        line = "Asked the provider for the file again: " + redact(httpDetail(res.code, res.headers(), res.text)) + ".";
        if (isRefusalCode(res.code)) line += " The provider refused it. The trial may not include it, may allow one device at a time, or may have ended.";
      }
      log("stream check:", res.code, line);
      if (line) setText(detail, detail.textContent + "\n" + line);
    });
  }

  // What went wrong, what the file is, and how it was played.
  private diagnosis(): string {
    const last = this.errors[this.errors.length - 1] || "";
    const lines = [last.indexOf("HELPER: ") === 0 ? last.slice(8) : last];
    const tries = this.errors.length === 2 ? "twice" : this.errors.length + " times";
    if (this.helperFromStart) lines.push("Tried " + tries + " through the helper on your computer.");
    else if (this.helperTried) lines.push("Tried " + tries + ", the last through the helper on your computer.");
    else if (this.errors.length > 1) lines.push("Tried " + tries + ", a moment apart.");
    lines.push(fileLine(this.item));
    if (this.route === "helper") lines.push(this.helperLine());
    return lines.join("\n");
  }

  private helperLine(): string {
    const session = this.session;
    if (!session) return "Through the helper on your computer, which didn't describe the file.";
    const picture = this.helperVideo === "convert" ? "picture converted to H.264" : "picture kept as it is";
    const sound = session.audio[session.audioTrack];
    const parts = [picture];
    if (sound && session.audioPlan !== "copy") parts.push(codecLabel(sound.codec) + " sound converted to AAC");
    return "Through the helper on your computer: " + parts.join(", ") + ".";
  }

  // --- Up Next ------------------------------------------------------------------------

  private showUpNext(): void {
    const next = (this.watching.queue as Item[])[this.index + 1];
    this.secondsLeft = UP_NEXT_SECS;
    this.hideControls();
    this.upNextEl.textContent = "";
    const hint = h("div", { class: "player-card-detail" });
    const playNow = onTap(h("button", { class: "button is-primary", text: "Play now", attrs: { type: "button" } }), () => this.playNext());
    const cancel = onTap(h("button", { class: "button", text: "Close", attrs: { type: "button" } }), () => this.app.back());
    this.upNextEl.appendChild(h("div", { class: "player-card-eyebrow", text: "UP NEXT" }));
    this.upNextEl.appendChild(h("div", { class: "player-card-title", text: episodeCode(next.seasonNo, next.episodeNo) + "  " + next.title }));
    this.upNextEl.appendChild(hint);
    this.upNextEl.appendChild(h("div", { class: "player-card-buttons" }, [playNow, cancel]));
    this.show(this.upNextEl, true);
    const tick = () => {
      setText(hint, "Starts in " + this.secondsLeft + (this.secondsLeft === 1 ? " second" : " seconds"));
      if (this.secondsLeft <= 0) return this.playNext();
      this.secondsLeft--;
      this.countdownTimer = window.setTimeout(tick, 1000);
    };
    tick();
  }

  private playNext(): void {
    if (!hasNext(this.watching, this.index)) return;
    this.saveProgress();
    window.clearTimeout(this.countdownTimer);
    this.index++;
    this.startItem(0);
  }

  private goToEpisode(index: number): void {
    if (index === this.index) return this.closePanel();
    this.saveProgress();
    this.index = index;
    this.startItem(0);
  }

  // --- Controls ---------------------------------------------------------------------

  private show(el: HTMLElement, on: boolean): void {
    toggle(el, "is-visible", on);
  }

  private showControls(): void {
    this.controlsShown = true;
    toggle(this.el, "controls-shown", true);
    this.renderPlay();
    this.renderBar();
    this.restartHideTimer();
  }

  private hideControls(): void {
    this.controlsShown = false;
    toggle(this.el, "controls-shown", false);
    window.clearTimeout(this.hideTimer);
  }

  private restartHideTimer(): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (this.dragging || this.panel || this.video.paused || !this.started) return;
      this.hideControls();
    }, HIDE_AFTER_MS);
  }

  private togglePause(): void {
    if (this.failed) return;
    if (this.waitingForTap) {
      this.waitingForTap = false;
      this.play();
      this.armStall(this.token, NEVER_STARTED_MS);
    } else if (this.video.paused) this.play();
    else this.video.pause();
    this.restartHideTimer();
  }

  private renderPlay(): void {
    const paused = this.video.paused;
    this.playButton.innerHTML = paused ? ICONS.play : ICONS.pause;
    this.playButton.setAttribute("aria-label", paused ? "Play" : "Pause");
  }

  private renderBar(): void {
    const duration = this.duration;
    const position = this.seeking >= 0 ? this.seeking : this.position;
    const shown = this.dragging ? this.dragTarget : position;
    setText(this.elapsedEl, formatClock(shown));
    setText(this.remainingEl, duration > 0 ? "-" + formatClock(Math.max(0, duration - shown)) : "");
    const fraction = barFraction(shown, duration);
    this.fillEl.style.width = fraction * 100 + "%";
    this.knobEl.style.left = fraction * 100 + "%";
    // How far the video can jump without the helper starting again.
    const seekable = this.video.seekable;
    let reach = 0;
    if (seekable && seekable.length > 0 && duration > 0) reach = barFraction(this.offset + seekable.end(seekable.length - 1), duration);
    const from = this.route === "helper" ? barFraction(this.offset, duration) : 0;
    this.bufferEl.style.left = from * 100 + "%";
    this.bufferEl.style.width = Math.max(0, reach - from) * 100 + "%";
    toggle(this.bubbleEl, "is-visible", this.dragging);
    if (this.dragging) {
      setText(this.bubbleEl, formatClock(shown));
      this.bubbleEl.style.left = fraction * 100 + "%";
    }
  }

  private note(text: string, ms = NOTE_MS): void {
    setText(this.noteEl, text);
    toggle(this.noteEl, "is-visible", text !== "");
    window.clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => toggle(this.noteEl, "is-visible", false), ms);
  }

  // What the lock screen and Control Center show.
  private mediaSession(): void {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    const item = this.item;
    const w = this.watching;
    const art = w.kind === "movie" ? item.poster : w.poster || "";
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: w.kind === "movie" ? item.title : episodeCode(item.seasonNo, item.episodeNo) + "  " + item.title,
        artist: w.kind === "movie" ? "ARAN+" : w.seriesName || "ARAN+",
        artwork: art ? [{ src: art }] : [],
      });
      navigator.mediaSession.setActionHandler("seekbackward", () => this.jumpBy(-10));
      navigator.mediaSession.setActionHandler("seekforward", () => this.jumpBy(10));
      navigator.mediaSession.setActionHandler("nexttrack", hasNext(w, this.index) ? () => this.playNext() : null);
    } catch {
      // Not every action is supported everywhere.
    }
  }

  // --- Panels: Audio & subtitles, Episodes ------------------------------------------

  private openPanel(panel: Panel): void {
    this.panel = panel;
    this.hideControls();
    this.renderPanel();
    this.show(this.panelEl, true);
  }

  private closePanel(): void {
    if (!this.panel) return;
    this.panel = "";
    this.show(this.panelEl, false);
    this.showControls();
  }

  private renderPanel(): void {
    if (!this.panel) return;
    const body = h("div", { class: "player-panel-body" });
    const close = onTap(iconButton("round-button", ICONS.close, "Close"), () => this.closePanel());
    const heading = this.panel === "tracks" ? "Audio & subtitles" : "Episodes";
    this.panelEl.textContent = "";
    this.panelEl.appendChild(h("div", { class: "player-panel-head" }, [h("div", { class: "player-panel-title", text: heading }), close]));
    this.panelEl.appendChild(body);
    if (this.panel === "episodes") this.renderEpisodes(body);
    else this.renderTracks(body);
  }

  private renderEpisodes(body: HTMLElement): void {
    const queue = this.watching.queue || [];
    let season = -1;
    queue.forEach((ep, i) => {
      if (ep.seasonNo !== season) {
        season = ep.seasonNo;
        body.appendChild(h("div", { class: "panel-heading", text: season === 0 ? "Specials" : "Season " + season }));
      }
      const row = h("button", { class: "panel-option" + (i === this.index ? " is-on" : ""), attrs: { type: "button" } }, [
        h("span", { text: (ep.episodeNo || i + 1) + ".  " + ep.title }),
      ]);
      if (i === this.index) row.insertAdjacentHTML("beforeend", ICONS.check);
      body.appendChild(onTap(row, () => this.goToEpisode(i)));
    });
    const on = body.querySelector(".is-on");
    if (on) window.requestAnimationFrame(() => on.scrollIntoView({ block: "center" }));
  }

  private renderTracks(body: HTMLElement): void {
    body.appendChild(h("div", { class: "panel-heading", text: "AUDIO" }));
    const currentAudio = this.currentAudioId();
    if (this.audioOpts.length === 0) body.appendChild(h("div", { class: "panel-empty", text: this.started ? "This file's own sound." : "Once it plays." }));
    for (const option of this.audioOpts) body.appendChild(this.optionEl(option.label, option.id === currentAudio, () => this.chooseAudio(option)));
    body.appendChild(h("div", { class: "panel-heading", text: "SUBTITLES" }));
    const menu = subtitleMenu(this.embeddedOpts, this.online);
    const active = activeSubtitle(menu, this.subSource);
    menu.forEach((option, i) => {
      const busy = option.id === "os:busy";
      body.appendChild(this.optionEl(option.label, i === active, busy ? null : () => this.chooseSubtitle(option)));
    });
    // Through the helper, the sound may not be the file's own format any more.
    const session = this.route === "helper" ? this.session : null;
    const converted = session && session.audioPlan !== "copy" && session.audioPlan !== "" ? session.audio[session.audioTrack] : null;
    const soundNote = converted ? "Your computer converts this sound (" + codecLabel(converted.codec) + ") to AAC." : audioNowText(this.audioOpts, currentAudio);
    const notes = [soundNote, tracksNote(this.online, this.embeddedOpts.length - 1)].filter((n) => n !== "");
    if (notes.length) body.appendChild(h("p", { class: "panel-note", text: notes.join(" ") }));
  }

  private optionEl(label: string, on: boolean, action: (() => void) | null): HTMLElement {
    const el = h("button", { class: "panel-option" + (on ? " is-on" : "") + (action ? "" : " is-busy"), attrs: { type: "button" } }, [h("span", { text: label })]);
    if (on) el.insertAdjacentHTML("beforeend", ICONS.check);
    if (action) onTap(el, action);
    return el;
  }

  // --- Tracks -----------------------------------------------------------------------

  private resetSubtitles(): void {
    this.osToken++;
    this.online = freshOnline(loadOsAccount() !== null);
    this.onlineCues = null;
    this.fileCues = {};
    this.subSource = { kind: "off" };
    this.hash = "";
    this.audioOpts = [];
    this.embeddedOpts = subtitleOptions([]);
    this.tracksApplied = false;
    window.clearTimeout(this.autoTimer);
    window.clearInterval(this.subtitleTimer);
    this.setCues([]);
  }

  // The helper's description of the file: its sound tracks (one plays at a time; another
  // is a new session) and the subtitle files it writes.
  private readTracks(session: HlsStart): void {
    this.audioOpts = audioOptions(session.audio.map((a) => ({ id: String(a.index), language: a.language, description: a.title, format: a.codec })));
    this.embeddedOpts = subtitleOptions(
      session.subtitles.map((s) => ({ id: "sub:" + s.index, language: s.language, description: s.title || (s.forced ? "Forced" : "") })),
    );
  }

  // A file played as it is: Safari lists its sound tracks itself.
  private readDirectTracks(): void {
    const list = (this.video as unknown as { audioTracks?: { length: number; [i: number]: { id: string; language: string; label: string; enabled: boolean } } }).audioTracks;
    if (!list || list.length < 2) return;
    const inputs = [];
    for (let i = 0; i < list.length; i++) inputs.push({ id: String(i), language: list[i].language || "", description: list[i].label || "" });
    this.audioOpts = audioOptions(inputs);
  }

  private currentAudioId(): string {
    if (this.route === "helper") return String(this.audioTrack < 0 ? 0 : this.audioTrack);
    const list = (this.video as unknown as { audioTracks?: { length: number; [i: number]: { enabled: boolean } } }).audioTracks;
    if (list) for (let i = 0; i < list.length; i++) if (list[i].enabled) return String(i);
    return "0";
  }

  private chooseAudio(option: TrackOption): void {
    if (option.language) savePref("audio", option.language);
    if (this.route === "helper") {
      if (Number(option.id) === this.audioTrack) return this.closePanel();
      this.audioTrack = Number(option.id);
      this.closePanel();
      this.note("Switching to " + option.label + "…");
      this.reopenAt(this.position);
      return;
    }
    const list = (this.video as unknown as { audioTracks?: { length: number; [i: number]: { enabled: boolean } } }).audioTracks;
    if (list) for (let i = 0; i < list.length; i++) list[i].enabled = String(i) === option.id;
    this.renderPanel();
  }

  // Once the video plays: the subtitles remembered from earlier videos.
  private applyTrackChoices(): void {
    if (this.tracksApplied) return;
    this.tracksApplied = true;
    const plan = subtitlePlan(loadPrefs().subtitles || "", this.embeddedOpts, this.online.configured);
    if (plan.kind === "embedded") this.showFileSubtitles(plan.id);
    else if (plan.kind === "online") this.autoTimer = window.setTimeout(() => this.startOnlineSearch(true), AUTO_SUBTITLES_AFTER_MS);
    log("tracks: audio", this.audioOpts.length, "subtitles", this.embeddedOpts.length - 1, "showing", plan.kind);
  }

  private chooseSubtitle(option: TrackOption): void {
    const id = option.id;
    if (id === "") {
      savePref("subtitles", "off");
      this.subSource = { kind: "off" };
      window.clearInterval(this.subtitleTimer);
      this.setCues([]);
    } else if (id.indexOf("sub:") === 0) {
      savePref("subtitles", option.language || "off");
      this.showFileSubtitles(id);
    } else if (id === "os:setup") {
      this.closePanel();
      this.app.push(new SubtitleSetupScreen(this.app));
      return;
    } else if (id === "os:search") this.startOnlineSearch(false);
    else if (id === "os:earlier" || id === "os:later") {
      this.online.delayMs += id === "os:later" ? NUDGE_MS : -NUDGE_MS;
      this.subSource = { kind: "online", fileId: this.online.loadedFileId };
      this.rebuildCues();
    } else if (id.indexOf("os:file:") === 0) {
      const fileId = id.slice(8);
      if (fileId === this.online.loadedFileId && this.onlineCues) {
        this.subSource = { kind: "online", fileId };
        savePref("subtitles", "online");
        this.rebuildCues();
      } else this.downloadSubtitle(fileId);
    }
    this.renderPanel();
  }

  // Back from the OpenSubtitles setup: pick up the account.
  onShow(): void {
    const configured = loadOsAccount() !== null;
    if (configured !== this.online.configured) {
      this.online = freshOnline(configured);
      this.renderPanel();
    }
  }

  private showFileSubtitles(id: string): void {
    this.subSource = { kind: "embedded", id };
    window.clearInterval(this.subtitleTimer);
    this.loadFileSubtitles(id, true);
    // The helper writes them as it goes; read them again now and then until it's done.
    this.subtitleTimer = window.setInterval(() => {
      if (this.subSource.kind === "embedded" && this.subSource.id === id) this.loadFileSubtitles(id, false);
    }, SUBTITLE_REFRESH_MS);
  }

  private loadFileSubtitles(id: string, show: boolean): void {
    const session = this.session;
    const index = Number(id.slice(4));
    const sub = session ? session.subtitles.filter((s) => s.index === index)[0] : null;
    if (!session || !sub) return;
    const url = sub.url;
    send({ url, timeoutMs: 15000, maxBytes: 8 * 1024 * 1024 }).promise.then((res) => {
      if (this.session !== session || this.subSource.kind !== "embedded" || this.subSource.id !== id) return;
      if (res.code !== 200) {
        if (show) this.note("Couldn't read this file's subtitles from your computer.");
        return;
      }
      this.fileCues[id] = parseSubtitles(res.text);
      this.rebuildCues();
    });
  }

  // The cues on screen, timed for the video's clock: the file's own already are (the
  // helper writes them from where its session starts); online ones are timed for the
  // whole file, so the session's start comes off, and the nudges apply.
  private rebuildCues(): void {
    const source = this.subSource;
    if (source.kind === "embedded") this.setCues(this.fileCues[source.id] || []);
    else if (source.kind === "online" && this.onlineCues) {
      const shift = this.online.delayMs - this.offset * 1000;
      this.setCues(this.onlineCues.map((c) => ({ start: c.start + shift, end: c.end + shift, text: c.text })).filter((c) => c.end > 0));
    } else this.setCues([]);
  }

  private setCues(cues: Cue[]): void {
    let track = this.textTrack;
    if (!track) {
      if (cues.length === 0) return;
      track = this.video.addTextTrack("subtitles", "Subtitles", "en");
      this.textTrack = track;
    }
    const old = track.cues;
    if (old) for (let i = old.length - 1; i >= 0; i--) track.removeCue(old[i]);
    for (const cue of cues) {
      try {
        track.addCue(new VTTCue(Math.max(0, cue.start / 1000), Math.max(0.1, cue.end / 1000), cue.text));
      } catch {
        // A cue the browser won't take.
      }
    }
    track.mode = cues.length > 0 ? "showing" : "hidden";
  }

  private startOnlineSearch(auto: boolean): void {
    const account = loadOsAccount();
    if (!account || this.failed || this.closing) return;
    const token = ++this.osToken;
    const item = this.item;
    const w = this.watching;
    const req: FindRequest =
      w.kind === "movie"
        ? { kind: "movie", title: item.title, tmdbId: item.tmdbId, season: 0, episode: 0, hash: this.hash }
        : { kind: "episode", title: w.seriesName || "", tmdbId: w.tmdbId || "", season: item.seasonNo, episode: item.episodeNo, hash: this.hash };
    this.online.state = "searching";
    this.online.message = "";
    this.renderPanel();
    new OsClient(account).find(req).then((result) => {
      if (token !== this.osToken) return;
      if (!result.ok) {
        this.online.state = "error";
        this.online.message = result.error;
      } else if (result.candidates.length === 0) this.online.state = "none";
      else {
        this.online.state = "results";
        this.online.candidates = result.candidates;
        if (auto) this.downloadSubtitle(result.candidates[0].fileId);
      }
      log("subtitle search:", this.online.state, result.candidates.length, "found", this.hash ? "with hash" : "without hash");
      this.renderPanel();
    });
  }

  private downloadSubtitle(fileId: string): void {
    const account = loadOsAccount();
    if (!account || !fileId) return;
    const token = ++this.osToken;
    this.online.state = "downloading";
    this.renderPanel();
    new OsClient(account).download(fileId).then((result) => {
      if (token !== this.osToken) return;
      const cues = result.ok ? parseSubtitles(result.text) : [];
      if (!result.ok || cues.length === 0) {
        this.online.state = "error";
        this.online.message = result.ok ? "The subtitle file was empty or unreadable." : result.error;
        this.renderPanel();
        return;
      }
      this.online.state = "results";
      this.online.remaining = result.remaining;
      this.online.loadedFileId = fileId;
      this.online.delayMs = 0;
      this.onlineCues = cues;
      // Later videos without English subtitles of their own fetch the best match.
      savePref("subtitles", "online");
      this.subSource = { kind: "online", fileId };
      window.clearInterval(this.subtitleTimer);
      this.rebuildCues();
      log("online subtitles:", cues.length, "cues");
      this.renderPanel();
    });
  }

  // --- Leaving ----------------------------------------------------------------------

  private clearTimers(): void {
    for (const timer of [this.hideTimer, this.stallTimer, this.retryTimer, this.countdownTimer, this.noteTimer, this.autoTimer]) window.clearTimeout(timer);
    window.clearInterval(this.stuckTimer);
    window.clearInterval(this.subtitleTimer);
  }

  destroy(): void {
    this.saveProgress();
    this.closing = true;
    this.clearTimers();
    window.clearInterval(this.syncTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    const session = this.route === "helper" && this.session ? this.session.session : "";
    // A session still starting is stopped by the helper itself once this request is gone.
    this.stopSource();
    // Frees the provider's one connection for the next title (or the TV).
    stopHelper(session);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    this.app.library?.hold(false);
    // Right after leaving a video, so another device can pick up where this one stopped.
    if (this.app.sync) this.app.sync.now();
  }
}
