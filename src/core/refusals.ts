// What a refused request says, in words a screenshot can carry: who answered, what they
// said, and whether Cloudflare itself blocked it. Ported from the Roku app's Utils.brs
// (HttpDetail and friends, docs/features.md §2.3) by way of the Samsung app. On the
// phone every request reaches the provider through the helper on your computer, which
// passes the provider's answer and headers on as they are. Headers are passed with
// lower-case names.

import { field, firstText, Json } from "./utils";

export type Headers = { [name: string]: string };

// One short line from an error page: scripts, tags and extra spaces removed.
export function briefText(body: string, limit: number): string {
  let text = body.replace(/<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi, " ");
  text = text.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
  // Error pages often repeat their title as a heading: "404 Not Found 404 Not Found".
  const repeated = /^(.{4,60}?) \1(?: |$)/.exec(text);
  if (repeated) text = (repeated[1] + " " + text.slice(repeated[0].length)).trim();
  if (text.length > limit) text = text.slice(0, limit - 1).trim() + "…";
  return text;
}

// True when the answer passed through Cloudflare (it may still come from the provider).
export function isCloudflare(headers: Headers): boolean {
  return (headers.server || "").toLowerCase().indexOf("cloudflare") >= 0 || (headers["cf-ray"] || "") !== "";
}

// What kind of Cloudflare refusal it was: a browser check (it needs JavaScript, so the
// helper can't pass it), a numbered error, or a plain block. "" when Cloudflare didn't say.
export function cloudflareKind(headers: Headers, body: string): string {
  const text = briefText(body, 4000);
  const lower = text.toLowerCase();
  if ((headers["cf-mitigated"] || "").toLowerCase() === "challenge") return " (browser check)";
  if (lower.indexOf("just a moment") >= 0 || body.toLowerCase().indexOf("challenge-platform") >= 0) return " (browser check)";
  const found = /(?:error code:?|error)\s*(1\d{3})/i.exec(text);
  if (found) return " (error " + found[1] + ")";
  if (lower.indexOf("you have been blocked") >= 0) return " (blocked)";
  return "";
}

// True when Cloudflare itself turned the request away, with one of its own pages.
// Every answer from a site behind Cloudflare carries its name, so the headers alone
// don't mean that (an early Roku build blamed Cloudflare wrongly).
export function isCloudflareBlock(headers: Headers, body: string): boolean {
  return isCloudflare(headers) && cloudflareKind(headers, body) !== "";
}

// Statuses that mean "not you, not now", where asking again only makes it worse.
export function isRefusalCode(code: number): boolean {
  return code === 401 || code === 403 || code === 429;
}

// Sums up a failed response, like: HTTP 403 from nginx: "Forbidden".
export function httpDetail(code: number, headers: Headers, body: string): string {
  let detail = "HTTP " + code;
  if (isCloudflare(headers)) {
    const kind = cloudflareKind(headers, body);
    if (kind !== "") return detail + " from Cloudflare" + kind;
    detail += " via Cloudflare";
  } else {
    const software = (headers.server || "").split(/[/ (]/)[0];
    if (software) detail += " from " + software;
  }
  const trimmed = body.trim();
  let said = "";
  if (trimmed.charAt(0) === "{") {
    let data: Json;
    try {
      data = JSON.parse(trimmed);
    } catch {
      data = undefined;
    }
    said = firstText([field(data, "message"), field(data, "error")]);
  }
  if (said === "") said = trimmed;
  said = briefText(said, 70);
  if (said === "") return detail + ", no reason given";
  return detail + ': "' + said + '"';
}

// The sentence for a failed API request (Roku's fetchJson).
export function refusalText(code: number, headers: Headers, body: string): string {
  const detail = httpDetail(code, headers, body);
  if (isCloudflareBlock(headers, body)) return "Cloudflare, the provider's firewall, turned the helper on your computer away: " + detail + ".";
  if (isRefusalCode(code)) return "The server refused the request: " + detail + ".";
  return "The server answered " + detail + ".";
}

// Why the provider turned a request away, with the usual causes for that status (the
// Roku app's sign-in hints; on the phone the helper's login is already in use, so they
// explain a list that won't load instead).
export function refusalHint(code: number, cfBlock: boolean): string {
  if (cfBlock) return "Only the provider can allow it, or give you another address.";
  if (isRefusalCode(code)) return "Often an old address the provider has retired, a trial that has ended, or a block on your internet connection after too many requests.";
  if (code === 404) return "Nothing at the helper's server address answers as an Xtream server. Check \"server\" in personal.json on your computer.";
  return "";
}
