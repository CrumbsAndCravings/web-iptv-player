// What this browser plays, and HLS for browsers that don't play it themselves. Safari
// on an iPhone plays HLS natively (and should: it is lighter on the battery and works
// with AirPlay and picture in picture); desktop Chrome and Firefox get hls.js, which is
// only downloaded then.

import { log } from "../core/log";

let hevc: boolean | null = null;
let hls: boolean | null = null;

// HLS without help (Safari, and some newer Chrome builds).
export function nativeHls(): boolean {
  if (hls === null) {
    try {
      hls = document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";
    } catch {
      hls = false;
    }
  }
  return hls;
}

// Whether HEVC pictures play here, so the helper can keep them as they are (every iPhone
// from the 7 on decodes HEVC; most desktop browsers don't).
export function canPlayHevc(): boolean {
  if (hevc === null) {
    const type = 'video/mp4; codecs="hvc1.1.6.L120.90"';
    try {
      hevc = document.createElement("video").canPlayType(type) !== "";
      if (!hevc && !nativeHls() && typeof MediaSource !== "undefined") hevc = MediaSource.isTypeSupported(type);
    } catch {
      hevc = false;
    }
  }
  return hevc;
}

export interface Attached {
  stop(): void;
}

// Plays an HLS playlist in `video`, from `startAt` seconds (-1: where the playlist says,
// as Safari does). `onFatal` hears about failures hls.js can't recover from; Safari
// reports its own through the video's "error" event.
export async function attachHls(video: HTMLVideoElement, url: string, onFatal: (reason: string) => void, startAt = 0): Promise<Attached> {
  if (nativeHls()) {
    video.src = url;
    return { stop: () => detach(video) };
  }
  const Hls = (await import("hls.js")).default;
  if (!Hls.isSupported()) {
    onFatal("This browser can't play HLS streams.");
    return { stop: () => undefined };
  }
  // A growing playlist is played from its start, never pulled to its end like live TV.
  const player = new Hls({ startPosition: startAt, liveDurationInfinity: false, maxBufferLength: 60, backBufferLength: 120 });
  let stopped = false;
  let recovered = false;
  player.on(Hls.Events.ERROR, (_event, data) => {
    if (stopped || !data.fatal) return;
    log("hls.js:", data.type, data.details, "(fatal)");
    // A hiccup in decoding gets one more go; a picture or sound this browser can't
    // decode at all (bufferAddCodecError) doesn't.
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered && data.details !== "bufferAddCodecError") {
      recovered = true;
      player.recoverMediaError();
      return;
    }
    stopped = true;
    onFatal(data.details === "bufferAddCodecError" ? "DECODE (this browser can't play this picture or sound)" : "HLS " + data.details);
  });
  player.loadSource(url);
  player.attachMedia(video);
  return {
    stop: () => {
      stopped = true;
      player.destroy();
      detach(video);
    },
  };
}

// A plain file (the provider's MP4s): every browser plays those itself.
export function attachFile(video: HTMLVideoElement, url: string): Attached {
  video.src = url;
  return { stop: () => detach(video) };
}

export function detach(video: HTMLVideoElement): void {
  video.removeAttribute("src");
  try {
    video.load();
  } catch {
    // Nothing loaded.
  }
}

// MediaError codes in words.
export function mediaErrorLabel(error: MediaError | null): string {
  if (!error) return "UNKNOWN";
  const names = ["", "ABORTED", "NETWORK", "DECODE", "NOT_SUPPORTED"];
  const name = names[error.code] || "CODE_" + error.code;
  return error.message ? name + " (" + error.message + ")" : name;
}

// The device can show the video in picture in picture.
export function canPip(video: HTMLVideoElement): boolean {
  if (video.webkitSupportsPresentationMode && video.webkitSupportsPresentationMode("picture-in-picture")) return true;
  return typeof document !== "undefined" && !!document.pictureInPictureEnabled;
}

export function togglePip(video: HTMLVideoElement): void {
  if (video.webkitSupportsPresentationMode && video.webkitSetPresentationMode && video.webkitSupportsPresentationMode("picture-in-picture")) {
    const mode = (video as unknown as { webkitPresentationMode?: string }).webkitPresentationMode;
    video.webkitSetPresentationMode(mode === "picture-in-picture" ? "inline" : "picture-in-picture");
    return;
  }
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => undefined);
  else video.requestPictureInPicture().catch((err: Error) => log("picture in picture:", err.message));
}

// Full screen: Apple's own player on an iPhone (no other element can go full screen
// there); the player screen itself elsewhere.
export function enterFullscreen(video: HTMLVideoElement, container: HTMLElement): void {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => undefined);
    return;
  }
  if (container.requestFullscreen && document.fullscreenEnabled) {
    container.requestFullscreen().catch(() => video.webkitEnterFullscreen && video.webkitEnterFullscreen());
    return;
  }
  if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
}
