// Ported from the Roku app's tests/utils_test.brs (seeking).
import { describe, expect, it } from "vitest";
import { barFraction, clampSeek } from "../src/core/playback";

describe("seeking", () => {
  it("keeps targets inside the video", () => {
    expect(Math.floor(clampSeek(-25, 3600))).toBe(0);
    expect(Math.floor(clampSeek(4000, 3600))).toBe(3597);
    expect(Math.floor(clampSeek(4000, 0))).toBe(4000);
  });
  it("fills the bar", () => {
    expect(Math.floor(barFraction(1800, 3600) * 100)).toBe(50);
    expect(Math.floor(barFraction(10, 0) * 100)).toBe(0);
    expect(Math.floor(barFraction(4000, 3600) * 100)).toBe(100);
  });
});
