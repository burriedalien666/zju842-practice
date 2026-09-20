// The clock is advanced explicitly on visibility/navigation changes as well as ticks.
export class PracticeClock {
  constructor(elapsed = 0, now = 0, paused = false) {
    this.elapsed = elapsed;
    this.last = now;
    this.paused = paused;
  }
  tick(now, active = true) {
    if (!this.paused && active) this.elapsed += Math.max(0, now - this.last);
    this.last = now;
    return Math.round(this.elapsed);
  }
  pause(now) {
    this.tick(now);
    this.paused = true;
  }
  resume(now) {
    this.last = now;
    this.paused = false;
  }
  reset(now) {
    this.elapsed = 0;
    this.last = now;
  }
}
