// ARAN+ for iPhone, served by the helper on your computer. Starts straight into the
// tabs when this phone has used the helper before (the account it uses is remembered),
// and checks with the helper in the background; the first time, it asks the helper
// first. Without the helper's key, or when the helper turns the key away, it explains
// how to connect.

import "./styles/app.css";
import { App } from "./app";
import { log, logError } from "./core/log";
import { accountCreds, savePersonal } from "./core/personal";
import { regDelete } from "./core/storage";
import type { Creds } from "./core/utils";
import { fetchSettings, keyFromAddress, setHelperKey } from "./data/helper";
import { deleteStoredLibrary } from "./data/library";
import { NO_HELPER, WRONG_KEY } from "./platform/http";
import { ConnectScreen } from "./screens/connect";
import { Shell } from "./screens/shell";
import { h } from "./ui/dom";

function stamp(creds: Creds | null): string {
  return creds ? creds.server.toLowerCase() + " " + creds.username : "";
}

function boot(): void {
  log("ARAN+ for iPhone " + __APP_VERSION__ + " starting");
  window.addEventListener("error", (event) => logError("uncaught:", event.message, event.filename + ":" + event.lineno));
  window.addEventListener("unhandledrejection", (event) => logError("unhandled rejection:", String(event.reason)));
  const root = document.getElementById("app");
  if (!root) return;
  const app = new App(root);

  const start = (creds: Creds) => {
    app.useAccount(creds);
    app.resetTo(new Shell(app));
  };

  const showConnect = (reason: string) => app.resetTo(new ConnectScreen(reason, connect));

  // Asks the helper for its settings. `shown`: the tabs are up already (from last time).
  const check = (shown: boolean) => {
    fetchSettings().then(
      (settings) => {
        const before = stamp(accountCreds());
        savePersonal(settings);
        const creds = accountCreds();
        if (!creds) return showConnect("The helper didn't say which account it uses. Check personal.json on your computer.");
        if (shown && stamp(creds) === before) {
          app.refreshSecrets();
          return;
        }
        // Another account: its Continue Watching and library belong to the old one.
        if (before && stamp(creds) !== before) {
          log("the helper uses another account now");
          regDelete("progress", "items");
          regDelete("progress", "removed");
          deleteStoredLibrary();
        }
        start(creds);
      },
      (err: Error) => {
        log("helper check failed:", err.message);
        if (err.message === WRONG_KEY || !shown) showConnect(err.message === NO_HELPER || err.message === WRONG_KEY ? err.message : "The helper on your computer answered, but not as expected. " + err.message);
        else app.toast(err.message, 6000);
      },
    );
  };

  function connect(key: string): void {
    if (key) setHelperKey(key);
    app.resetTo(new Splash());
    check(false);
  }

  if (!keyFromAddress()) {
    showConnect("This phone doesn't have the helper's key yet.");
    return;
  }
  const known = accountCreds();
  if (known) {
    start(known);
    check(true);
  } else connect("");
}

// While the helper is asked for the first time.
class Splash {
  readonly el = h("div", { class: "page splash" }, [h("div", { class: "logo is-large" }, [h("span", { class: "logo-name", text: "ARAN" }), h("span", { class: "logo-plus", text: "+" })]), h("div", { class: "splash-spinner" })]);
}

boot();
