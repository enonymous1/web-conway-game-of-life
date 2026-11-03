/**
 * Conway's Game of Life — simulation engine.
 *
 * Performance design (the whole point of this file):
 *  - The grid lives in flat 1D typed arrays: `current` / `next` are
 *    Uint8Array (1 byte per cell), so a 200x200 grid is 40 KB per buffer
 *    and neighbours are cache-friendly sequential reads.
 *  - Double buffering: `step()` writes into `next`, then swaps the two
 *    references. No array is allocated inside the hot loop, ever.
 *  - `age` (Uint16Array, capped) drives the neon colour gradient.
 *  - `decay` (Float32Array) is the ghost layer: a cell that just died is
 *    stamped with 1.0 and faded by the renderer every animation frame,
 *    so gliders leave a visible trail without touching the simulation.
 *  - Edges wrap (toroidal). A glider flying off the right edge re-enters
 *    on the left instead of dying at the border.
 */
export class LifeEngine {
  cols = 0;
  rows = 0;
  generation = 0;
  population = 0;

  /** 0 = dead, 1 = alive */
  current: Uint8Array = new Uint8Array(0);
  private next: Uint8Array = new Uint8Array(0);
  /** Generations a cell has been continuously alive, capped at 255. */
  age: Uint16Array = new Uint16Array(0);
  /** 0..1 ghost strength of a recently-dead cell. Faded by the renderer. */
  decay: Float32Array = new Float32Array(0);

  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    const old = this.current;
    const oldCols = this.cols;
    const oldAge = this.age;
    this.cols = cols;
    this.rows = rows;
    this.current = new Uint8Array(cols * rows);
    this.next = new Uint8Array(cols * rows);
    this.age = new Uint16Array(cols * rows);
    this.decay = new Float32Array(cols * rows);
    // Preserve the overlapping region so a resize / zoom doesn't wipe the board.
    const w = Math.min(cols, oldCols);
    const h = Math.min(rows, this.rows);
    // rows is already the new value; overlap height needs the old row count,
    // which we recover from the old buffer length when oldCols > 0.
    const oldRows = oldCols > 0 ? old.length / oldCols : 0;
    const oh = Math.min(rows, oldRows);
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * cols + x;
        const oi = y * oldCols + x;
        this.current[i] = old[oi];
        this.age[i] = oldAge[oi];
      }
    }
    void h;
    this.population = this.current.reduce((n, v) => n + v, 0);
  }

  clear(): void {
    this.current.fill(0);
    this.next.fill(0);
    this.age.fill(0);
    this.decay.fill(0);
    this.generation = 0;
    this.population = 0;
  }

  randomize(density: number): void {
    for (let i = 0; i < this.current.length; i++) {
      const alive = Math.random() < density ? 1 : 0;
      this.current[i] = alive;
      this.age[i] = alive ? 1 : 0;
      this.decay[i] = 0;
    }
    this.generation = 0;
    this.population = this.current.reduce((n, v) => n + v, 0);
  }

  setCell(x: number, y: number, alive: boolean): void {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x;
    if (alive && !this.current[i]) this.population++;
    if (!alive && this.current[i]) {
      this.population--;
      this.decay[i] = 1; // hand-erased cells ghost out too
    }
    this.current[i] = alive ? 1 : 0;
    this.age[i] = alive ? Math.max(1, this.age[i]) : 0;
  }

  /** Stamp a pattern (array of "x,y" live offsets) centred on the board. */
  stamp(pattern: ReadonlyArray<readonly [number, number]>): void {
    const cx = Math.floor(this.cols / 2);
    const cy = Math.floor(this.rows / 2);
    const minX = Math.min(...pattern.map(([x]) => x));
    const maxX = Math.max(...pattern.map(([x]) => x));
    const minY = Math.min(...pattern.map(([, y]) => y));
    const maxY = Math.max(...pattern.map(([, y]) => y));
    const ox = cx - Math.floor((minX + maxX) / 2);
    const oy = cy - Math.floor((minY + maxY) / 2);
    for (const [dx, dy] of pattern) this.setCell(ox + dx, oy + dy, true);
  }

  /** One generation. Returns the new population. */
  step(): number {
    const { cols, rows, current, next } = this;
    const lastCol = cols - 1;
    const lastRow = rows - 1;
    let pop = 0;
    for (let y = 0; y < rows; y++) {
      const yUp = y === 0 ? lastRow : y - 1;
      const yDown = y === lastRow ? 0 : y + 1;
      const row = y * cols;
      const rowUp = yUp * cols;
      const rowDown = yDown * cols;
      for (let x = 0; x < cols; x++) {
        const xLeft = x === 0 ? lastCol : x - 1;
        const xRight = x === lastCol ? 0 : x + 1;
        const n =
          current[rowUp + xLeft] + current[rowUp + x] + current[rowUp + xRight] +
          current[row + xLeft] + current[row + xRight] +
          current[rowDown + xLeft] + current[rowDown + x] + current[rowDown + xRight];
        const i = row + x;
        const alive = current[i] === 1;
        // B3/S23 — the only rule in Conway's Life.
        const survives = alive ? n === 2 || n === 3 : n === 3;
        next[i] = survives ? 1 : 0;
        if (survives) {
          pop++;
          this.age[i] = Math.min(255, this.age[i] + 1);
        } else {
          if (alive) this.decay[i] = 1; // birth of a ghost
          this.age[i] = 0;
        }
      }
    }
    // Swap buffers — no allocation, `current` now holds the new generation.
    const tmp = this.current;
    this.current = this.next;
    this.next = tmp;
    this.generation++;
    this.population = pop;
    return pop;
  }

  /** Fade ghosts. Called every animation frame, not every generation. */
  fadeDecay(factor = 0.9): void {
    for (let i = 0; i < this.decay.length; i++) {
      const d = this.decay[i];
      if (d > 0) {
        const next = d * factor;
        this.decay[i] = next < 0.02 ? 0 : next;
      }
    }
  }
}

/** Cyan -> electric purple -> magenta, precomputed so render never builds strings. */
export const PALETTE: string[] = (() => {
  const stops: Array<[number, number, number]> = [
    [34, 211, 238], // cyan
    [129, 140, 248], // indigo
    [168, 85, 247], // purple
    [244, 114, 182], // pink/magenta
  ];
  const out: string[] = [];
  const N = 64;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
    const local = t * (stops.length - 1) - seg;
    const a = stops[seg];
    const b = stops[seg + 1];
    const r = Math.round(a[0] + (b[0] - a[0]) * local);
    const g = Math.round(a[1] + (b[1] - a[1]) * local);
    const bl = Math.round(a[2] + (b[2] - a[2]) * local);
    out.push(`rgb(${r},${g},${bl})`);
  }
  return out;
})();

/** Colour for a cell: coordinate gradient + age shift, so old cells drift purple/pink. */
export function cellColor(x: number, y: number, cols: number, rows: number, age: number): string {
  const coord = (x / Math.max(1, cols) + y / Math.max(1, rows)) / 2;
  const idx = Math.floor(((coord * 0.7 + Math.min(age, 120) / 120 * 0.3) * (PALETTE.length - 1)) % PALETTE.length);
  return PALETTE[idx];
}

export const PATTERNS: Record<string, ReadonlyArray<readonly [number, number]>> = {
  glider: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
  pulsar: [
    [2, 0], [3, 0], [4, 0], [8, 0], [9, 0], [10, 0],
    [0, 2], [5, 2], [7, 2], [12, 2],
    [0, 3], [5, 3], [7, 3], [12, 3],
    [0, 4], [5, 4], [7, 4], [12, 4],
    [2, 5], [3, 5], [4, 5], [8, 5], [9, 5], [10, 5],
    [2, 7], [3, 7], [4, 7], [8, 7], [9, 7], [10, 7],
    [0, 8], [5, 8], [7, 8], [12, 8],
    [0, 9], [5, 9], [7, 9], [12, 9],
    [0, 10], [5, 10], [7, 10], [12, 10],
    [2, 12], [3, 12], [4, 12], [8, 12], [9, 12], [10, 12],
  ],
  rPentomino: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  gosperGun: [
    [24, 0], [22, 1], [24, 1], [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
    [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3],
    [0, 4], [1, 4], [10, 4], [16, 4], [20, 4], [21, 4],
    [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5], [22, 5], [24, 5],
    [10, 6], [16, 6], [24, 6],
    [11, 7], [15, 7],
    [12, 8], [13, 8],
  ],
};
