// Impersonates a PGenerator (the Raspberry Pi pattern generator HCFR can drive) so HCFR sends its patch requests to us.
// Discovery: HCFR broadcasts UDP "Who is a PGenerator" to port 1977; any reply identifies the host.
// Control: HCFR then opens a TCP connection to port 85 and exchanges short text messages (see pgen-protocol.js).
// Opt-in and local only: datagrams and connections from other machines are ignored.
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PGenProtocol } from './pgen-protocol.js';

const localAddrs = () => new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', ...Object.values(os.networkInterfaces()).flat().flatMap((i) => [i.address, `::ffff:${i.address}`])]);

export class PGenEmulator extends EventEmitter {
  constructor({ udpPort = 1977, tcpPort = 85, protocol = {} } = {}) {
    super();
    this.udpPort = udpPort; this.tcpPort = tcpPort; this.protocolOpts = protocol;
    this.udp = null; this.tcp = null; this.clients = new Set();
    this.state = { running: false, clients: 0, last: null };
  }

  status() { return { ...this.state, clients: this.clients.size }; }

  async start() {
    if (this.state.running) return;
    try { await Promise.all([this.#startUdp(), this.#startTcp()]); }
    catch (e) { this.stop(); throw e; }
    this.state.running = true;
    this.emit('state', this.status());
  }

  stop() {
    this.udp?.close(); this.tcp?.close();
    for (const s of this.clients) s.destroy();
    this.udp = this.tcp = null; this.clients.clear();
    this.state = { running: false, clients: 0, last: null };
    this.emit('state', this.status());
  }

  /** Update the display size reported to HCFR (it scales patch sizes from this). */
  setDisplay(width, height) { this.protocolOpts = { ...this.protocolOpts, width, height }; }

  #startUdp() {
    return new Promise((resolve, reject) => {
      const u = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      u.on('error', reject);
      u.on('message', (msg, rinfo) => {
        if (!localAddrs().has(rinfo.address)) return;
        if (msg.toString('latin1').startsWith('Who is a PGenerator')) u.send(Buffer.from('This is a PGenerator'), rinfo.port, rinfo.address);
      });
      u.bind(this.udpPort, '0.0.0.0', () => { this.udp = u; resolve(); });
    });
  }

  #startTcp() {
    return new Promise((resolve, reject) => {
      const t = net.createServer((sock) => {
        if (!localAddrs().has(sock.remoteAddress)) { sock.destroy(); return; }
        const proto = new PGenProtocol(this.protocolOpts);
        this.clients.add(sock); this.emit('state', this.status());
        sock.on('data', (buf) => {
          const { reply, events } = proto.feed(buf.toString('latin1'));
          for (const e of events) { this.state.last = e; this.emit('event', e); }
          if (reply) sock.write(reply, 'latin1');
        });
        const gone = () => { if (this.clients.delete(sock)) this.emit('state', this.status()); };
        sock.on('close', gone); sock.on('error', gone);
      });
      t.on('error', reject);
      t.listen(this.tcpPort, '0.0.0.0', () => { this.tcp = t; resolve(); });
    });
  }
}
