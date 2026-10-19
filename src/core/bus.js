// Register-level access. Port of windas.exe FUN_0040b8d0/c637 (read) and FUN_0040ba83/c1c0 (write).
import { Status } from './executor.js';

export const COMMIT = 1;

export class RegisterBus {
  constructor(ex) {
    this.ex = ex; this.t = ex.table;
    this.out = new Uint8Array(256);    // data sent / received
    this.cache = new Uint8Array(256);  // last read block
    this.shadow = new Map();           // abs -> last raw value read
    this.p = { cmd: -1, a1: -1, a2: -1 }; this.busy = -1; this.flags = -1;  // pending write batch
    this.r = { cmd: -1, a1: -1, a2: -1 };                                    // last read identity
  }

  group(i) { return this.t.groups[i] ?? this.t.groups[0]; }
  limits(id) { const g = this.group(this.t.registers[this.t.abs(id)].group); return { min: g.min, max: g.max }; }

  async read(id, flags = 0) {
    const abs = this.t.abs(id), rec = this.t.registers[abs];
    if (!rec) return { status: Status.BAD_REPLY, value: 0 };
    if (rec.group === 0) return { status: Status.OK, value: 0 };
    const grp = this.group(rec.group);
    if (grp.slow) this.ex.link.timeoutMs = 20000;
    let res = { status: Status.OK, value: 0 };
    for (let i = 0; i < 2; i++) { res = await this.#readRaw(abs, grp.arg2, flags); if (res.status === Status.OK) break; }
    this.ex.link.timeoutMs = 3000;
    return res;
  }

  async write(id, value, flags = COMMIT) {
    const abs = this.t.abs(id), rec = this.t.registers[abs];
    if (!rec) return Status.BAD_REPLY;
    if (rec.group === 0) return Status.OK;
    const grp = this.group(rec.group);
    if (grp.slow) this.ex.link.timeoutMs = 20000;
    let st = Status.OK;
    for (let i = 0; i < 2; i++) { st = await this.#writeRaw(abs, grp.arg2, value, flags); if (st === Status.OK) break; }
    this.ex.link.timeoutMs = 3000;
    return st;
  }

  async flush() {
    if (this.p.cmd < 0 || (this.flags & 1) !== 0) return Status.OK;
    const st = await this.ex.execute(this.p.cmd, this.p.a1, this.p.a2, this.out, new Uint8Array(256));
    if (st === Status.OK) this.flags |= 1;
    return st;
  }

  async #preFlush() {
    if (this.p.cmd >= 0 && (this.flags & 1) === 0 && this.busy === 0) {
      const st = await this.ex.execute(this.p.cmd, this.p.a1, this.p.a2, this.out, new Uint8Array(256));
      if (st !== Status.OK) return st;
      this.flags |= 1;
    }
    return Status.OK;
  }

  async #readRaw(abs, arg2, flags) {
    const rec = this.t.registers[abs], grp = this.group(rec.group);
    if ((this.flags & 1) === 0 && this.busy === 0 && (this.p.cmd !== rec.writeCmd || this.p.a1 !== rec.writeArg1 || this.p.a2 !== arg2)) {
      const pf = await this.#preFlush();
      if (pf !== Status.OK) return { status: pf, value: 0 };
    }
    let raw, st;
    const entry = this.t.commands[rec.readCmd];
    if ((flags & 1) === 0 && this.r.cmd === rec.readCmd && this.r.a1 === rec.readArg1 && this.r.a2 === arg2) {
      raw = this.cache[rec.readOff];
      if (grp.is16) raw = raw * 256 + this.cache[rec.readOff + 1];
      st = Status.OK;
    } else {
      const scratch = new Uint8Array(256);
      st = await this.ex.execute(rec.readCmd, rec.readArg1, arg2, scratch, this.out);
      raw = this.out[rec.readOff];
      if (grp.is16) {
        if (entry && entry.flag === 0) {
          st = await this.ex.execute(rec.readCmd, (rec.readArg1 + 1) & 0xff, arg2, scratch, this.out);
          raw = raw * 256 + this.out[rec.readOff];
        } else raw = raw * 256 + this.out[rec.readOff + 1];
      }
      this.cache.set(this.out);
    }
    this.shadow.set(abs, raw);
    const mask = rec.mask === 0 ? 0xffff : rec.mask;
    const value = (raw >> rec.shift) & mask;
    if (st === Status.OK) { this.r = { cmd: rec.readCmd, a1: rec.readArg1, a2: arg2 }; this.flags = flags; } else this.flags = -1;
    return { status: st, value };
  }

  async #writeRaw(abs, arg2, value, flags) {
    const rec = this.t.registers[abs], grp = this.group(rec.group);
    const wcmd = rec.writeCmd; let warg1 = rec.writeArg1, woff = rec.writeOff, boff = rec.readOff;
    if ((this.flags & 1) === 0 && this.busy === 0 && (this.p.cmd !== wcmd || this.p.a1 !== warg1 || this.p.a2 !== arg2)) {
      const pf = await this.#preFlush();
      if (pf !== Status.OK) return pf;
    }
    const wflag = this.t.commands[wcmd]?.flag ?? 0;
    let st = Status.OK, cur = -1;
    if (wflag === 1) { const r = await this.#readRaw(abs, this.group(rec.group).arg2, flags); st = r.status; cur = r.value; }
    const mask = rec.mask;
    if (st === Status.OK && mask !== 0 && mask !== 0xffff) {
      if (cur === -1) { const r = await this.#readRaw(abs, grp.arg2, flags); st = r.status; }
      if (st === Status.OK) { const m = mask << rec.shift; value = ((this.shadow.get(abs) ?? 0) & ~m) + ((value << rec.shift) & m); }
    }
    if (st === Status.OK && grp.is16) {
      const hi = (value >> 8) & 0xff;
      if (wflag === 0) {
        this.out[0] = hi; this.cache[0] = hi;
        st = await this.ex.execute(wcmd, warg1, arg2, this.out, new Uint8Array(256));
        warg1++; boff++;
      } else { this.out[woff] = hi; this.cache[boff] = hi; woff++; boff++; }
    }
    if (st === Status.OK) this.out[woff] = value & 0xff;
    this.cache[boff] = value & 0xff;
    if (flags & 1) st = await this.ex.execute(wcmd, warg1 & 0xff, arg2, this.out, new Uint8Array(256));
    if (st === Status.OK) { this.p = { cmd: wcmd, a1: warg1, a2: arg2 }; this.busy = 0; this.flags = flags; } else this.flags = -1;
    return st;
  }
}
