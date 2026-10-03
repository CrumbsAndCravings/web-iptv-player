// Settings, behind the account button: which account the helper on your computer uses,
// the languages whose categories to show, online subtitles, loading the library again,
// and the recent log (with the account, keys and server hidden), for a screenshot when
// something goes wrong.

import type { App, Screen } from "../app";
import { LANGUAGE_NAMES } from "../core/categories";
import { logLines } from "../core/log";
import { accountCreds, helperVersion, languagePrefs } from "../core/personal";
import { redact } from "../core/redact";
import { loadOsAccount, readJson, regDelete, writeJson } from "../core/storage";
import { isArr } from "../core/utils";
import { deleteStoredLibrary } from "../data/library";
import { h, iconButton, onTap, setText, toggle } from "../ui/dom";
import { ICONS } from "../ui/icons";
import { SubtitleSetupScreen } from "./subtitle-setup";

const ENCODER_NAMES: { [name: string]: string } = {
  h264_nvenc: "the NVIDIA graphics card",
  h264_qsv: "Intel Quick Sync",
  h264_amf: "the AMD graphics card",
  libx264: "the processor",
};

const LANGS = ["en", "hi", "pa", "other"];

// On an iPhone or iPad, in Safari rather than from the Home Screen.
export function inSafariTab(): boolean {
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return !standalone && /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export class SettingsScreen implements Screen {
  readonly el: HTMLElement;
  private subtitlesState: HTMLElement;
  private langBoxes: { lang: string; input: HTMLInputElement }[] = [];
  private langNote: HTMLElement;
  private changedLanguages = false;

  constructor(
    private app: App,
    private onLibraryChange: () => void,
  ) {
    const creds = accountCreds();
    const helper = helperVersion();
    const host = creds ? creds.server.replace(/^https?:\/\//i, "") : "";
    const setup = [
      h("p", { text: creds ? "Watching " + creds.username + "'s account at " + host + ", through the helper on your computer." : "Through the helper on your computer." }),
      helper.version ? h("p", { class: "dim", text: "Helper " + helper.version + (helper.encoder ? ", converting pictures with " + (ENCODER_NAMES[helper.encoder] || helper.encoder) : "") + "." }) : null,
      h("p", { class: "dim", text: "To use another account, change the login in personal.json on your computer and start the helper again." }),
    ];

    const langList = h("div", { class: "checks" });
    const chosen = languagePrefs();
    for (const lang of LANGS) {
      const input = h("input", { attrs: { type: "checkbox" } });
      input.checked = chosen.length === 0 || chosen.indexOf(lang) >= 0;
      input.addEventListener("change", () => this.saveLanguages());
      this.langBoxes.push({ lang, input });
      langList.appendChild(h("label", { class: "check" }, [input, h("span", { text: LANGUAGE_NAMES[lang] })]));
    }
    this.langNote = h("p", { class: "dim" });
    this.describeLanguages();

    this.subtitlesState = h("span", { class: "dim" });
    const subtitles = onTap(h("button", { class: "setting-link", attrs: { type: "button" } }, [h("span", { text: "Online subtitles" }), this.subtitlesState]), () =>
      this.app.push(new SubtitleSetupScreen(this.app)),
    );
    subtitles.insertAdjacentHTML("beforeend", ICONS.chevron);

    const reload = onTap(h("button", { class: "button", text: "Load the library again", attrs: { type: "button" } }), () => {
      this.resetLibrary();
      this.app.toast("Loading your library again in the background.");
    });

    const logBox = h("pre", { class: "log is-hidden" });
    const logButton = onTap(h("button", { class: "button", text: "Show the recent log", attrs: { type: "button" } }), () => {
      const lines = logLines().map((line) => new Date(line.at).toLocaleTimeString() + "  " + redact(line.text));
      setText(logBox, lines.join("\n") || "Nothing yet.");
      toggle(logBox, "is-hidden", false);
      setText(logButton, "Refresh the log");
    });

    const back = onTap(iconButton("round-button", ICONS.back, "Back"), () => this.app.back());
    this.el = h("div", { class: "page" }, [
      h("header", { class: "page-header" }, [back, h("h1", { class: "page-title", text: "Settings" })]),
      h("div", { class: "page-body settings" }, [
        h("section", { class: "setting" }, [h("h2", { text: "Your setup" }), ...setup]),
        h("section", { class: "setting" }, [h("h2", { text: "Languages" }), h("p", { class: "dim", text: "Categories in these languages show on Home, in the tabs and in search." }), langList, this.langNote]),
        h("section", { class: "setting" }, [h("h2", { text: "Subtitles" }), subtitles]),
        h("section", { class: "setting" }, [
          h("h2", { text: "Library" }),
          h("p", { class: "dim", text: "Search and category pages use a copy of your library kept on this phone, refreshed once a day." }),
          reload,
        ]),
        inSafariTab()
          ? h("section", { class: "setting" }, [h("h2", { text: "On your Home Screen" }), h("p", { class: "dim", text: "In Safari, tap Share, then Add to Home Screen. ARAN+ then opens full screen, like an app." })])
          : null,
        h("section", { class: "setting" }, [h("h2", { text: "When something goes wrong" }), h("p", { class: "dim", text: "The log hides your account, server and keys, so a screenshot is safe to share." }), logButton, logBox]),
        h("p", { class: "dim about", text: "ARAN+ for iPhone " + __APP_VERSION__ }),
      ]),
    ]);
  }

  onShow(): void {
    const account = loadOsAccount();
    setText(this.subtitlesState, account ? (account.username ? "Connected as " + account.username : "Connected") : "Off");
  }

  destroy(): void {
    if (this.changedLanguages) this.onLibraryChange();
  }

  private describeLanguages(): void {
    const saved = readJson("prefs", "languages");
    setText(this.langNote, isArr(saved) ? "Chosen on this phone." : "As set in personal.json on your computer.");
  }

  private saveLanguages(): void {
    const picked = this.langBoxes.filter((b) => b.input.checked).map((b) => b.lang);
    // None ticked means all of them.
    if (picked.length === LANGS.length || picked.length === 0) regDelete("prefs", "languages");
    else writeJson("prefs", "languages", picked);
    if (picked.length === 0) for (const b of this.langBoxes) b.input.checked = true;
    this.describeLanguages();
    this.changedLanguages = true;
    // Only the languages you watch are in the stored library, so it loads again.
    this.resetLibrary();
  }

  private resetLibrary(): void {
    const creds = accountCreds();
    deleteStoredLibrary().then(() => {
      this.app.useAccount(creds);
      this.changedLanguages = true;
    });
  }
}
