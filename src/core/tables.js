// Parsers for WinDAS data files. Layouts reverse-engineered from windas.exe; see NOTES.md.
const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const i32 = (d, o) => d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24);
const ascii = (d, o, n) => String.fromCharCode(...d.subarray(o, o + n));

export function cstr(d, o, n = d.length - o, swap = false) {
  let s = '';
  for (let i = o; i < o + n && d[i]; i++) {
    const b = swap ? ((d[i] << 4) | (d[i] >> 4)) & 0xff : d[i];
    s += String.fromCharCode(b);
  }
  return s;
}

function section(d, p, tag, size, parse) {
  if (p + 16 > d.length) throw new Error(`truncated before ${tag}`);
  if (ascii(d, p, 4) !== '====' || ascii(d, p + 4, 4) !== tag) throw new Error(`expected ====${tag} at 0x${p.toString(16)}`);
  const n = i32(d, p + 8);
  p += 16;
  if (n < 0 || p + n * size > d.length) throw new Error(`${tag} count ${n} overruns file`);
  const list = [];
  for (let i = 0; i < n; i++, p += size) list.push(parse(d.subarray(p, p + size)));
  return [list, p];
}

const ints = (r, o, n) => Array.from({ length: n }, (_, i) => i32(r, o + i * 4));

/** Parse a .bus (ECS, mode 1) or .ec2 (ECS2, mode 2) command/register table. */
export function parseEcsTable(d, mode) {
  let p = 0, commands, groups, blocks, registers;
  [commands, p] = section(d, p, 'FOR=', 0x98, (r) => ({ name: cstr(r, 0, 20), send: ints(r, 0x14, 16), recv: ints(r, 0x54, 16), flag: i32(r, 0x94) }));
  [groups, p] = section(d, p, 'GRP=', 0x20, (r) => ({ name: cstr(r, 0, 20), flags: r[0x14], mode: r[0x15], arg2: r[0x16], max: i32(r, 0x18), min: i32(r, 0x1c), is16: (r[0x14] & 4) !== 0, slow: r[0x15] === 6 }));
  [blocks, p] = section(d, p, 'R_B=', 0x10, (r) => ({ count: r[0], name: cstr(r, 1, 11) }));
  [registers, p] = section(d, p, 'REG=', 0x24, (r) => ({
    name: cstr(r, 0, 16), writeCmd: r[0x10], writeArg1: r[0x11], writeOff: r[0x12],
    readCmd: r[0x13], readArg1: r[0x14], readOff: r[0x15], group: r[0x19], shift: r[0x1a], mask: i32(r, 0x1c),
  }));
  const blockOffset = new Array(256).fill(0);
  let sum = 0;
  blocks.forEach((b, i) => { blockOffset[i] = sum; sum += b.count; });
  for (let i = blocks.length; i < 256; i++) blockOffset[i] = sum;
  return {
    mode, commands, groups, blocks, registers,
    /** absolute register index for a (block<<8)|idx id */
    abs: (id) => blockOffset[(id >> 8) & 0xff] + (id & 0xff),
    /** id for an absolute index, or -1 */
    idOf(abs) {
      let off = 0;
      for (let b = 0; b < blocks.length; b++) { if (abs < off + blocks[b].count) return (b << 8) | (abs - off); off += blocks[b].count; }
      return -1;
    },
  };
}

// Brand codes seen in mdlsel.ins. Labels are inferred from the model names in each group (Dell Pxxx, IBM 655x, FMV = Fujitsu, ...).
const BRANDS = { 1: 'Sony', 4: 'Dell', 5: 'IBM', 6: 'HP / Compaq', 8: 'NEC', 9: 'Fujitsu' };

/** mdlsel.ins: 128-byte records, strings nibble-swapped. */
export function parseModelList(d) {
  const list = [];
  for (let o = 0; o + 128 <= d.length; o += 128) {
    const name = cstr(d, o, 22, true);
    if (!name) continue;
    const brand = u16(d, o + 0x2a);
    list.push({ name, mdl: cstr(d, o + 0x16, 10, true), base: cstr(d, o + 0x20, 16, true), brandCode: brand, brand: BRANDS[brand] ?? `Other (${brand})` });
  }
  return list;
}

export function parseMdl(d) {
  if (d.length < 0x50 || ascii(d, 0, 8) !== '====MDL=') throw new Error('not a .mdl file');
  const chassis = cstr(d, 16, 16);
  const nPre = u16(d, 32);
  let p = 16 + 16 + 8 + 16 + 8 + 16;
  const recs = (n, size) => { const l = []; for (let i = 0; i < n; i++, p += size) l.push(d.subarray(p, p + size)); return l; };
  const preParas = recs(nPre, 0x50);
  return { chassis, preParas, preParaNames: preParas.map((r) => cstr(r, 0, 16)) };
}

export function parseChs(d) {
  const n = Math.min(u16(d, 0x14), 8);
  const sliders = [];
  for (let i = 0; i < n; i++) sliders.push(u16(d, 0x16 + i * 2));
  return { std: cstr(d, 0), factoryRegisters: sliders };
}

export function parseStd(d) {
  if (ascii(d, 0, 8) !== '====STD=') throw new Error('not a .std file');
  return { ecs: cstr(d, 16 + 0x3fec) };
}
