# ARAN+ for iPhone

ARAN+, the cosy Netflix-style IPTV player from the [Roku](https://github.com/CrumbsAndCravings/roku-iptv-player) and [Samsung](https://github.com/CrumbsAndCravings/Samsung-IPTV-Player) apps, as a web app for the iPhone. Add it to the Home Screen and it opens full screen, like an app.

It works through **the helper on your computer**, the small program in the Samsung repo's `helper/` folder that already converts files for the TV. For the iPhone the helper does more:

- **It serves the app.** The iPhone opens the helper's address on your home Wi-Fi.
- **It talks to your provider.** A web page can't call an IPTV provider itself (the provider doesn't allow it, and the page would need your password), so the helper asks for the lists with the login in `personal.json`. Your password never reaches the phone.
- **It converts what Safari can't play.** Safari plays MP4 files, but not MKV (about 4 in 5 of the provider's movies), AVI, or DTS sound. The helper converts those with FFmpeg into HLS, the streaming format Safari plays, while you watch: H.264 pictures and AAC sound, in six-second pieces. The phone gets a playlist for the whole film at once, as from any streaming service, so it knows the length, starts in a few seconds and jumps by itself; the helper makes each piece as it's asked for.

## What it does

- **Home, Movies, Series, Categories and Search** along the bottom, as on the TV. Home has a big picture of what you were watching (or the newest title) with **Resume**, then Continue Watching and up to 18 rows: new releases first, then movies and series taking turns, with each of your languages taking turns. Each row scrolls sideways and ends with **See all**.
- **Your languages.** Categories are read for their language and tidied (`EN ✪ ACTION` becomes "Action"); with languages set in `personal.json` (or in Settings on the phone), the others are left out of every tab and of search.
- **A category's page** lists every title in it, newest first, with a search box that narrows it as you type.
- **Search** covers your whole library, kept on the phone: Categories, Movies and Series rows that update as you type. The first time, the library loads in the background (gently, a couple of lists at a time); after that it's searched at once and refreshed once a day.
- **Details** for movies (Play, or Resume and Play from start) and series (season pills, and the episode list with stills, runtimes and synopses). **Remove from Continue Watching** when a title is on it; on Home, hold a Continue Watching poster (or tap ⋯) to remove it.
- **The player.** Tap to show the controls: close and the title at the top, back 10 s, play/pause and forward 10 s in the middle, the bar with the times, then **Audio & subtitles**, **Episodes**, **Next episode**, picture in picture, AirPlay and full screen. Double-tap the left or right side to jump 10 s. Drag along the bar to jump anywhere, with a picture of the moment under your finger, as on Netflix (made by the helper from what it has already converted, so it costs the provider nothing; further on than it has got to, you see the time alone). The lighter part of the bar is what the phone has loaded, where jumps are instant, and a jump further away takes a few seconds while the helper starts from there.
- **Resume and Continue Watching**, as on the TV: progress is saved every 15 seconds and when you leave, resuming starts 5 seconds early, movies drop off when finished and series move on to the next episode. **Up Next** counts down 8 seconds at the end of an episode.
- **Continue Watching on every device.** With the sync service in `personal.json`, the phone, the TV and the Roku share one list.
- **Audio & subtitles.** Each sound track of the file with its language and format ("Hindi · AAC"); the language you pick is played first next time. The file's own text subtitles, and English subtitles from OpenSubtitles (Settings, Online subtitles), with **1s earlier / later** to fix their timing. Subtitles show in full screen and picture in picture too.
- **Errors explain themselves**: what Safari said, what the file is, what the helper was doing and why it stopped ("Your computer says: ..."), and whether the provider refused the file.
- **Lock screen and Control Center** show the title and artwork, with skip buttons.
- **Motion, as on Netflix.** A poster grows into its title's page and shrinks back into its row (Safari's View Transitions, iOS 18 and newer; a page slides up on older ones). Pictures fade in as they arrive, rows and episode lists build in, Home's big picture settles in, a page's backdrop drifts and fades as you scroll, tabs fade across. In the player the controls slide in, double-tapping a side shows a ripple counting the seconds (keep tapping to add 10 more), the skip arrows turn and Up Next slides in. With Reduce Motion on, all of it is skipped.

## Set it up (once)

You need the computer that runs the helper (the one you set up for the TV), with [Node.js](https://nodejs.org) 22.12 or newer, FFmpeg, and `personal.json` holding your provider's login. If the TV's helper is running, all of that is done; see the Samsung repo's README, "The helper on your computer", if not.

1. **Get this repo next to the Samsung repo**, in the same folder, so they sit side by side:

   ```
   C:\Users\you\code\Samsung-IPTV-Player
   C:\Users\you\code\web-iptv-player
   ```

   In that folder: `git clone https://github.com/CrumbsAndCravings/web-iptv-player`.

2. **Build the app** in `web-iptv-player`:

   ```sh
   npm install
   npm run build
   ```

3. **Start the helper** as usual (in the Samsung repo, `npm run helper`, or `helper\start-helper.cmd`). It finds the app next door and prints a link and a QR code for the phone:

   ```
   On your iPhone (on the same Wi-Fi), open this link in Safari, or point the camera
   at the code. ...
     http://192.168.1.20:8090/app/?key=...
   ```

   If the folders aren't side by side, add `"webApp": "C:\\path\\to\\web-iptv-player\\dist"` under `"transcoder"` in `personal.json`.

4. **On the iPhone**, on the same Wi-Fi, point the camera at the code (or type the link into Safari). ARAN+ opens.

5. **Add it to the Home Screen:** tap Share, then **Add to Home Screen**. From then on, open it from its icon: it runs full screen, and remembers the helper's key.

The link holds the helper's key, so keep it to yourself. If Windows asks whether Node.js may use the network, allow **private networks** (the TV needs that too).

### On 5G and any Wi-Fi (Tailscale)

The link above works on the computer's own Wi-Fi only: the phone can't reach the computer from 5G, and not from a second Wi-Fi either when that is a separate network (an extender in router mode, a guest network). [Tailscale](https://tailscale.com), free for personal use, joins your own devices in a private network wherever they are, so the computer has one address the phone reaches from anywhere. The video travels encrypted, directly between the two when it can, and nothing is opened to the internet.

1. Install Tailscale on the computer ([tailscale.com/download](https://tailscale.com/download)) and sign in.
2. Install Tailscale on the iPhone (App Store), sign in with the same account and turn it on. Leave it on.
3. Restart the helper. It now shows a link starting with `http://100.` and its QR code: open that on the phone and add it to the Home Screen, in place of the old icon (each address keeps its own data on the phone; Continue Watching comes back through the sync service if you have it).

From then on ARAN+ works on 5G, on the main Wi-Fi and on the extender's. On 5G a film uses roughly 2 to 4 GB an hour, sent from your home connection's upload. If the new link doesn't open, Windows may be treating Tailscale as a public network: in Windows Security, Firewall, "Allow an app through firewall", tick **Public** for Node.js.

### Updating

Pull both repos, run `npm run build` here again, and restart the helper. The phone picks up the new version the next time it opens ARAN+.

## Good to know

- **Away from the computer's Wi-Fi** (5G, another network), ARAN+ needs Tailscale on the computer and the phone; see [On 5G and any Wi-Fi](#on-5g-and-any-wi-fi-tailscale). The TV can't run Tailscale, so it has to reach the computer over the home network.
- **What's kept, so it's quick:** Home's rows, the categories and the details you've opened stay on the phone, so ARAN+ opens at once and catches up in the background (a list is at most one launch behind; a series' episodes are checked again after 6 hours). The helper sends everything compressed, the phone keeps the app's files until a new build, and a film you go back to carries on with the pieces already made.
- **The computer must be on, with the helper running,** while you browse and watch. If it isn't, ARAN+ says the helper didn't answer.
- **One stream at a time.** The provider allows one connection, so the phone and the TV can't play at once; starting one stops the other.
- **The computer's work.** For the phone, the helper converts the picture of every MKV and AVI to H.264, as fast as it can from where you are (so a film is usually converted well before you get there). It uses the graphics card or Intel Quick Sync when there is one, otherwise the processor; a recent processor manages several times faster than the film plays. MP4 files play as they are.
- **Disk space.** While you watch, the helper keeps what it has converted in the computer's temp folder (roughly the size of the film), and deletes it a couple of minutes after you stop, or when it next starts.
- **Picture subtitles** (PGS, DVD) inside a file can't be shown; text ones can, and online ones always work.

## Troubleshooting

- **"The helper on your computer didn't answer"**: check the computer is on and awake, the helper's window is open, and the phone is on the same Wi-Fi (or Tailscale is on, with the Tailscale link). If the computer's address changed, the helper prints the new link; give the computer a fixed address in your router to stop that (the Tailscale address doesn't change).
- **"The key in this app's address doesn't match"**: the helper's key changed (a new `personal.json`). Open the new link from the helper, then add it to the Home Screen again.
- **A video won't start**: the error card says why. "Your computer says" lines come from the helper and FFmpeg; "HTTP 403 from ..." lines come from your provider; "Safari:" says where the video was, how ready it was (0 to 4), what it had loaded and how many frames it showed. The helper's window says what it did: "Ready to play", then "The phone opened the stream" and "The phone is playing" once the phone asks for it.
- **Settings** (the round button at the top right) has the recent log, with your account, server and keys hidden, so a screenshot is safe to share.

## Develop

```sh
npm install
npm run sample     # sample videos for the dev harness (needs FFmpeg)
npm run dev        # the app, a fake helper and a fake provider on http://localhost:8080
npm test           # unit tests (vitest)
npm run check      # typecheck, lint, tests and the build
npm run screens    # screenshots of each screen at iPhone size, in out/screens
npm run icons      # the Home Screen icons, drawn with Chromium
npm run build      # dist/, which the helper serves at /app/
```

`npm run dev` needs no provider, login or helper: `dev/fake-helper.mjs` answers like the real helper, backed by the fake Xtream server from the Samsung repo (`dev/mock-xtream.mjs`), and plays the sample videos through FFmpeg. Open it in a phone-sized browser window, or on a phone on the same Wi-Fi at this computer's address. The test browser that `npm run screens` drives can't decode H.264, so the fake helper sends it VP9 instead (`ARANPLUS_DEV_CODEC=vp9`).

To try the real helper with your changes, build and start it with `ARANPLUS_WEB_APP` naming this repo's `dist` folder.

### How it fits together

```
iPhone (Safari)  ──── home Wi-Fi ────  computer: the helper  ──── internet ────  provider
  this app                              serves /app/                             player_api.php
  /v1/xtream (lists)        ───►        adds the login       ───►                the files
  /v1/file (MP4s as they are)           passes ranges on
  /v1/hls/start (the rest)              FFmpeg: HLS (H.264, AAC), WebVTT subtitles
  /v1/fetch (OpenSubtitles)             passes on            ───►                OpenSubtitles
  sync (Continue Watching)  ─────────────────────────────────────────►          your Cloudflare Worker
```

### Layout

```
index.html  manifest.webmanifest       the page, and what Add to Home Screen reads
src/
  main.ts                              start: the helper's key and settings, then the tabs
  app.ts                               the screen stack (with Safari's back swipe), sheets, notes
  core/                                pure logic, unit tested; mostly the Samsung app's ports of
                                       the Roku app (Xtream parsing, categories, search, Continue
                                       Watching, subtitles), plus:
    compat.ts                          which way a title plays: as it is, or through the helper
    personal.ts                        the helper's settings: account, languages, sync
  data/
    helper.ts                          the helper's endpoints
    api.ts library.ts sync.ts          the provider's lists (through the helper), the stored
                                       library, Continue Watching sync
    opensubtitles.ts                   OpenSubtitles, through the helper
  platform/                            requests, big text kept on the phone, video (native HLS,
                                       hls.js only where a browser lacks it)
  ui/                                  DOM helpers, icons, posters and rows
  screens/                             tabs, Home/Movies/Series, Categories, a category's page,
                                       Search, Details, the player, Settings, Online subtitles,
                                       connecting
  styles/                              the TV apps' palette and fonts, for touch and safe areas
assets/                                fonts (SIL OFL) and Home Screen icons
dev/                                   fake helper, fake provider, fake OpenSubtitles, screenshots
tools/                                 build, dev server, sample videos, icons
tests/                                 vitest
```

The helper itself lives in the Samsung repo (`helper/`), so the TV and the phone share one.
