# NEON LIFE — Conway's Game of Life

Cyberpunk / deep-space Game of Life built with **React + TypeScript + Vite**,
**Tailwind CSS v4**, **Framer Motion**, and a raw HTML5 `<canvas>` engine.
No DOM grid — the grid never touches React.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # Vitest suite for the LifeEngine (rules, wrapping, decay, resize)
npm run build    # production build -> dist/
npm run preview  # serve the production build
```

The board starts **paused** — press Play (or Space) to start it. Playback is
the user's call, not an autoplay on load.

## Deploy to GitHub Pages

The build uses relative asset paths (`base: './'` in `vite.config.ts`), so
it works at a domain root and at a project subpath like
`https://<user>.github.io/web-conway-game-of-life/` with no repo name hardcoded.

One-time setup after pushing: repo Settings → Pages → Build and deployment
→ Source: **GitHub Actions**. After that, every push to `main` runs
`.github/workflows/pages.yml` (install → test → build → deploy `dist/`).
CI on every push/PR runs the same test + build via `.github/workflows/ci.yml`.

## How it plays

- **Play / Pause / Step** — plus keys: `Space` play/pause, `S` step, `C` clear, `R` randomize.
- **Draw / erase live, while running** — drag on the canvas. Right-drag (or
  Erase mode) erases. Brush size 1–5. Fast drags interpolate a line between
  cells so strokes never leave gaps.
- **Clear / Randomize**, with a density slider for randomization.
- **Sliders** — speed (1–60 generations/sec), density (5–50%), cell size /
  zoom (3–24 px). The canvas resizes to fill the window and preserves the
  overlapping board on resize/zoom.
- **Patterns** — Glider, Pulsar, R-pentomino, and the Gosper Glider Gun,
  stamped in the centre of the board.
- **Edges wrap (toroidal)** — gliders fly off one edge and re-enter opposite.

## Visuals

- Live cells glow via canvas `shadowBlur` / `shadowColor` (automatically
  disabled below 7 px cells, where the gradient alone reads as glow).
- Colour is a precomputed 64-step cyan → indigo → purple → magenta palette,
  indexed by cell coordinates plus age — older cells drift purple/pink.
- **Decay trails**: when a cell dies it is stamped into a ghost layer that
  fades ~10% per animation frame (not per generation), so moving gliders
  leave a fading purple trail.

## Performance design

| Decision | Why |
|---|---|
| `Uint8Array` 1D grid, 2 buffers | 200×200 = 40 KB per buffer, cache-friendly, no per-frame allocation |
| Double buffering (`current` ⇄ `next` swap) | Next generation never reads its own writes |
| Grid in a `ref` / vanilla `LifeEngine` class | The simulation loop never triggers a React re-render |
| Stats pushed at 4 Hz | HUD updates without re-rendering 60×/sec |
| `shadowBlur` gated by cell size | Glow stays cheap on huge grids |
| Generations on a time accumulator | Speed is true gen/sec on any refresh rate; catch-up capped at 5 steps |

At 200×200 the engine step is a single 40,000-cell pass (8 neighbour reads
per cell, toroidal via precomputed row offsets, no modulo in the inner loop).
The HUD shows live FPS so you can verify 60 FPS on your own machine.
