import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LifeEngine, cellColor, PATTERNS } from './engine';

type BrushMode = 'draw' | 'erase';

const DEFAULT_CELL = 8;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Heavy grid state lives ONLY here — never in React state, so the
  // simulation loop never triggers a re-render.
  const engineRef = useRef<LifeEngine | null>(null);
  if (!engineRef.current) engineRef.current = new LifeEngine();

  // UI state (lightweight, changes only on user action / 4 Hz stats tick).
  // Starts paused: playback is the user's call, not an autoplay on load.
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(20); // generations per second
  const [density, setDensity] = useState(0.18);
  const [cellSize, setCellSize] = useState(DEFAULT_CELL);
  const [brush, setBrush] = useState<BrushMode>('draw');
  const [brushSize, setBrushSize] = useState(1);
  const [showPanel, setShowPanel] = useState(true);
  const [stats, setStats] = useState({ generation: 0, population: 0, fps: 0, cols: 0, rows: 0 });

  // Refs mirror the UI values for the rAF loop (avoids stale closures
  // and avoids restarting the loop on every slider move).
  const paramsRef = useRef({ isPlaying, speed, cellSize });
  paramsRef.current = { isPlaying, speed, cellSize };
  const drawingRef = useRef<{ active: boolean; erase: boolean; lastX: number; lastY: number }>({
    active: false, erase: false, lastX: -1, lastY: -1,
  });
  const brushRef = useRef({ brush, brushSize });
  brushRef.current = { brush, brushSize };

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const engine = engineRef.current!;
    const cols = Math.max(10, Math.floor(w / paramsRef.current.cellSize));
    const rows = Math.max(10, Math.floor(h / paramsRef.current.cellSize));
    engine.resize(cols, rows);
  }, []);

  // Initial board + resize handling.
  useEffect(() => {
    resize();
    const engine = engineRef.current!;
    if (engine.population === 0 && engine.generation === 0) engine.randomize(0.18);
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [resize]);

  // Recompute the grid when zoom (cell size) changes, preserving the board.
  useEffect(() => { resize(); }, [cellSize, resize]);

  // Keyboard shortcuts: Space play/pause, S step, C clear, R randomize.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); setIsPlaying((p) => !p); }
      if (e.key === 's' || e.key === 'S') engineRef.current!.step();
      if (e.key === 'c' || e.key === 'C') engineRef.current!.clear();
      if (e.key === 'r' || e.key === 'R') engineRef.current!.randomize(density);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [density]);

  // ---- Main loop: rAF drives rendering every frame; generations are
  // ---- accumulated on a time budget so `speed` is true generations/sec
  // ---- regardless of display refresh rate.
  useEffect(() => {
    let raf = 0;
    let lastTime = performance.now();
    let acc = 0;
    let frames = 0;
    let fpsTime = performance.now();
    let lastStatsPush = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const engine = engineRef.current!;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dt = Math.min(100, now - lastTime);
      lastTime = now;
      const { isPlaying, speed, cellSize } = paramsRef.current;

      if (isPlaying && speed > 0) {
        acc += dt;
        const interval = 1000 / speed;
        // Cap catch-up steps so a backgrounded tab doesn't spiral.
        let steps = 0;
        while (acc >= interval && steps < 5) {
          engine.step();
          acc -= interval;
          steps++;
        }
        if (acc >= interval) acc = 0;
      }

      // Ghosts fade every frame, not every generation — that's the trail.
      engine.fadeDecay(0.9);

      // ---- Render (canvas only, no DOM grid) ----
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.fillStyle = '#05060f';
      ctx.fillRect(0, 0, w, h);

      // Faint starfield dots (static, cheap) for the deep-space feel.
      ctx.fillStyle = 'rgba(148,163,184,0.25)';
      for (let i = 0; i < 90; i++) {
        const sx = (i * 733) % w;
        const sy = (i * 911) % h;
        ctx.fillRect(sx, sy, 1, 1);
      }

      const { cols, rows, current, decay, age } = engine;
      const pad = cellSize > 4 ? 1 : 0;
      const size = cellSize - pad;

      // Ghost pass first (no shadow — cheap, and it sits underneath).
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const d = decay[i];
          if (d > 0 && current[i] === 0) {
            ctx.globalAlpha = d * 0.4;
            ctx.fillStyle = '#7c3aed';
            ctx.fillRect(x * cellSize + pad, y * cellSize + pad, size, size);
          }
        }
      }
      ctx.globalAlpha = 1;

      // Live pass. shadowBlur is the neon glow; it is the most expensive
      // canvas state, so it is only enabled for larger cells — at tiny
      // zoom levels the colour gradient alone reads as glow, and the
      // 200x200 grid stays at 60 FPS.
      const useGlow = cellSize >= 7;
      let aliveCount = 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          if (current[i] === 0) continue;
          aliveCount++;
          const color = cellColor(x, y, cols, rows, age[i]);
          ctx.fillStyle = color;
          if (useGlow) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
          }
          ctx.fillRect(x * cellSize + pad, y * cellSize + pad, size, size);
        }
      }
      ctx.shadowBlur = 0;

      // ---- Stats, throttled to 4 Hz so React never re-renders per frame ----
      frames++;
      if (now - fpsTime >= 500) {
        const fps = Math.round((frames * 1000) / (now - fpsTime));
        frames = 0;
        fpsTime = now;
        if (now - lastStatsPush >= 250) {
          lastStatsPush = now;
          setStats({ generation: engine.generation, population: aliveCount, fps, cols, rows });
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- Drawing: pointer -> cell, with line interpolation so fast drags
  // ---- don't leave gaps. Works while the simulation is running. ----
  const paintAt = useCallback((clientX: number, clientY: number, erase: boolean) => {
    const canvas = canvasRef.current;
    const engine = engineRef.current!;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cs = paramsRef.current.cellSize;
    const cx = Math.floor((clientX - rect.left) / cs);
    const cy = Math.floor((clientY - rect.top) / cs);
    const d = drawingRef.current;
    const { brushSize } = brushRef.current;
    const paintCell = (x: number, y: number) => {
      for (let dy = 0; dy < brushSize; dy++)
        for (let dx = 0; dx < brushSize; dx++)
          engine.setCell(x + dx, y + dy, !erase);
    };
    if (d.lastX >= 0) {
      // Bresenham line between the last and current cell.
      let x0 = d.lastX, y0 = d.lastY;
      const dx = Math.abs(cx - x0), sx = x0 < cx ? 1 : -1;
      const dy = -Math.abs(cy - y0), sy = y0 < cy ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        paintCell(x0, y0);
        if (x0 === cx && y0 === cy) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    } else {
      paintCell(cx, cy);
    }
    d.lastX = cx;
    d.lastY = cy;
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const erase = e.button === 2 || brush === 'erase';
    drawingRef.current = { active: true, erase, lastX: -1, lastY: -1 };
    paintAt(e.clientX, e.clientY, erase);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drawingRef.current.active) paintAt(e.clientX, e.clientY, drawingRef.current.erase);
  };
  const endDraw = () => {
    drawingRef.current.active = false;
    drawingRef.current.lastX = -1;
    drawingRef.current.lastY = -1;
  };

  const stepOnce = () => { setIsPlaying(false); engineRef.current!.step(); };
  const clearBoard = () => engineRef.current!.clear();
  const randomize = () => engineRef.current!.randomize(density);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05060f] text-slate-100 select-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-crosshair touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDraw}
        onPointerCancel={endDraw}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Top-left HUD */}
      <motion.div
        initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
        className="pointer-events-none absolute left-4 top-4 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 backdrop-blur-xl shadow-[0_0_40px_rgba(139,92,246,0.25)]"
      >
        <h1 className="text-lg font-bold tracking-[0.2em] bg-gradient-to-r from-cyan-300 via-violet-400 to-pink-400 bg-clip-text text-transparent">
          NEON LIFE
        </h1>
        <p className="text-[11px] tracking-wide text-slate-400">Conway's Game of Life · toroidal · B3/S23</p>
        <div className="mt-2 flex gap-4 font-mono text-xs text-slate-300">
          <span>Gen <b className="text-cyan-300">{stats.generation.toLocaleString()}</b></span>
          <span>Alive <b className="text-violet-300">{stats.population.toLocaleString()}</b></span>
          <span>FPS <b className={stats.fps >= 50 ? 'text-emerald-300' : 'text-amber-300'}>{stats.fps}</b></span>
          <span className="hidden sm:inline">{stats.cols}×{stats.rows}</span>
        </div>
      </motion.div>

      {/* Panel toggle */}
      <button
        onClick={() => setShowPanel((s) => !s)}
        className="absolute right-4 top-4 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs backdrop-blur-xl hover:bg-white/10"
      >
        {showPanel ? 'Hide controls' : 'Show controls'}
      </button>

      {/* Glassmorphism control panel */}
      <AnimatePresence>
        {showPanel && (
          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className="absolute bottom-4 left-1/2 w-[min(96vw,880px)] -translate-x-1/2 rounded-3xl border border-white/10 bg-white/[0.07] p-4 shadow-[0_0_60px_rgba(34,211,238,0.15)] backdrop-blur-2xl"
          >
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setIsPlaying((p) => !p)} className="rounded-full bg-gradient-to-r from-cyan-500 to-violet-600 px-5 py-2 text-sm font-semibold shadow-lg shadow-violet-500/30 hover:brightness-110">
                {isPlaying ? '⏸ Pause' : '▶ Play'}
              </button>
              <button onClick={stepOnce} className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm hover:bg-white/20">⏭ Step</button>
              <button onClick={clearBoard} className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm hover:bg-white/20">Clear</button>
              <button onClick={randomize} className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm hover:bg-white/20">Randomize</button>

              <div className="ml-auto flex gap-1 rounded-full border border-white/10 bg-black/30 p-1">
                {(['draw', 'erase'] as BrushMode[]).map((m) => (
                  <button key={m} onClick={() => setBrush(m)}
                    className={`rounded-full px-3 py-1 text-xs capitalize ${brush === m ? 'bg-cyan-500/80 text-white' : 'text-slate-300 hover:text-white'}`}>
                    {m === 'draw' ? '✏️ Draw' : '🧹 Erase'}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                Brush
                <input type="range" min={1} max={5} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="accent-cyan-400" />
                <span className="w-4 font-mono">{brushSize}</span>
              </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-slate-300">
                <span className="flex justify-between"><span>Speed</span><span className="font-mono text-cyan-300">{speed} gen/s</span></span>
                <input type="range" min={1} max={60} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="mt-1 w-full accent-cyan-400" />
              </label>
              <label className="text-xs text-slate-300">
                <span className="flex justify-between"><span>Random density</span><span className="font-mono text-violet-300">{Math.round(density * 100)}%</span></span>
                <input type="range" min={5} max={50} value={Math.round(density * 100)} onChange={(e) => setDensity(Number(e.target.value) / 100)} className="mt-1 w-full accent-violet-400" />
              </label>
              <label className="text-xs text-slate-300">
                <span className="flex justify-between"><span>Cell size / zoom</span><span className="font-mono text-pink-300">{cellSize}px</span></span>
                <input type="range" min={3} max={24} value={cellSize} onChange={(e) => setCellSize(Number(e.target.value))} className="mt-1 w-full accent-pink-400" />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400">Patterns:</span>
              {Object.keys(PATTERNS).map((name) => (
                <button key={name} onClick={() => { engineRef.current!.clear(); engineRef.current!.stamp(PATTERNS[name]); }}
                  className="rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 capitalize text-violet-200 hover:bg-violet-500/25">
                  {name === 'gosperGun' ? 'Gosper gun' : name === 'rPentomino' ? 'R-pentomino' : name}
                </button>
              ))}
              <span className="ml-auto hidden text-slate-500 md:inline">Draw: drag · Erase: right-drag or Erase mode · Keys: Space / S / C / R</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
