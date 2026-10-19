// Template-driven monitor packets (ECS mode 1 / ECS2 mode 2). Port of windas.exe FUN_0040dab2 & friends.
export const Status = { OK: 1, LINK: 0x20000001, BAD_REPLY: 0x20000002, TIMEOUT: 0x20000003, NAK_BASE: 0x20001000 };

const LITERAL = 0x100, ARG1 = 0x1000, ARG2 = 0x4000, DATA = 0x2000;
const hex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');

export class Executor {
  /** @param table parsed table  @param link {write(bytes), read(timeoutMs)->byte|null, purge(), timeoutMs} */
  constructor(table, link, trace = null) { this.table = table; this.link = link; this.trace = trace; }

  command(i) {
    const end = this.table.mode === 1 ? 0xff : 0x8000;
    return this.table.commands[i] ?? { name: 'NON', send: [end], recv: [end], flag: 0 };
  }

  /** @returns {Promise<number>} status; reply data is written to dataOut */
  async execute(cmdIndex, arg1, arg2, dataIn, dataOut) {
    const cmd = this.command(cmdIndex);
    const packet = this.table.mode === 1 ? this.#build1(cmd, arg1, arg2, dataIn) : this.#build2(cmd, arg1, arg2, dataIn);
    this.link.purge();
    const count = this.table.mode === 1 ? packet.length : Math.min(packet.length, packet.length > 1 ? packet[1] : packet.length);
    this.trace?.(`TX ${hex(packet.subarray(0, count))}`);
    if (!(await this.link.write(packet.subarray(0, count)))) return Status.LINK;
    const reply = await this.#receive();
    if (!reply) return Status.LINK;
    return this.table.mode === 1 ? this.#parse1(cmd, reply, dataOut) : this.#parse2(cmd, reply, dataOut);
  }

  #build1(cmd, a1, a2, data) {
    const o = []; let di = 0;
    for (const tok of cmd.send) {
      if (tok === 0xff) break;
      if (tok < LITERAL) o.push(tok);
      else if (tok === ARG1) o.push(a1);
      else if (tok === ARG2) o.push(a2);
      else if ((tok & DATA) === DATA) {
        const n = tok & ~DATA; // nibbles: each data byte goes out as hi,lo; an odd tail goes raw
        for (let i = 0; i < n; i += 2, di++) {
          const b = data[di] ?? 0;
          if (i + 1 === n) o.push(b); else o.push(b >> 4, b & 0xf);
        }
      }
    }
    o.push(0xff);
    return Uint8Array.from(o);
  }

  #build2(cmd, a1, a2, data) {
    const o = []; let di = 0;
    for (const tok of cmd.send) {
      if (tok === 0x8000) break;
      if (tok < LITERAL) o.push(tok);
      else if (tok === ARG1) o.push(a1);
      else if (tok === ARG2) o.push(a2);
      else if ((tok & DATA) === DATA) { const n = tok & ~DATA; for (let i = 0; i < n; i++, di++) o.push(data[di] ?? 0); }
    }
    o.push(o.reduce((s, b) => s + b, 0) & 0xff);
    return Uint8Array.from(o);
  }

  async #receive() {
    const buf = new Uint8Array(256);
    let last = 0xff;
    for (let i = 0; i < 256; i++) {
      const b = await this.link.read(this.link.timeoutMs);
      if (b === null) { this.trace?.(`RX timeout after ${hex(buf.subarray(0, i))}`); return null; }
      buf[i] = b;
      if (i === 1) last = buf[1] - 1;
      if (this.table.mode === 1 ? b === 0xff : i === last) { this.trace?.(`RX ${hex(buf.subarray(0, i + 1))}`); return buf; }
    }
    return null;
  }

  #parse1(cmd, r, out) {
    let pos = 0, oi = 0;
    for (const tok of cmd.recv) {
      if (tok === 0xff) return r[pos] === 0xff ? Status.OK : Status.BAD_REPLY;
      if (tok < LITERAL) { if (r[pos] !== tok) return Status.BAD_REPLY; pos++; }
      if ((tok & DATA) === DATA) {
        const n = tok & ~DATA;
        for (let i = 0; i < n; i += 2) {
          if (i + 1 === n) { if (oi < out.length) out[oi] = r[pos]; } // odd tail: not advanced, as original
          else { if (oi < out.length) out[oi] = (r[pos] * 16 + (r[pos + 1] & 0xf)) & 0xff; pos += 2; oi++; }
        }
      }
    }
    return Status.BAD_REPLY;
  }

  #parse2(cmd, r, out) {
    if (r[0] === 0x60) return r[2] + Status.NAK_BASE;
    let pos = 0, oi = 0, sum = 0;
    for (let t = 0; ; t++) {
      if (t > 0xf) return Status.BAD_REPLY;
      const tok = cmd.recv[t];
      if (tok === 0x8000) break;
      if (tok < LITERAL) { if (r[pos] !== tok) return Status.BAD_REPLY; sum += r[pos]; pos++; }
      if ((tok & DATA) === DATA) {
        const n = tok & ~DATA;
        for (let i = 0; i < n; i++, oi++, pos++) { if (oi < out.length) out[oi] = r[pos]; sum += r[pos]; }
      }
    }
    return r[pos] === (sum & 0xff) ? Status.OK : Status.BAD_REPLY;
  }
}
