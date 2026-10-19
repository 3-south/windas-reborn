// Test patterns. A "spec" is plain data so it can travel between windows and from an external controller (e.g. HCFR):
//   { kind, ire, window, bg, rgb, invert, levels }
//   kind   : 'field' | 'crosshatch' | 'hatch43' | 'hatch54' | 'smallhatch' | 'grayscale' | 'checker' | 'dots'
//   ire    : 0..100 foreground level (field/window/lines)       window : 1..100 (% of screen area; 100 = full field)
//   bg     : 0..100 surround level for windows/lines            rgb    : 'RGB'|'R'|'G'|'B'|'RG'|'RB'|'BG' channels lit
//   invert : swap foreground/background                         levels : 'pc' (0-255) | 'video' (16-235)
export const DEFAULT_SPEC = { kind: 'field', ire: 100, window: 100, bg: 0, rgb: 'RGB', invert: false, levels: 'pc' };

/** IRE (0-100) -> 8-bit code value. */
export function ireToCode(ire, levels = 'pc') {
  const f = Math.min(100, Math.max(0, ire)) / 100;
  return Math.round(levels === 'video' ? 16 + f * 219 : f * 255);
}

function color(ire, spec) {
  const c = ireToCode(ire, spec.levels);
  const on = (ch) => (spec.rgb.includes(ch) ? c : ireToCode(0, spec.levels));
  return `rgb(${on('R')},${on('G')},${on('B')})`;
}

/** The patterns WinDAS offered in "Control SG", by name. */
export const WINDAS_PATTERNS = [
  { name: 'White 100 IRE', spec: { kind: 'field', ire: 100 } },
  { name: 'Black 0 IRE', spec: { kind: 'field', ire: 0 } },
  { name: 'Gray 30 IRE', spec: { kind: 'field', ire: 30 } },
  { name: 'Gray 50 IRE', spec: { kind: 'field', ire: 50 } },
  { name: '6% white window', spec: { kind: 'field', ire: 100, window: 6, bg: 0 } },
  { name: 'Crosshatch', spec: { kind: 'crosshatch', ire: 100 } },
  { name: '4×3 hatch', spec: { kind: 'hatch43', ire: 100 } },
  { name: '5×4 hatch', spec: { kind: 'hatch54', ire: 100 } },
  { name: 'Small hatch', spec: { kind: 'smallhatch', ire: 100 } },
  { name: 'Grayscale steps', spec: { kind: 'grayscale' } },
  { name: 'Checker', spec: { kind: 'checker', ire: 100 } },
  { name: 'Dot grid', spec: { kind: 'dots', ire: 100 } },
];

function grid(ctx, w, h, cols, rows, spec) {
  ctx.fillStyle = color(spec.bg, spec); ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = color(spec.ire, spec); ctx.lineWidth = Math.max(1, Math.round(h / 540));
  const lw = ctx.lineWidth;
  ctx.beginPath();
  for (let i = 0; i <= cols; i++) { const x = Math.min(w - lw / 2, Math.max(lw / 2, (w * i) / cols)); ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let j = 0; j <= rows; j++) { const y = Math.min(h - lw / 2, Math.max(lw / 2, (h * j) / rows)); ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}

/** Draw a pattern onto a 2D canvas context of size w x h. */
export function drawPattern(ctx, w, h, input) {
  const spec = { ...DEFAULT_SPEC, ...input };
  const fg = spec.invert ? spec.bg : spec.ire, bg = spec.invert ? spec.ire : spec.bg;
  const s = { ...spec, ire: fg, bg };
  switch (spec.kind) {
    case 'crosshatch': return grid(ctx, w, h, 12, 9, s);
    case 'hatch43': return grid(ctx, w, h, 4, 3, s);
    case 'hatch54': return grid(ctx, w, h, 5, 4, s);
    case 'smallhatch': return grid(ctx, w, h, 32, 24, s);
    case 'grayscale': {
      const n = 11;
      for (let i = 0; i < n; i++) { ctx.fillStyle = color((i * 100) / (n - 1), spec); ctx.fillRect(Math.round((w * i) / n), 0, Math.ceil(w / n), h); }
      return;
    }
    case 'checker': {
      const cols = 8, rows = 6;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { ctx.fillStyle = color((i + j) % 2 ? bg : fg, s); ctx.fillRect(Math.round((w * i) / cols), Math.round((h * j) / rows), Math.ceil(w / cols), Math.ceil(h / rows)); }
      return;
    }
    case 'dots': {
      ctx.fillStyle = color(bg, s); ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = color(fg, s);
      const cols = 12, rows = 9, r = Math.max(2, h / 270);
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { ctx.beginPath(); ctx.arc((w * i) / cols, (h * j) / rows, r, 0, 7); ctx.fill(); }
      return;
    }
    default: { // 'field': full screen, or a centred window (% of the area) on a surround
      ctx.fillStyle = color(bg, s); ctx.fillRect(0, 0, w, h);
      const k = Math.sqrt(Math.min(100, Math.max(1, spec.window)) / 100), ww = w * k, hh = h * k;
      ctx.fillStyle = color(fg, s); ctx.fillRect((w - ww) / 2, (h - hh) / 2, ww, hh);
    }
  }
}
