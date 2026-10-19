// Run with: node --test   (set WINDAS_DIR to your original WinDAS folder; tests skip if it is missing)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseChs, parseEcsTable, parseModelList } from '../src/core/tables.js';
import { Executor, Status } from '../src/core/executor.js';
import { RegisterBus } from '../src/core/bus.js';
import { SimLink } from '../src/core/links.js';
import { loadModel } from '../src/core/model.js';

const root = process.env.WINDAS_DIR ?? join(homedir(), 'Desktop', 'WINDAS');
const data = join(root, 'data');
const have = existsSync(data);
const opts = { skip: have ? false : `no WinDAS folder at ${root}` };
const tableFiles = have ? readdirSync(data).filter((f) => /\.(bus|ec2)$/i.test(f)) : [];
const fsSource = { getBytes: async (p) => new Uint8Array(readFileSync(join(root, p))) };

test('every shipped command table parses', opts, () => {
  assert.ok(tableFiles.length >= 20);
  for (const f of tableFiles) {
    const t = parseEcsTable(new Uint8Array(readFileSync(join(data, f))), f.endsWith('.bus') ? 1 : 2);
    assert.equal(t.commands[0].name, 'NON', f);
    const bad = t.registers.filter((r) => r.group >= t.groups.length || r.readCmd >= t.commands.length).length;
    assert.ok(bad * 20 <= t.registers.length, `${f}: ${bad} bad registers`);
  }
});

test('known command matches the decompile', opts, () => {
  const t = parseEcsTable(new Uint8Array(readFileSync(join(data, '19VC.ec2'))), 2);
  assert.equal(t.commands[1].name, 'Mode Cg(FACT)');
  assert.deepEqual(t.commands[1].send.slice(0, 8), [0xf1, 8, 1, 0xf0, 1, 0x1000, 2, 0x8000]);
});

test('model list decodes and every model resolves to a command table', opts, async () => {
  const list = parseModelList(new Uint8Array(readFileSync(join(root, 'mdlsel.ins'))));
  assert.ok(list.some((m) => m.name === 'GDM-FW900' && m.mdl === '3536'));
  const mdls = readdirSync(data).filter((f) => f.endsWith('.mdl'));
  for (const f of mdls) {
    const m = await loadModel(fsSource, f.replace(/\.mdl$/, ''));
    assert.ok(m.table.commands.length > 1, f);
  }
  assert.ok(mdls.length > 150);
});

test('chassis slider registers decode for CR1', opts, async () => {
  const chs = parseChs(new Uint8Array(readFileSync(join(data, 'CR1.chs'))));
  assert.deepEqual(chs.factoryRegisters, [0x110d, 0x110f, 0x110c, 0x110e, 0x1110, 0x1111, 0x1112, 0x1113]);
});

test('write then read back through the simulator (key tables)', opts, async () => {
  for (const f of ['CR1.ec2', '19VC.ec2', 'G1.bus', 'F99.bus', 'M1.ec2']) {
    const t = parseEcsTable(new Uint8Array(readFileSync(join(data, f))), f.endsWith('.bus') ? 1 : 2);
    const bus = new RegisterBus(new Executor(t, new SimLink(t)));
    let tried = 0, ok = 0;
    for (let abs = 1; abs < t.registers.length; abs++) {
      const r = t.registers[abs];
      if (r.group === 0 || r.group >= t.groups.length || !r.readCmd || !r.writeCmd || r.readCmd >= t.commands.length || r.writeCmd >= t.commands.length) continue;
      if ((r.mask !== 0 && r.mask !== 0xffff) || r.shift !== 0) continue;
      const id = t.idOf(abs); if (id < 0) continue;
      const g = t.groups[r.group];
      const max = Math.min(g.max, g.is16 ? 0xffff : 0xff), min = Math.max(g.min, 0);
      if (max < min) continue;
      const v = min + ((max - min) >> 1);
      tried++;
      const ws = await bus.write(id, v); await bus.flush();
      const rd = await bus.read(id, 1);
      if (ws === Status.OK && rd.status === Status.OK && rd.value === v) ok++;
    }
    assert.ok(tried > 100 && ok * 100 >= tried * 90, `${f}: ${ok}/${tried}`);
  }
});

test('session scripts decode and run (G1 chassis: Enter Factory ... Exit Factory)', opts, async () => {
  const { runScript } = await import('../src/core/session.js');
  const m = await loadModel(fsSource, '3536');
  const names = (steps) => steps.map((s) => `${m.table.registers[m.table.abs(s.id)].name.trim()}=${s.value}`).join(', ');
  assert.equal(names(m.chs.startScript), 'Enter Factory=-923, Exit Factory=0, Timer=1, !Key on/off=1');
  assert.equal(names(m.chs.exitScript), '!Key on/off=0, Clear Warranty=0, Exit Factory=0, Timer=2');
  const bus = new RegisterBus(new Executor(m.table, new SimLink(m.table)));
  const r = await runScript(bus, m.chs.startScript, async () => {});
  assert.deepEqual(r, { ok: true, message: 'OK' });
  assert.equal((await runScript(bus, m.chs.exitScript, async () => {})).ok, true);
});
