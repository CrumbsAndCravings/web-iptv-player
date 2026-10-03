// Starting playback from anywhere: a movie, an episode with the rest of its series
// queued after it (specials last, as on the TV), or straight from a Continue Watching
// entry (the hero's Resume).

import type { App } from "../app";
import { Item, makeItem } from "../core/items";
import type { ProgressEntry } from "../core/progress";
import { toInt } from "../core/utils";
import type { Watching } from "../core/watch";
import { episodeItem, Season } from "../core/xtream";
import { PlayerScreen } from "./player";

// Episodes in play order: the regular seasons, then specials.
export function playOrder(seasons: Season[], seriesId: string): Item[] {
  const regular = seasons.filter((s) => s.seasonNo > 0);
  const specials = seasons.filter((s) => s.seasonNo === 0);
  const order: Item[] = [];
  for (const season of regular.concat(specials)) for (const ep of season.episodes) order.push(episodeItem(ep, seriesId));
  return order;
}

export function playMovie(app: App, movie: Item, startSecs: number): void {
  app.push(new PlayerScreen(app, { kind: "movie", movie }, 0, startSecs));
}

// `series` is the show (its title, poster, backdrop and TMDB id travel with each entry).
export function playEpisode(app: App, series: Item, seasons: Season[], episodeId: string, startSecs: number): void {
  const queue = playOrder(seasons, series.itemId);
  if (queue.length === 0) return;
  // An episode the provider no longer lists starts the show from the beginning.
  const found = queue.findIndex((ep) => ep.itemId === episodeId);
  const index = Math.max(0, found);
  const watching: Watching = {
    kind: "episode",
    seriesId: series.itemId,
    seriesName: series.title,
    poster: series.poster,
    backdrop: series.backdrop,
    tmdbId: series.tmdbId,
    queue,
  };
  app.push(new PlayerScreen(app, watching, index, found >= 0 ? startSecs : 0));
}

// Resume from a Continue Watching entry. A series needs its episode list first, so the
// next episode can follow.
export function resumeEntry(app: App, entry: ProgressEntry, shown: Item): void {
  const pos = toInt(entry.pos);
  if (entry.kind === "movie") {
    playMovie(app, makeItem({ kind: "movie", itemId: entry.id, title: entry.name, poster: entry.poster, backdrop: entry.bd, ext: entry.ext, tmdbId: shown.tmdbId }), pos);
    return;
  }
  const api = app.api;
  const seriesId = entry.sid || shown.itemId;
  if (!api || !seriesId) return;
  app.toast("Getting the episodes…", 8000);
  api.seriesInfo(seriesId).then(
    ({ info, seasons }) => {
      const series = makeItem({ kind: "series", itemId: seriesId, seriesId, title: info.name || entry.name, poster: entry.poster || info.poster, backdrop: entry.bd || info.backdrop, tmdbId: info.tmdbId });
      if (playOrder(seasons, seriesId).length === 0) {
        app.toast("Your provider hasn't listed any episodes for this show.");
        return;
      }
      app.toast("", 1);
      playEpisode(app, series, seasons, entry.id, pos);
    },
    (err: Error) => app.toast(err.message, 6000),
  );
}
