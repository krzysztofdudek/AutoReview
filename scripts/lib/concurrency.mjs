// scripts/lib/concurrency.mjs
// Semaphore primitive for capping in-flight async operations. Zero deps.

export class Semaphore {
  constructor(max) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error(`Semaphore max must be a positive integer, got ${max}`);
    }
    this.max = max;
    this.available = max;
    this.queue = [];
  }
  async acquire() {
    if (this.available > 0) { this.available--; return; }
    await new Promise(resolve => this.queue.push(resolve));
    this.available--;
  }
  release() {
    this.available++;
    const next = this.queue.shift();
    if (next) next();
  }
  async run(fn) {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }
}
