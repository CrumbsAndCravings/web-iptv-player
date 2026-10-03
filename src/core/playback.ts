// Pure helpers for the player's seeking, ported from the Roku app's Playback.brs.

// Keeps a seek target (seconds) inside the video. Duration 0 means unknown.
export function clampSeek(target: number, duration: number): number {
  let t = target;
  if (duration > 0 && t > duration - 3) t = duration - 3;
  if (t < 0) t = 0;
  return t;
}

// 0..1 share of the bar for a position.
export function barFraction(position: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(1, position / duration));
}
