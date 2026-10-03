// When the phone can't use the helper on your computer: no key yet (the app was opened
// without the helper's link), the key doesn't match, or the helper didn't answer. It
// says which, and how to fix it: open the link the helper prints, or paste its key.

import type { Screen } from "../app";
import { h, onTap, setText } from "../ui/dom";

export class ConnectScreen implements Screen {
  readonly el: HTMLElement;
  private status: HTMLElement;
  private input: HTMLInputElement;

  constructor(
    reason: string,
    private connect: (key: string) => void,
  ) {
    this.status = h("p", { class: "form-status", attrs: { role: "status" } });
    setText(this.status, reason);
    this.input = h("input", { class: "field", attrs: { type: "text", placeholder: "The helper's key", autocapitalize: "off", autocorrect: "off", spellcheck: "false", autocomplete: "off" } });
    const form = h("form", { class: "form" }, [
      h("label", { class: "form-field" }, [h("span", { class: "form-label", text: "Or paste the helper's key" }), this.input, h("span", { class: "form-hint", text: "It's after key= in the link." })]),
      h("div", { class: "form-buttons" }, [
        h("button", { class: "button is-primary", text: "Connect", attrs: { type: "submit" } }),
        onTap(h("button", { class: "button", text: "Try again", attrs: { type: "button" } }), () => this.connect("")),
      ]),
      this.status,
    ]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const key = this.input.value.replace(/^.*key=/, "").replace(/[&#].*$/, "").trim();
      if (!key) return setText(this.status, "Paste the key first, or open the helper's link.");
      this.connect(key);
    });
    this.el = h("div", { class: "page connect" }, [
      h("div", { class: "page-body" }, [
        h("div", { class: "logo is-large" }, [h("span", { class: "logo-name", text: "ARAN" }), h("span", { class: "logo-plus", text: "+" })]),
        h("h1", { class: "page-title", text: "Connect to the helper" }),
        h("p", { class: "page-intro", text: "ARAN+ on your phone works through the helper on your computer: it holds your provider login and converts what Safari can't play." }),
        h("ol", { class: "steps" }, [
          h("li", { text: "On the computer, start the helper (npm run helper, or helper\\start-helper.cmd)." }),
          h("li", { text: "On this phone, on the same Wi-Fi, open the link the helper shows, or point the camera at its code." }),
          h("li", { text: "In Safari, tap Share, then Add to Home Screen." }),
        ]),
        form,
      ]),
    ]);
  }

  say(text: string): void {
    setText(this.status, text);
  }
}
