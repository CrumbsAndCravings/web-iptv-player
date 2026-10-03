// Online subtitles (the TV apps' SubtitleSetupScreen): the OpenSubtitles API key,
// username and password. Saved first, then checked, so nothing typed is lost when the
// check fails (a Roku lesson). They stay on this phone; OpenSubtitles is reached through
// the helper on your computer.

import type { App, Screen } from "../app";
import { log } from "../core/log";
import { readOsFields, regDelete, saveOsAccount } from "../core/storage";
import { OsClient } from "../data/opensubtitles";
import { h, iconButton, onTap, setText, toggle } from "../ui/dom";
import { ICONS } from "../ui/icons";

export class SubtitleSetupScreen implements Screen {
  readonly el: HTMLElement;
  private apiKey: HTMLInputElement;
  private username: HTMLInputElement;
  private password: HTMLInputElement;
  private status: HTMLElement;
  private removeButton: HTMLButtonElement;
  private alive = true;

  constructor(private app: App) {
    const saved = readOsFields();
    this.apiKey = this.input("text", saved.apiKey, "off");
    this.username = this.input("text", saved.username, "username");
    this.password = this.input("password", saved.password, "current-password");
    this.status = h("div", { class: "form-status", attrs: { role: "status" } });
    const save = onTap(h("button", { class: "button is-primary", text: "Save and test", attrs: { type: "submit" } }), (event) => {
      event.preventDefault();
      this.save();
    });
    this.removeButton = onTap(h("button", { class: "button", text: "Remove", attrs: { type: "button" } }), () => this.remove());
    toggle(this.removeButton, "is-hidden", saved.apiKey === "");
    const form = h("form", { class: "form" }, [
      this.label("API key", "From your OpenSubtitles profile", this.apiKey),
      this.label("Username (optional)", "Your username, not your email", this.username),
      this.label("Password (optional)", "", this.password),
      h("div", { class: "form-buttons" }, [save, this.removeButton]),
      this.status,
    ]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.save();
    });
    const back = onTap(iconButton("round-button", ICONS.back, "Back"), () => this.app.back());
    this.el = h("div", { class: "page" }, [
      h("header", { class: "page-header" }, [back, h("h1", { class: "page-title", text: "Online subtitles" })]),
      h("div", { class: "page-body" }, [
        h("p", { class: "page-intro", text: "Connect OpenSubtitles to find English subtitles for titles that don't have their own." }),
        form,
        h("section", { class: "tips" }, [
          h("h2", { text: "Getting a key" }),
          h("p", { text: "Sign up free at opensubtitles.com. In your profile, open API Consumers and create one; its API key goes here." }),
          h("p", { text: "Add your username (not your email) and password for about 20 downloads a day, or about 5 with the key alone." }),
          h("p", { text: "These stay on this phone. The helper on your computer passes the requests on, because a web page can't reach OpenSubtitles itself." }),
        ]),
      ]),
    ]);
    if (saved.apiKey) this.say("Connected. Change anything and save to check again.", true);
  }

  destroy(): void {
    this.alive = false;
  }

  private input(type: string, value: string, autocomplete: string): HTMLInputElement {
    const input = h("input", { class: "field", attrs: { type, autocomplete, autocapitalize: "off", autocorrect: "off", spellcheck: "false" } });
    input.value = value;
    return input;
  }

  private label(text: string, hint: string, input: HTMLInputElement): HTMLElement {
    return h("label", { class: "form-field" }, [h("span", { class: "form-label", text }), input, hint ? h("span", { class: "form-hint", text: hint }) : null]);
  }

  private say(text: string, good: boolean): void {
    setText(this.status, text);
    toggle(this.status, "is-good", good);
  }

  private save(): void {
    const apiKey = this.apiKey.value.trim();
    const username = this.username.value.trim();
    const password = this.password.value;
    if (!apiKey) return this.say("Enter your API key first.", false);
    if (username && !password) return this.say("Add the password for " + username + ", or clear the username.", false);
    // Saved before the check, so a failed check loses nothing.
    const saved = readOsFields();
    const changed = saved.apiKey !== apiKey || saved.username !== username || saved.password !== password;
    const account = { apiKey, username, password, token: changed ? "" : saved.token, baseUrl: changed ? "" : saved.baseUrl };
    saveOsAccount(account);
    this.app.refreshSecrets();
    toggle(this.removeButton, "is-hidden", false);
    this.say("Saved. Checking with OpenSubtitles…", true);
    new OsClient(account).check().then((result) => {
      if (!this.alive) return;
      if (!result.ok) {
        log("opensubtitles check failed:", result.error);
        this.say(result.error, false);
        return;
      }
      let text = result.name ? "Connected as " + result.name + "." : "The key works. Without a login you get about 5 downloads a day.";
      if (result.name && result.allowed > 0) text += " " + result.allowed + " downloads a day.";
      this.say(text, true);
    });
  }

  private remove(): void {
    regDelete("opensubtitles", "account");
    this.app.refreshSecrets();
    this.apiKey.value = "";
    this.username.value = "";
    this.password.value = "";
    toggle(this.removeButton, "is-hidden", true);
    this.say("Removed. Online subtitles are off.", true);
  }
}
