export interface Clock {
  now(): number;
  schedule(delayMs: number, fn: () => void): void;
}

export type AcquireFailure = 'rejected' | 'timeout' | 'down';

/** Proof of holding one slot. Stale if the resource went down after it was granted. */
export interface Lease {
  resource: Resource;
  generation: number;
}

interface Waiter {
  enqueuedAt: number;
  done: boolean;
  onStart: (lease: Lease, waitMs: number) => void;
  onFail: (reason: AcquireFailure) => void;
}

export interface ResourceSample {
  /** Slot-milliseconds used during the interval. */
  busyMs: number;
  capacity: number;
  queueLength: number;
  waitSumMs: number;
  waitCount: number;
  up: boolean;
}

/**
 * A pool of identical slots with a FIFO waiting line: backend worker threads,
 * database connections, cache connections. This is where queueing, waiting,
 * rejections and timeouts come from, so bottlenecks emerge instead of being scripted.
 */
export class Resource {
  private busy = 0;
  private queue: Waiter[] = [];
  private head = 0;
  private waiting = 0;
  private area = 0;
  private lastChange = 0;
  private waitSum = 0;
  private waitCount = 0;
  private isUp = true;
  /** Bumped when the resource goes down; leases from earlier generations are dead. */
  generation = 0;

  constructor(
    readonly id: string,
    readonly capacity: number,
    readonly queueLimit: number,
    readonly timeoutMs: number,
    private readonly clock: Clock,
  ) {}

  get up(): boolean {
    return this.isUp;
  }

  get inUse(): number {
    return this.busy;
  }

  get queueLength(): number {
    return this.waiting;
  }

  isLive(lease: Lease): boolean {
    return lease.generation === this.generation && this.isUp;
  }

  acquire(onStart: (lease: Lease, waitMs: number) => void, onFail: (reason: AcquireFailure) => void): void {
    if (!this.isUp) {
      onFail('down');
      return;
    }
    if (this.busy < this.capacity && this.waiting === 0) {
      this.account();
      this.busy++;
      this.recordWait(0);
      onStart({ resource: this, generation: this.generation }, 0);
      return;
    }
    if (this.waiting >= this.queueLimit) {
      onFail('rejected');
      return;
    }
    const waiter: Waiter = { enqueuedAt: this.clock.now(), done: false, onStart, onFail };
    this.queue.push(waiter);
    this.waiting++;
    if (Number.isFinite(this.timeoutMs)) {
      this.clock.schedule(this.timeoutMs, () => {
        if (waiter.done) return;
        waiter.done = true;
        this.waiting--;
        onFail('timeout');
      });
    }
  }

  release(lease: Lease): void {
    if (lease.resource !== this || lease.generation !== this.generation) return;
    this.account();
    this.busy--;
    this.dispatch();
  }

  /** Failure injection: everything waiting fails, in-flight leases become stale. */
  takeDown(): void {
    if (!this.isUp) return;
    this.account();
    this.isUp = false;
    this.generation++;
    this.busy = 0;
    const pending = this.queue.slice(this.head);
    this.queue = [];
    this.head = 0;
    this.waiting = 0;
    for (const waiter of pending) {
      if (waiter.done) continue;
      waiter.done = true;
      waiter.onFail('down');
    }
  }

  bringUp(): void {
    if (this.isUp) return;
    this.account();
    this.isUp = true;
  }

  /** Returns usage since the previous call and resets the interval counters. */
  sample(): ResourceSample {
    this.account();
    const result: ResourceSample = {
      busyMs: this.area,
      capacity: this.capacity,
      queueLength: this.waiting,
      waitSumMs: this.waitSum,
      waitCount: this.waitCount,
      up: this.isUp,
    };
    this.area = 0;
    this.waitSum = 0;
    this.waitCount = 0;
    return result;
  }

  private dispatch(): void {
    while (this.isUp && this.busy < this.capacity && this.waiting > 0) {
      const waiter = this.queue[this.head++];
      if (!waiter || waiter.done) continue;
      waiter.done = true;
      this.waiting--;
      this.account();
      this.busy++;
      const waitMs = this.clock.now() - waiter.enqueuedAt;
      this.recordWait(waitMs);
      waiter.onStart({ resource: this, generation: this.generation }, waitMs);
    }
    if (this.head > 1024 && this.head * 2 > this.queue.length) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
  }

  private recordWait(ms: number): void {
    this.waitSum += ms;
    this.waitCount++;
  }

  private account(): void {
    const now = this.clock.now();
    this.area += this.busy * (now - this.lastChange);
    this.lastChange = now;
  }
}
