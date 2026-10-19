// Byte links to the monitor. Same shape for hardware and simulator:
//   write(bytes) -> Promise<bool>, read(timeoutMs) -> Promise<byte|null>, purge(), close(), timeoutMs

/** Web Serial (Chromium: Edge/Chrome). 9600 8N1 exactly as windas.exe configures the port. */
export class SerialLink {
  static async request() {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
    return new SerialLink(port);
  }

  constructor(port) {
    this.port = port; this.timeoutMs = 3000;
    this.queue = []; this.waiters = [];
    this.closed = false;
    this.writer = port.writable.getWriter();
    this.#pump();
  }

  async #pump() {
    const reader = this.port.readable.getReader();
    this.reader = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const b of value) { const w = this.waiters.shift(); if (w) w(b); else this.queue.push(b); }
      }
    } catch { /* port closed or unplugged */ }
    finally { reader.releaseLock(); }
  }

  async write(bytes) {
    try { await this.writer.write(bytes); return true; } catch { return false; }
  }

  read(timeoutMs) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve) => {
      const w = (b) => { clearTimeout(t); resolve(b); };
      const t = setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1); resolve(null); }, timeoutMs);
      this.waiters.push(w);
    });
  }

  purge() { this.queue.length = 0; }

  async close() {
    this.closed = true;
    try { this.writer.releaseLock(); await this.reader?.cancel(); await this.port.close(); } catch { /* already closed */ }
  }
}

/**
 * A fake monitor. It recognises packets by matching the command table's send templates and answers with the
 * reply templates. It exercises the host code without hardware; it does not model any real monitor.
 */
export class SimLink {
  constructor(table) {
    this.t = table; this.timeoutMs = 3000;
    this.rx = []; this.tx = []; this.mem = new Map(); this.log = [];
  }

  static family(name) { return name.replace(/_?(write|wrt|wr|read|red|rd)/gi, '').replace(/\s+/g, ''); }

  memory(fam, a1, a2) {
    const k = `${fam}|${a1}|${a2}`;
    if (!this.mem.has(k)) this.mem.set(k, new Uint8Array(256));
    return this.mem.get(k);
  }

  async write(bytes) {
    for (const b of bytes) {
      this.rx.push(b);
      if (this.t.mode === 1 ? b === 0xff : this.rx.length > 1 && this.rx.length === this.rx[1]) { this.#handle(); this.rx = []; }
    }
    return true;
  }

  read() { return Promise.resolve(this.tx.length ? this.tx.shift() : null); }
  purge() { this.rx = []; this.tx = []; }
  async close() {}

  #handle() {
    const pkt = this.rx;
    for (let c = 1; c < this.t.commands.length; c++) {
      const cmd = this.t.commands[c];
      const m = this.#match(cmd, pkt);
      if (!m) continue;
      const fam = SimLink.family(cmd.name);
      const mem = this.memory(fam, m.a1, m.a2);
      if (m.write) mem.set(m.data.slice(0, 256));
      this.#reply(cmd, mem);
      return;
    }
    if (this.t.mode === 2) this.tx.push(0x60, 4, 1, (0x60 + 4 + 1) & 0xff);
  }

  #match(cmd, pkt) {
    const term = this.t.mode === 1 ? 0xff : 0x8000;
    let p = 0, a1 = 0, a2 = 0, write = false; const data = [];
    for (const tok of cmd.send) {
      if (tok === term) break;
      if (p >= pkt.length) return null;
      if (tok < 0x100) { if (pkt[p++] !== tok) return null; }
      else if (tok === 0x1000) a1 = pkt[p++];
      else if (tok === 0x4000) a2 = pkt[p++];
      else if ((tok & 0x2000) === 0x2000) {
        write = true;
        const n = tok & ~0x2000;
        if (this.t.mode === 1) for (let i = 0; i + 1 < n; i += 2, p += 2) data.push(((pkt[p] << 4) | (pkt[p + 1] & 0xf)) & 0xff);
        else for (let i = 0; i < n; i++) data.push(pkt[p++]);
      }
    }
    return pkt.length === p + 1 ? { a1, a2, write, data } : null;
  }

  #reply(cmd, mem) {
    const term = this.t.mode === 1 ? 0xff : 0x8000;
    const o = []; let di = 0;
    for (const tok of cmd.recv) {
      if (tok === term) break;
      if (tok < 0x100) o.push(tok);
      else if ((tok & 0x2000) === 0x2000) {
        const n = tok & ~0x2000;
        if (this.t.mode === 1) for (let i = 0; i + 1 < n; i += 2, di++) o.push(mem[di] >> 4, mem[di] & 0xf);
        else for (let i = 0; i < n; i++, di++) o.push(mem[di]);
      }
    }
    o.push(this.t.mode === 1 ? 0xff : o.reduce((s, b) => s + b, 0) & 0xff);
    this.tx.push(...o);
  }
}
