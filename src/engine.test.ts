import { describe, expect, it } from 'vitest';
import { LifeEngine, PATTERNS } from './engine';

function liveCells(e: LifeEngine): string[] {
  const out: string[] = [];
  for (let y = 0; y < e.rows; y++) {
    for (let x = 0; x < e.cols; x++) {
      if (e.current[y * e.cols + x]) out.push(`${x},${y}`);
    }
  }
  return out.sort();
}

function seed(e: LifeEngine, cells: ReadonlyArray<readonly [number, number]>): void {
  for (const [x, y] of cells) e.setCell(x, y, true);
}

describe('LifeEngine rules (B3/S23)', () => {
  it('a 2x2 block is a still life', () => {
    const e = new LifeEngine();
    e.resize(6, 6);
    seed(e, [[2, 2], [3, 2], [2, 3], [3, 3]]);
    e.step();
    expect(liveCells(e)).toEqual(['2,2', '2,3', '3,2', '3,3']);
    expect(e.population).toBe(4);
    expect(e.generation).toBe(1);
  });

  it('a blinker oscillates with period 2', () => {
    const e = new LifeEngine();
    e.resize(5, 5);
    seed(e, [[2, 1], [2, 2], [2, 3]]);
    const start = liveCells(e);
    e.step();
    expect(liveCells(e)).toEqual(['1,2', '2,2', '3,2']);
    e.step();
    expect(liveCells(e)).toEqual(start);
  });

  it('a lone cell dies of underpopulation', () => {
    const e = new LifeEngine();
    e.resize(5, 5);
    e.setCell(2, 2, true);
    e.step();
    expect(e.population).toBe(0);
  });

  it('a dead cell with exactly three neighbours is born', () => {
    const e = new LifeEngine();
    e.resize(5, 5);
    seed(e, [[1, 1], [2, 1], [1, 2]]);
    e.step();
    expect(e.current[2 * 5 + 2]).toBe(1);
  });

  it('a glider moves one cell diagonally every 4 steps', () => {
    const e = new LifeEngine();
    e.resize(10, 10);
    seed(e, PATTERNS.glider);
    for (let i = 0; i < 4; i++) e.step();
    expect(liveCells(e)).toEqual(['1,3', '2,1', '2,3', '3,2', '3,3']);
  });

  it('edges wrap: neighbours across the border count (toroidal)', () => {
    const e = new LifeEngine();
    e.resize(5, 5);
    // In a finite grid these three would NOT neighbour (0,0); with
    // wrapping they are its left, up, and up-left neighbours.
    seed(e, [[4, 0], [0, 4], [4, 4]]);
    e.step();
    expect(e.current[0]).toBe(1);
  });
});

describe('LifeEngine state, decay, and resize', () => {
  it('clear resets generation and population', () => {
    const e = new LifeEngine();
    e.resize(5, 5);
    seed(e, [[1, 1], [2, 2]]);
    e.step();
    e.clear();
    expect(e.population).toBe(0);
    expect(e.generation).toBe(0);
    expect(e.current.every((v) => v === 0)).toBe(true);
  });

  it('randomize(0) is empty and randomize(1) is full', () => {
    const e = new LifeEngine();
    e.resize(10, 10);
    e.randomize(0);
    expect(e.population).toBe(0);
    e.randomize(1);
    expect(e.population).toBe(100);
  });

  it('setCell tracks population and erasing stamps a ghost', () => {
    const e = new LifeEngine();
    e.resize(5, 5);
    e.setCell(2, 2, true);
    expect(e.population).toBe(1);
    e.setCell(2, 2, false);
    expect(e.population).toBe(0);
    expect(e.decay[2 * 5 + 2]).toBe(1);
  });

  it('a cell that dies in a step leaves a ghost that fades', () => {
    const e = new LifeEngine();
    e.resize(5, 5);
    e.setCell(2, 2, true);
    e.step();
    expect(e.decay[2 * 5 + 2]).toBe(1);
    e.fadeDecay(0.5);
    expect(e.decay[2 * 5 + 2]).toBe(0.5);
  });

  it('age increments for survivors and resets for the dead', () => {
    const e = new LifeEngine();
    e.resize(6, 6);
    seed(e, [[2, 2], [3, 2], [2, 3], [3, 3], [0, 0]]);
    e.step();
    expect(e.age[2 * 6 + 2]).toBeGreaterThan(0);
    expect(e.age[0]).toBe(0);
  });

  it('resize preserves the overlapping region', () => {
    const e = new LifeEngine();
    e.resize(5, 5);
    e.setCell(1, 1, true);
    e.resize(10, 10);
    expect(e.current[1 * 10 + 1]).toBe(1);
    expect(e.cols).toBe(10);
    expect(e.rows).toBe(10);
  });

  it('stamp places a pattern centred on the board', () => {
    const e = new LifeEngine();
    e.resize(20, 20);
    e.stamp(PATTERNS.glider);
    expect(e.population).toBe(PATTERNS.glider.length);
  });
});
