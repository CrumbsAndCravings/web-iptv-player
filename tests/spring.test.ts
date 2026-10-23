// Springs, flick projection and the rubber band (src/ui/spring.ts), which move the tab
// bar's glass lens.
import { describe, expect, it } from "vitest";
import { project, rubberBand, Spring, VelocityTracker } from "../src/ui/spring";

// Runs a spring at 60 frames a second; returns every value it showed.
function run(spring: Spring, seconds = 2): number[] {
  const values: number[] = [];
  for (let t = 0; t < seconds && spring.step(1 / 60); t += 1 / 60) values.push(spring.value);
  values.push(spring.value);
  return values;
}

describe("a spring", () => {
  it("critically damped, arrives without overshooting", () => {
    const spring = new Spring(0, 0.01);
    spring.to(100, 1, 0.35);
    const values = run(spring);
    expect(Math.max(...values)).toBeLessThanOrEqual(100);
    expect(spring.value).toBe(100);
    expect(spring.moving).toBe(false);
  });
  it("with less damping, overshoots a little and comes back", () => {
    const spring = new Spring(0, 0.01);
    spring.to(100, 0.8, 0.35);
    const values = run(spring);
    expect(Math.max(...values)).toBeGreaterThan(101);
    expect(Math.max(...values)).toBeLessThan(110);
    expect(spring.value).toBe(100);
  });
  it("settles in about its response time, not a fixed duration", () => {
    const quick = new Spring(0, 0.01);
    quick.to(100, 1, 0.2);
    const slow = new Spring(0, 0.01);
    slow.to(100, 1, 0.6);
    expect(run(quick).length).toBeLessThan(run(slow).length);
  });
  it("carries on at the speed it's handed, from where it is", () => {
    const spring = new Spring(50, 0.01);
    spring.to(50, 1, 0.35, 800);
    spring.step(1 / 60);
    expect(spring.value).toBeGreaterThan(50 + 800 / 60 / 2);
  });
  it("can be redirected mid-flight without a jump", () => {
    const spring = new Spring(0, 0.01);
    spring.to(100, 1, 0.35);
    for (let i = 0; i < 6; i++) spring.step(1 / 60);
    const before = spring.value;
    const speed = spring.velocity;
    spring.to(0, 1, 0.35);
    spring.step(1 / 60);
    expect(Math.abs(spring.value - before)).toBeLessThan(Math.abs(speed) / 60 + 1);
  });
  it("stays stable on a slow frame", () => {
    const spring = new Spring(0, 0.01);
    spring.to(100, 0.8, 0.3);
    spring.step(0.5);
    expect(Number.isFinite(spring.value)).toBe(true);
    expect(Math.abs(spring.value - 100)).toBeLessThan(20);
  });
});

describe("a flick", () => {
  it("carries on as a scroll would, further when faster", () => {
    expect(project(0)).toBe(0);
    expect(project(1000, 0.99)).toBeCloseTo(99, 0);
    expect(project(-1000, 0.99)).toBeCloseTo(-99, 0);
    expect(project(1000)).toBeGreaterThan(project(1000, 0.99));
  });
});

describe("the rubber band", () => {
  it("gives about half at first, then less and less", () => {
    expect(rubberBand(0, 100)).toBe(0);
    expect(rubberBand(10, 100)).toBeCloseTo(5.2, 1);
    expect(rubberBand(100, 100) - rubberBand(50, 100)).toBeLessThan(rubberBand(50, 100) - rubberBand(0, 100));
    expect(rubberBand(10000, 100)).toBeLessThan(100);
    expect(rubberBand(-10, 100)).toBeCloseTo(-5.2, 1);
  });
});

describe("a pointer's speed", () => {
  it("comes from its last moves, and is 0 once it has stopped", () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 1000);
    tracker.add(10, 1016);
    tracker.add(20, 1032);
    expect(tracker.velocity(1033)).toBeCloseTo(625, 0);
    expect(tracker.velocity(1200)).toBe(0);
    tracker.reset();
    expect(tracker.velocity(1200)).toBe(0);
  });
  it("forgets moves older than a tenth of a second", () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    tracker.add(500, 50);
    tracker.add(500, 300);
    tracker.add(510, 316);
    expect(tracker.velocity(317)).toBeCloseTo(625, 0);
  });
});
