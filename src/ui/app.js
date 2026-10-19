import { loadModel, loadModelList, folderSource } from '../core/model.js';
import { Executor, Status } from '../core/executor.js';
import { RegisterBus } from '../core/bus.js';
import { SerialLink, SimLink } from '../core/links.js';
import { runScript } from '../core/session.js';
import { DEFAULT_SPEC, WINDAS_PATTERNS, drawPattern } from '../core/patterns.js';

// ---------- tiny helpers ----------
const $ = (s, r = document) => r.querySelector(s);
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
}
const btn = (label, onclick, cls = '', extra = {}) => el('button', { class: `btn ${cls}`, onclick, ...extra }, label);
const describe = (st) =>
  st === Status.OK ? 'OK'
  : st === Status.LINK ? 'No reply from the monitor — check the cable, port and that the monitor is in service mode'
  : st === Status.BAD_REPLY ? 'Unexpected reply from the monitor'
  : st === Status.TIMEOUT ? 'Monitor timed out'
  : st >= Status.NAK_BASE && st < Status.NAK_BASE + 256 ? `Monitor rejected the command (code 0x${(st - Status.NAK_BASE).toString(16)})`
  : `Error 0x${st.toString(16)}`;

// ---------- persistent folder handle ----------
const idb = {
  open: () => new Promise((res, rej) => { const r = indexedDB.open('windas', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  async get(k) { try { const db = await this.open(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch { return undefined; } },
  async set(k, v) { try { const db = await this.open(); db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch { /* optional */ } },
};

// ---------- state ----------
const S = {
  src: null, folderName: '', models: [], entry: null, model: null,
  link: null, bus: null, simulated: false, trace: [], page: 'setup', savedHandle: null,
  queue: Promise.resolve(),
};
const addTrace = (line) => { S.trace.push(`${new Date().toLocaleTimeString([], { hour12: false })}.${String(Date.now() % 1000).padStart(3, '0')}  ${line}`); if (S.trace.length > 2000) S.trace.shift(); const l = $('#log'); if (l) { l.textContent = S.trace.join('\n'); l.scrollTop = l.scrollHeight; } };
/** Serialise bus operations: the link is half duplex. */
const run = (fn) => (S.queue = S.queue.then(fn, fn));
const connected = () => !!S.bus;

function setStatus() {
  const t = connected() ? (S.simulated ? 'Connected to simulator' : 'Connected on serial port (9600 8N1)')
    : S.entry ? `${S.entry.name} loaded — not connected` : 'Not connected';
  $('#statusText').textContent = t;
  $('#dot').className = connected() ? 'on' : S.entry ? 'model' : '';
  for (const b of document.querySelectorAll('#nav button')) b.disabled = !['setup', 'patterns', 'log'].includes(b.dataset.page) && !S.model;
}

// ---------- actions ----------
async function useFolder(handle) {
  S.src = folderSource(handle);
  S.folderName = handle.name;
  S.models = await loadModelList(S.src);
}

async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: 'windas', mode: 'read' });
  await idb.set('folder', handle);
  await useFolder(handle);
}

async function selectModel(m) {
  await disconnect();
  S.model = await loadModel(S.src, m.mdl);
  S.entry = m;
  localStorage.setItem('lastModel', m.name);
  setStatus();
}

async function connect(simulated) {
  await disconnect();
  S.simulated = simulated;
  S.link = simulated ? new SimLink(S.model.table) : await SerialLink.request();
  S.bus = new RegisterBus(new Executor(S.model.table, S.link, addTrace));
  // Same handshake WinDAS performs (e.g. "Enter Factory" on older chassis).
  const r = await runScript(S.bus, S.model.chs.startScript);
  if (!r.ok) { await disconnect(false); throw new Error(r.message); }
  setStatus();
}

async function disconnect(runExit = true) {
  // Leave the monitor as WinDAS does (e.g. "Exit Factory") so its on-screen menu is not left locked.
  if (runExit && S.bus && S.model) { try { await run(() => runScript(S.bus, S.model.chs.exitScript)); } catch { /* link may be gone */ } }
  if (S.link) await S.link.close();
  S.link = S.bus = null;
  setStatus();
}

// ---------- pages ----------
function setupPage() {
  const root = el('div');
  root.append(el('h1', {}, 'Setup'), el('p', { class: 'hint' }, 'Pick your monitor model, then connect the serial adapter. Nothing is written to the monitor until you change a value.'));

  if (!('serial' in navigator)) root.append(el('p', { class: 'warn' }, 'This browser has no Web Serial support. Open this page in Microsoft Edge or Google Chrome to talk to a real monitor (the simulator still works).'));

  // 1. folder + model
  const left = el('div');
  left.append(el('h2', {}, '1 · Your WinDAS folder'));
  const fnote = el('div', { class: 'note' });
  const row = el('div', { class: 'row' });
  const refresh = () => { setStatus(); mount(setupPage()); };
  row.append(btn(S.src ? 'Choose a different folder' : 'Choose WinDAS folder…', async () => { try { await pickFolder(); refresh(); } catch (e) { if (e.name !== 'AbortError') fnote.textContent = e.message; } }, S.src ? '' : 'primary'));
  if (!S.src && S.savedHandle) row.append(btn(`Reuse “${S.savedHandle.name}”`, async () => {
    try { if ((await S.savedHandle.requestPermission({ mode: 'read' })) === 'granted') { await useFolder(S.savedHandle); refresh(); } } catch (e) { fnote.textContent = e.message; }
  }, 'primary'));
  left.append(row, fnote);
  fnote.textContent = S.src ? `${S.folderName} — ${S.models.length} models found. Files are read in your browser only; nothing is uploaded.` : 'Select the original WinDAS folder (the one containing windas.exe and a data folder). It is read locally and never uploaded.';

  if (S.src) {
    const search = el('input', { type: 'search', placeholder: 'Search, e.g. P1130' });
    const brands = ['All brands', ...[...new Set(S.models.map((m) => m.brand))].sort((x, y) => (x === 'Sony' ? -1 : y === 'Sony' ? 1 : x.localeCompare(y)))];
    const brandSel = el('select', {}, brands.map((b) => el('option', {}, b)));
    const list = el('ul', { class: 'models' });
    const note = el('div', { class: 'note' }, S.entry ? `${S.entry.name} loaded · ${S.model.table.registers.length} registers · ${S.model.table.mode === 1 ? 'ECS' : 'ECS2'} protocol` : '');
    const paint = () => {
      const q = search.value.trim().toLowerCase(), bf = brandSel.selectedIndex > 0 ? brandSel.value : null;
      list.replaceChildren(...S.models.filter((m) => (!bf || m.brand === bf) && (!q || `${m.name} ${m.brand}`.toLowerCase().includes(q))).map((m) =>
        el('li', { class: S.entry === m ? 'sel' : '', onclick: async () => { try { await selectModel(m); note.textContent = ''; refresh(); } catch (e) { note.textContent = 'Could not load model: ' + e.message; } } }, el('span', {}, m.name), el('small', {}, `${m.brand} · ${m.mdl}.mdl`))));
    };
    search.addEventListener('input', paint); brandSel.addEventListener('change', paint); paint();
    left.append(el('h2', { style: 'margin-top:18px' }, 'Monitor model'), el('div', { class: 'row' }, search, brandSel), list, note);
  }

  // 2. connection
  const right = el('div');
  const cnote = el('div', { class: 'note' });
  right.append(el('h2', {}, '2 · Connection'));
  const cbtns = el('div', { class: 'row' },
    btn('Connect serial adapter…', async () => { try { await connect(false); cnote.textContent = 'Port open. Use Factory Preset → Read; the Wire log shows every byte.'; refresh(); } catch (e) { if (e.name !== 'NotFoundError') cnote.textContent = 'Could not connect: ' + e.message; } }, 'primary', { disabled: !S.model || !('serial' in navigator) }),
    btn('Use simulator', async () => { await connect(true); cnote.textContent = 'Simulator connected. It echoes what you write; it is not a real monitor.'; refresh(); }, '', { disabled: !S.model }),
    btn('Disconnect', async () => { await disconnect(); refresh(); }, '', { disabled: !connected() }));
  right.append(cbtns, cnote,
    el('div', { class: 'card' }, el('b', {}, 'Wiring (TTL ⇄ monitor service port)'), el('br'), 'Adapter TXD → monitor RXD', el('br'), 'Adapter RXD → monitor TXD', el('br'), 'GND → GND (5 V is not needed)', el('br'), 'Link: 9600 baud, 8 data bits, no parity, 1 stop bit.'));
  if (!S.model) cnote.textContent = 'Choose a model first.';
  root.append(el('div', { class: 'cols' }, left, right));
  return root;
}

function factoryPage() {
  const root = el('div');
  root.append(el('h1', {}, 'Factory Preset'));
  const t = S.model.table;
  const regs = S.model.chs.factoryRegisters.filter((id) => t.abs(id) < t.registers.length);
  root.append(el('p', { class: 'hint' }, connected() ? `${S.entry.name} · ${regs.length} adjustments for this chassis. Press “Read from monitor” first.` : `${S.entry.name} · not connected. Connect on the Setup page, then read.`));
  const msg = el('div', { class: 'note' });
  const rows = regs.map((id) => {
    const reg = t.registers[t.abs(id)], g = t.groups[Math.min(reg.group, t.groups.length - 1)];
    const min = Math.max(0, g.min), max = Math.max(g.min + 1, g.max);
    const range = el('input', { type: 'range', min, max, step: 1, value: min, disabled: true });
    const num = el('input', { type: 'number', min, max, value: min, disabled: true });
    const o = { id, name: reg.name.trim(), min, max, range, num, value: min };
    const set = (v, write) => { v = Math.min(max, Math.max(min, Math.round(Number(v)) || 0)); o.value = v; range.value = v; num.value = v; if (write) schedule(o); };
    o.set = set;
    range.addEventListener('input', () => set(range.value, true));
    num.addEventListener('change', () => set(num.value, true));
    o.el = el('div', { class: 'slider-row' },
      el('span', { class: 'name', title: `Register 0x${id.toString(16).padStart(4, '0')}` }, o.name), range,
      btn('−', () => set(o.value - 1, true), '', { disabled: true }), num, btn('+', () => set(o.value + 1, true), '', { disabled: true }),
      el('span', { class: 'range' }, `${min} – ${max}`));
    return o;
  });
  const enable = (on) => { for (const o of rows) for (const e of o.el.querySelectorAll('input,button')) e.disabled = !on; };

  let baseline = new Map(), pending = new Map(), timer = null, flushing = false;
  function schedule(o) { if (!connected() || !live.checked) return; pending.set(o.id, o); clearTimeout(timer); timer = setTimeout(flush, 180); }
  async function flush() {
    if (flushing) { timer = setTimeout(flush, 100); return; }
    flushing = true;
    try {
      while (pending.size) {
        const [id, o] = pending.entries().next().value; pending.delete(id);
        const v = o.value;
        const st = await run(() => S.bus.write(id, v));
        msg.textContent = st === Status.OK ? `${o.name} = ${v}` : `${o.name}: ${describe(st)}`;
      }
    } finally { flushing = false; }
  }

  const live = el('input', { type: 'checkbox', checked: true });
  const readBtn = btn('Read from monitor', async () => {
    readBtn.disabled = restoreBtn.disabled = true; enable(false);
    msg.textContent = 'Reading…'; baseline = new Map(); let fails = 0;
    for (const o of rows) {
      const { status, value } = await run(() => S.bus.read(o.id, 1));
      if (status === Status.OK) { o.set(value, false); baseline.set(o.id, value); }
      else { fails++; msg.textContent = `${o.name}: ${describe(status)}`; if (fails >= 2) break; }
    }
    if (!fails) msg.textContent = 'Read complete. Move a slider to adjust; changes are written immediately.';
    readBtn.disabled = false; restoreBtn.disabled = !baseline.size; enable(true);
  }, '', { disabled: !connected() });
  const restoreBtn = btn('Restore values from last read', async () => {
    for (const o of rows) { const v = baseline.get(o.id); if (v == null) continue; const st = await run(() => S.bus.write(o.id, v)); if (st !== Status.OK) { msg.textContent = `${o.name}: ${describe(st)}`; return; } o.set(v, false); }
    msg.textContent = 'Restored the values captured at the last read.';
  }, '', { disabled: true });
  root.append(el('div', { class: 'row' }, readBtn, restoreBtn, el('label', {}, live, ' Write as I move')), ...rows.map((o) => o.el), msg);
  if (connected()) enable(true);
  return root;
}

function registersPage() {
  const t = S.model.table;
  const all = [];
  let abs = 0;
  t.blocks.forEach((b, bi) => {
    for (let i = 0; i < b.count; i++, abs++) {
      const reg = t.registers[abs];
      if (!reg || reg.group === 0 || !reg.name.trim() || reg.name.trim() === 'NON') continue;
      const g = t.groups[Math.min(reg.group, t.groups.length - 1)];
      all.push({ id: (bi << 8) | i, name: reg.name.trim(), block: b.name, min: Math.max(0, g.min), max: Math.max(g.min + 1, g.max), value: 0, status: '' });
    }
  });
  const root = el('div');
  root.append(el('h1', {}, 'Registers'), el('p', { class: 'hint' }, `${S.entry.name} · ${all.length} adjustable registers. ${connected() ? 'Writes go to the monitor immediately.' : 'Connect on the Setup page to read or write.'}`));
  const filter = el('input', { type: 'search', placeholder: 'Filter by register name', style: 'flex:1; min-width:160px' });
  const blocks = ['All blocks', ...new Set(t.blocks.map((b) => b.name).filter((n) => n !== 'NON'))];
  const blockSel = el('select', {}, blocks.map((b) => el('option', {}, b)));
  const body = el('tbody');
  const msg = el('div', { class: 'note' });
  let shown = [];
  const cellStatus = new Map();

  async function readRow(r) {
    if (!connected()) { msg.textContent = 'Not connected.'; return; }
    const { status, value } = await run(() => S.bus.read(r.id, 1));
    if (status === Status.OK) { r.value = value; r.status = 'read'; } else r.status = describe(status);
    paintRow(r);
  }
  async function writeRow(r) {
    if (!connected()) { msg.textContent = 'Not connected.'; return; }
    const st = await run(() => S.bus.write(r.id, r.value));
    r.status = st === Status.OK ? 'written' : describe(st);
    paintRow(r);
  }
  function paintRow(r) { const c = cellStatus.get(r); if (c) { c.input.value = r.value; c.status.textContent = r.status; } }

  function paint() {
    const q = filter.value.trim().toLowerCase(), b = blockSel.selectedIndex > 0 ? blockSel.value : null;
    const rank = (r) => { const n = r.name.toLowerCase(); return n === q ? 0 : n.startsWith(q) ? 1 : 2; };
    shown = all.filter((r) => (!q || r.name.toLowerCase().includes(q)) && (!b || r.block === b));
    if (q) shown.sort((x, y) => rank(x) - rank(y)); // exact and prefix matches first (stable otherwise)
    cellStatus.clear();
    body.replaceChildren(...shown.map((r) => {
      const input = el('input', { type: 'number', min: r.min, max: r.max, value: r.value });
      input.addEventListener('change', () => { r.value = Math.min(r.max, Math.max(r.min, Math.round(Number(input.value)) || 0)); input.value = r.value; });
      const status = el('td', { class: 'wrap' }, r.status);
      cellStatus.set(r, { input, status });
      return el('tr', {}, el('td', {}, r.id.toString(16).padStart(4, '0')), el('td', {}, r.block), el('td', {}, r.name), el('td', {}, `${r.min} – ${r.max}`), el('td', {}, input),
        el('td', {}, btn('Read', () => readRow(r), '', { disabled: !connected() }), ' ', btn('Write', () => writeRow(r), '', { disabled: !connected() })), status);
    }));
  }
  filter.addEventListener('input', paint); blockSel.addEventListener('change', paint);
  const readAll = btn('Read all shown', async () => {
    readAll.disabled = true; let n = 0, fails = 0;
    for (const r of shown) {
      await readRow(r); msg.textContent = `Reading… ${++n}/${shown.length}`;
      if (r.status !== 'read' && ++fails >= 3 && n === fails) { msg.textContent = 'Stopped: the monitor is not answering.'; break; }
    }
    if (n === shown.length) msg.textContent = 'Done.';
    readAll.disabled = false;
  }, '', { disabled: !connected() });
  root.append(el('div', { class: 'row' }, filter, blockSel, readAll),
    el('div', { class: 'tablewrap' }, el('table', {}, el('thead', {}, el('tr', {}, ['ID', 'Block', 'Name', 'Range', 'Value', '', 'Result'].map((h) => el('th', {}, h)))), body)), msg);
  paint();
  return root;
}

function logPage() {
  const root = el('div');
  root.append(el('h1', {}, 'Wire log'), el('p', { class: 'hint' }, 'Every byte sent (TX) and received (RX). Useful when a monitor does not answer.'));
  root.append(el('div', { class: 'row' }, btn('Clear', () => { S.trace.length = 0; $('#log').textContent = ''; }), btn('Copy all', () => navigator.clipboard.writeText(S.trace.join('\n')))));
  const pre = el('pre', { id: 'log' }, S.trace.join('\n'));
  root.append(pre);
  queueMicrotask(() => { pre.scrollTop = pre.scrollHeight; });
  return root;
}


// ---------- patterns ----------
const patternChannel = new BroadcastChannel('windas-pattern');
let patternWin = null;
/** Show a pattern on the pattern window (opened on the CRT). Also what an external controller (HCFR) calls. */
function showPattern(spec) {
  S.spec = { ...DEFAULT_SPEC, ...spec };
  patternChannel.postMessage({ type: 'pattern', spec: S.spec });
  S.onSpec?.();
}
S.spec = { ...DEFAULT_SPEC };

function patternsPage() {
  const root = el('div');
  root.append(el('h1', {}, 'Patterns'), el('p', { class: 'hint' }, 'Open the pattern window on your CRT, then pick or dial in any pattern. HCFR can drive this automatically (see HCFR link).'));

  const note = el('div', { class: 'note' });
  const screenSel = el('select', { disabled: true }, el('option', {}, 'This display'));
  let screens = null;
  const detect = btn('Detect displays', async () => {
    try {
      screens = await window.getScreenDetails();
      screenSel.replaceChildren(...screens.screens.map((s, i) => el('option', { value: i }, `${s.label || 'Display ' + (i + 1)} — ${s.width}×${s.height}${s.isPrimary ? ' (primary)' : ''}`)));
      screenSel.disabled = false; note.textContent = 'Pick your CRT, then Open pattern window.';
    } catch (e) { note.textContent = 'Could not list displays (' + e.message + '). You can still drag the pattern window onto the CRT.'; }
  }, '', { disabled: !('getScreenDetails' in window) });
  const open = btn('Open pattern window', () => {
    const s = screens?.screens[Number(screenSel.value) || 0];
    const f = s ? `popup,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}` : 'popup,width=900,height=700';
    patternWin = window.open('pattern.html', 'windas-pattern', f);
    if (!patternWin) note.textContent = 'The browser blocked the popup — allow popups for this page and try again.';
    else { note.textContent = 'Click inside the pattern window (or press F) for full screen.'; setTimeout(() => patternChannel.postMessage({ type: 'pattern', spec: S.spec }), 600); }
  }, 'primary');
  root.append(el('div', { class: 'card' }, el('h2', {}, 'Pattern window'), el('div', { class: 'row' }, detect, screenSel, open), note));

  const quick = el('div', { class: 'row' }, WINDAS_PATTERNS.map((p) => btn(p.name, () => { showPattern({ ...DEFAULT_SPEC, ...p.spec }); })));
  root.append(el('div', { class: 'card' }, el('h2', {}, 'WinDAS patterns'), quick));

  const preview = el('canvas', { width: 320, height: 240, style: 'width:100%;max-width:320px;border:1px solid var(--line);border-radius:6px;background:#000' });
  const ire = el('input', { type: 'range', min: 0, max: 100, step: 1 }), ireNum = el('input', { type: 'number', min: 0, max: 100, style: 'width:78px' });
  const win = el('input', { type: 'number', min: 1, max: 100, style: 'width:78px' }), bg = el('input', { type: 'number', min: 0, max: 100, style: 'width:78px' });
  const rgb = el('select', {}, ['RGB', 'R', 'G', 'B', 'RG', 'RB', 'BG'].map((c) => el('option', {}, c)));
  const kind = el('select', {}, [['field', 'Field / window'], ['crosshatch', 'Crosshatch'], ['hatch43', '4×3 hatch'], ['hatch54', '5×4 hatch'], ['smallhatch', 'Small hatch'], ['grayscale', 'Grayscale steps'], ['checker', 'Checker'], ['dots', 'Dot grid']].map(([v, t]) => el('option', { value: v }, t)));
  const levels = el('select', {}, [['pc', 'PC levels (0–255)'], ['video', 'Video levels (16–235)']].map(([v, t]) => el('option', { value: v }, t)));
  const invert = el('input', { type: 'checkbox' });
  const sync = () => {
    const s = S.spec; ire.value = ireNum.value = s.ire; win.value = s.window; bg.value = s.bg; rgb.value = s.rgb; kind.value = s.kind; levels.value = s.levels; invert.checked = s.invert;
    drawPattern(preview.getContext('2d'), preview.width, preview.height, s);
  };
  const push = () => showPattern({ kind: kind.value, ire: Number(ireNum.value), window: Number(win.value), bg: Number(bg.value), rgb: rgb.value, invert: invert.checked, levels: levels.value });
  ire.addEventListener('input', () => { ireNum.value = ire.value; push(); });
  for (const e of [ireNum, win, bg]) e.addEventListener('change', push);
  for (const e of [rgb, kind, levels, invert]) e.addEventListener('change', push);
  S.onSpec = sync; sync();
  const label = (t, e) => el('label', { style: 'display:flex;flex-direction:column;gap:4px' }, el('span', { class: 'note', style: 'margin:0' }, t), e);
  root.append(el('div', { class: 'card' }, el('h2', {}, 'Fine control'),
    el('div', { class: 'row', style: 'align-items:flex-start;gap:24px' }, preview,
      el('div', { style: 'flex:1;min-width:260px' },
        el('div', { class: 'row' }, label('Pattern', kind), label('Channels', rgb), label('Levels', levels)),
        el('div', { class: 'row' }, label('IRE (brightness %)', el('div', { class: 'row', style: 'margin:0' }, btn('−', () => { ireNum.value = Math.max(0, ireNum.value - 1); push(); }), ire, btn('+', () => { ireNum.value = Math.min(100, Number(ireNum.value) + 1); push(); }), ireNum))),
        el('div', { class: 'row' }, label('Window size %', win), label('Surround IRE', bg), el('label', { style: 'margin-top:18px' }, invert, ' Invert'))))));
  return root;
}

// ---------- shell ----------
function mount(node) { $('#page').replaceChildren(node); }
function show(page) {
  if (!['setup', 'patterns', 'log'].includes(page) && !S.model) page = 'setup';
  S.page = page;
  for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('active', b.dataset.page === page);
  mount({ setup: setupPage, factory: factoryPage, registers: registersPage, patterns: patternsPage, log: logPage }[page]());
  setStatus();
}
document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.page)));

// Heartbeat for the local launcher (lets serve.js quit when the window closes); harmless elsewhere.
if (location.hostname === '127.0.0.1') setInterval(() => fetch('/__ping').catch(() => {}), 5000);

(async () => {
  // Dev/test hook (served by serve.js when WINDAS_DIR is set): load a folder over HTTP instead of the picker.
  const q = new URLSearchParams(location.search);
  if (q.has('dev')) {
    const base = '/__windas/';
    S.src = { getBytes: async (p) => new Uint8Array(await (await fetch(base + p)).arrayBuffer()) };
    S.folderName = 'dev'; S.models = await loadModelList(S.src);
    const m = S.models.find((x) => x.name === (q.get('model') ?? 'GDM-FW900'));
    if (m) { await selectModel(m); if (q.has('sim')) await connect(true); }
    show(q.get('page') ?? 'setup');
    return;
  }
  S.savedHandle = await idb.get('folder');
  show('setup');
})();
