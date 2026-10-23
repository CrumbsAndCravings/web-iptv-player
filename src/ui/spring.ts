// Springs as Apple tunes them (Designing Fluid Interfaces, WWDC 2018): a damping ratio
// (1 settles without overshoot, lower bounces) and a response (seconds; how quickly it
// gets there, not a duration). A spring always moves from where it is, at the speed it
// has, so it can be grabbed and redirected at any moment, and a gesture can hand it its
// speed as it lets go.

const STEP_S = 1 / 240; // small steps keep it stable on slow frames

export class Spring {
  velocity = 0; // units per second
  target: number;
  private damping = 1;
  private response = 0.35;

  constructor(
    public value: number,
    private rest: number, // close enough to stop (units)
  ) {
    this.target = value;
  }

  get moving(): boolean {
    return this.value !== this.target || this.velocity !== 0;
  }

  // Towards `target` from wherever it is now; `velocity` (units/s) hands over a
  // gesture's speed, otherwise it keeps its own.
  to(target: number, damping: number, response: number, velocity?: number): void {
    this.target = target;
    this.damping = damping;
    this.response = response;
    if (velocity !== undefined) this.velocity = velocity;
  }

  // There at once (a finger moving it, or Reduce Motion).
  set(value: number, velocity = 0): void {
    this.value = value;
    this.target = value;
    this.velocity = velocity;
  }

  // Moves on by `dt` seconds; returns whether it's still moving.
  step(dt: number): boolean {
    if (!this.moving) return false;
    const stiffness = Math.pow((2 * Math.PI) / this.response, 2);
    const friction = (4 * Math.PI * this.damping) / this.response;
    const steps = Math.max(1, Math.ceil(dt / STEP_S));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const force = -stiffness * (this.value - this.target) - friction * this.velocity;
      this.velocity += force * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.value - this.target) < this.rest && Math.abs(this.velocity) < this.rest * 10) {
      this.value = this.target;
      this.velocity = 0;
    }
    return this.moving;
  }
}

// How far a flick carries on, as iOS decelerates a scroll: `velocity` in units/s, `rate`
// the share of speed kept each millisecond (0.998 normal, 0.99 snappier).
export function project(velocity: number, rate = 0.998): number {
  return ((velocity / 1000) * rate) / (1 - rate);
}

// Pulled `over` past an edge, how far it actually goes: about half at first, then less
// and less, never as far as `size` (iOS's rubber band).
export function rubberBand(over: number, size: number, constant = 0.55): number {
  if (size <= 0) return 0;
  return (over * size * constant) / (size + constant * Math.abs(over));
}

// A pointer's speed (units/s) from its last moves; 0 once it has stopped.
export class VelocityTracker {
  private points: { x: number; t: number }[] = [];

  reset(): void {
    this.points = [];
  }

  add(x: number, t: number): void {
    this.points.push({ x, t });
    while (this.points.length > 2 && t - this.points[0].t > 100) this.points.shift();
  }

  velocity(now: number): number {
    const points = this.points;
    if (points.length < 2) return 0;
    const last = points[points.length - 1];
    if (now - last.t > 80) return 0; // held still before letting go
    const first = points[0];
    const ms = last.t - first.t;
    return ms > 0 ? ((last.x - first.x) / ms) * 1000 : 0;
  }
}
