# ARAN+ for iPhone

ARAN+, the cosy Netflix-style IPTV player from the Roku and Samsung apps, as a web app for the iPhone. It is served by the ARAN+ helper on your computer (the `helper/` folder of [CrumbsAndCravings/Samsung-IPTV-Player](https://github.com/CrumbsAndCravings/Samsung-IPTV-Player)), which holds your provider login and converts what Safari can't play.

Setup steps and the full feature list follow in this README.

## Develop

```sh
npm install
npm run sample     # sample videos for the dev harness (needs FFmpeg)
npm run dev        # the app and a fake helper and provider on http://localhost:8080
npm test           # unit tests (vitest)
npm run check      # typecheck, lint, tests and the build
npm run screens    # screenshots of each screen at iPhone size, in out/screens
npm run build      # dist/, which the helper serves at /app/
```
