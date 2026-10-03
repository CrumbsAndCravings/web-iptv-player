// Audio and subtitle choices for the player's track panel, ported from the Roku app's
// Tracks.brs by way of the Samsung app. Each option is { id, label, language }. On the
// phone the tracks are the file's own, as the helper describes them: a sound track is
// the helper's track number, and a subtitle track the WebVTT file it writes for it.

import { codecLabel } from "./utils";

export interface TrackInput {
  id: string;
  language: string;
  description: string;
  format?: string; // audio codec, like "dts" or "ac3"
}

export interface TrackOption {
  id: string;
  label: string;
  language: string;
  format?: string; // audio only, lower case; "" when unknown
}

const NAMES: { [code: string]: string } = {
  eng: "English", en: "English", hin: "Hindi", hi: "Hindi", urd: "Urdu", ur: "Urdu",
  pan: "Punjabi", pa: "Punjabi", ara: "Arabic", ar: "Arabic", ben: "Bengali", bn: "Bengali",
  tam: "Tamil", ta: "Tamil", tel: "Telugu", te: "Telugu", mal: "Malayalam", ml: "Malayalam",
  kan: "Kannada", kn: "Kannada", mar: "Marathi", mr: "Marathi", guj: "Gujarati", gu: "Gujarati",
  per: "Persian", fas: "Persian", fa: "Persian", tur: "Turkish", tr: "Turkish",
  fre: "French", fra: "French", fr: "French", spa: "Spanish", es: "Spanish",
  ger: "German", deu: "German", de: "German", ita: "Italian", it: "Italian",
  por: "Portuguese", pt: "Portuguese", rus: "Russian", ru: "Russian", pol: "Polish", pl: "Polish",
  dut: "Dutch", nld: "Dutch", nl: "Dutch", swe: "Swedish", sv: "Swedish", dan: "Danish", da: "Danish",
  nor: "Norwegian", nob: "Norwegian", fin: "Finnish", fi: "Finnish", gre: "Greek", ell: "Greek", el: "Greek",
  heb: "Hebrew", he: "Hebrew", rum: "Romanian", ron: "Romanian", ro: "Romanian", hun: "Hungarian", hu: "Hungarian",
  cze: "Czech", ces: "Czech", cs: "Czech", jpn: "Japanese", ja: "Japanese", kor: "Korean", ko: "Korean",
  chi: "Chinese", zho: "Chinese", zh: "Chinese", tha: "Thai", th: "Thai", vie: "Vietnamese", vi: "Vietnamese",
  ind: "Indonesian", may: "Malay", msa: "Malay", ms: "Malay", fil: "Filipino", tgl: "Tagalog",
};

export function languageName(code: string): string {
  const c = code.trim().toLowerCase();
  if (c === "" || c === "und" || c === "unk") return "";
  return Object.prototype.hasOwnProperty.call(NAMES, c) ? NAMES[c] : c.toUpperCase();
}

// "English" + "Commentary" -> "English · Commentary"; skips a description that just
// repeats the language.
export function trackLabel(language: string, detail: string, fallback: string): string {
  let label = languageName(language);
  if (detail !== "" && detail.toLowerCase() !== label.toLowerCase()) label = label === "" ? detail : label + " · " + detail;
  return label === "" ? fallback : label;
}

export function audioOptions(tracks: TrackInput[] | null | undefined): TrackOption[] {
  const options: TrackOption[] = [];
  for (const track of tracks || []) {
    if (track.id === "") continue;
    // "English · DTS": the format says what the helper converts.
    const format = (track.format || "").toLowerCase();
    let label = trackLabel(track.language, track.description, "Track " + (options.length + 1));
    if (format !== "") label += " · " + codecLabel(format);
    options.push({ id: track.id, label, language: track.language.toLowerCase(), format });
  }
  return options;
}

// Always starts with "Off".
export function subtitleOptions(tracks: TrackInput[] | null | undefined): TrackOption[] {
  const options: TrackOption[] = [{ id: "", label: "Off", language: "off" }];
  for (const track of tracks || []) {
    if (track.id === "") continue;
    options.push({
      id: track.id,
      label: trackLabel(track.language, track.description, "Subtitles " + options.length),
      language: track.language.toLowerCase(),
    });
  }
  return options;
}

export function optionIndex(options: TrackOption[], key: keyof TrackOption, value: string): number {
  for (let i = 0; i < options.length; i++) if (options[i][key] === value) return i;
  return -1;
}

// Sound Safari can't play from a file as it is (the provider's MP4s): DTS and TrueHD.
// Unknown formats count as fine; the helper converts the rest anyway.
export function canDecodeAudio(format: string): boolean {
  const f = format.trim().toLowerCase();
  return !(f.indexOf("dts") === 0 || f === "dca" || f === "truehd" || f === "mlp");
}

// "Audio now: Dolby AC-3." for the Audio & subtitles panel, or "".
export function audioNowText(options: TrackOption[], currentId: string): string {
  const current = options.filter((o) => o.id === currentId)[0];
  return current && current.format ? "Audio now: " + codecLabel(current.format) + "." : "";
}
