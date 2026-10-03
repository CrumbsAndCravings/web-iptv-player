// Ported from the Roku app's tests/utils_test.brs (the helpers ported so far).
import { describe, expect, it } from "vitest";
import {
  clockToSeconds,
  codecLabel,
  describeCodecs,
  episodeCode,
  fieldStr,
  firstText,
  firstUrl,
  formatClock,
  formatRuntime,
  normalizeSearch,
  normalizeServer,
  sizedImage,
  toInt,
  toStr,
  yearOf,
} from "../src/core/utils";

describe("loose API types", () => {
  it("converts to strings", () => {
    expect(toStr(42)).toBe("42");
    expect(toStr("abc")).toBe("abc");
    expect(toStr(undefined)).toBe("");
    expect(toStr(null)).toBe("");
    expect(toStr(true)).toBe("true");
  });
  it("converts to integers", () => {
    expect(toInt(" 17 ")).toBe(17);
    expect(toInt("7.9")).toBe(7);
    expect(toInt(3.7)).toBe(3);
    expect(toInt(undefined)).toBe(0);
    expect(toInt("abc")).toBe(0);
  });
  it("reads fields safely", () => {
    expect(fieldStr([], "name")).toBe("");
    expect(fieldStr({ id: 99 }, "id")).toBe("99");
    expect(firstText([undefined, "  ", "Plot"])).toBe("Plot");
    expect(firstUrl(["", "https://a/b.jpg"])).toBe("https://a/b.jpg");
    expect(firstUrl("https://a/c.jpg")).toBe("https://a/c.jpg");
    expect(firstUrl([])).toBe("");
  });
});

describe("artwork", () => {
  it("resizes TMDB images", () => {
    expect(sizedImage("https://image.tmdb.org/t/p/w600_and_h900_bestv2/abc.jpg", "w185")).toBe("https://image.tmdb.org/t/p/w185/abc.jpg");
    expect(sizedImage("http://image.tmdb.org/t/p/original/xyz.png", "w780")).toBe("http://image.tmdb.org/t/p/w780/xyz.png");
    expect(sizedImage("http://cdn.example.com/p/abc.jpg", "w185")).toBe("http://cdn.example.com/p/abc.jpg");
  });
});

describe("dates and times", () => {
  it("reads years and clocks", () => {
    expect(yearOf("2019-05-24")).toBe("2019");
    expect(yearOf("n/a")).toBe("");
    expect(clockToSeconds("01:45:30")).toBe(6330);
    expect(clockToSeconds("45:30")).toBe(2730);
    expect(clockToSeconds("")).toBe(0);
  });
  it("formats clocks and runtimes", () => {
    expect(formatClock(5234)).toBe("1:27:14");
    expect(formatClock(605)).toBe("10:05");
    expect(formatRuntime(5234)).toBe("1h 27m");
    expect(formatRuntime(7200)).toBe("2h");
    expect(formatRuntime(2700)).toBe("45m");
  });
});

describe("server addresses", () => {
  it("normalizes servers", () => {
    expect(normalizeServer("line.example.com:8080")).toBe("http://line.example.com:8080");
    expect(normalizeServer(" http://line.example.com:8080/ ")).toBe("http://line.example.com:8080");
    expect(normalizeServer("https://tv.example.org")).toBe("https://tv.example.org");
    expect(normalizeServer("http://a.b:80/get.php?username=u&password=p&type=m3u_plus")).toBe("http://a.b:80");
    expect(normalizeServer("   ")).toBe("");
  });
});

describe("labels", () => {
  it("codes episodes", () => {
    expect(episodeCode(1, 2)).toBe("S1:E2");
    expect(episodeCode("3", "10")).toBe("S3:E10");
  });
  it("describes codecs", () => {
    expect(describeCodecs("hevc", "Main 10", "eac3")).toBe("HEVC (H.265) Main 10 video, Dolby E-AC-3 audio");
    expect(describeCodecs("mpeg4", "Advanced Simple Profile", "mp3")).toBe("MPEG-4 (DivX/Xvid) Advanced Simple Profile video, MP3 audio");
    expect(codecLabel("msmpeg4v3")).toBe("MSMPEG4V3");
    expect(codecLabel("toString")).toBe("TOSTRING");
    expect(describeCodecs("h264", "", "")).toBe("H.264 video");
    expect(describeCodecs("", "", "wmav2")).toBe("WMAV2 audio");
  });
});

describe("search normalization", () => {
  it("matches the Roku rules", () => {
    expect(normalizeSearch("Spider-Man: No Way Home")).toBe("spider man no way home");
    expect(normalizeSearch("Schindler's List")).toBe("schindlers list");
    expect(normalizeSearch("Ocean’s Eleven")).toBe("oceans eleven");
    expect(normalizeSearch("Amélie")).toBe("amelie");
    expect(normalizeSearch("EN | The Batman (2022)")).toBe("en the batman 2022");
    expect(normalizeSearch("दंगल")).toBe("दंगल");
  });
});
