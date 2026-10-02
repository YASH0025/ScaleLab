interface Entry {
  time: number;
  seq: number;
  fn: () => void;
}

/**
 * Min-heap of timestamped events. Ties are broken by insertion order,
 * so events at the same instant always run in the same order (determinism).
 */
export class EventQueue {
  private heap: Entry[] = [];
  private seq = 0;

  get size(): number {
    return this.heap.length;
  }

  push(time: number, fn: () => void): void {
    const entry: Entry = { time, seq: this.seq++, fn };
    const heap = this.heap;
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(entry, heap[parent]!)) break;
      heap[i] = heap[parent]!;
      i = parent;
    }
    heap[i] = entry;
  }

  peekTime(): number | undefined {
    return this.heap[0]?.time;
  }

  pop(): Entry | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (top === undefined || last === undefined) return undefined;
    if (heap.length === 0) return top;
    let i = 0;
    const n = heap.length;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= n) break;
      const right = left + 1;
      const child = right < n && before(heap[right]!, heap[left]!) ? right : left;
      if (!before(heap[child]!, last)) break;
      heap[i] = heap[child]!;
      i = child;
    }
    heap[i] = last;
    return top;
  }
}

function before(a: Entry, b: Entry): boolean {
  return a.time < b.time || (a.time === b.time && a.seq < b.seq);
}
