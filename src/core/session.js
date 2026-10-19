// Monitor session scripts. WinDAS runs a chassis-defined list of register writes when connecting (e.g. "Enter Factory")
// and when leaving ("Exit Factory"), so the monitor's OSD is not left locked. Port of windas.exe FUN_0043dab2 / FUN_0043ded7.
import { Status } from './executor.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a script of {id, value} steps.
 * A pseudo-register named "Timer" waits value*100 ms. A value below -900 encodes -(900 + 10*n + next): write this step and,
 * if the monitor rejects it, run the following n steps as recovery and try again; afterwards continue at step `next`.
 * @returns {Promise<{ok:boolean, message:string}>}
 */
export async function runScript(bus, steps, wait = sleep) {
  const t = bus.t;
  const name = (id) => t.registers[t.abs(id)]?.name.trim() ?? '';
  const step = async (s) => (name(s.id) === 'Timer' ? (await wait(s.value * 100), Status.OK) : bus.write(s.id, s.value));
  for (let i = 0; i < steps.length;) {
    const s = steps[i];
    if (name(s.id) === 'Timer') await wait(s.value * 100);
    if (s.value < -900) {
      const n = Math.trunc((s.value + 900) / -10), next = -(s.value + 900 + n * 10);
      let st = await bus.write(s.id, s.value);
      if (st === Status.BAD_REPLY) {
        for (let k = 1; k <= n && i + k < steps.length; k++) await step(steps[i + k]);
        st = await bus.write(s.id, s.value);
        if (st === Status.BAD_REPLY) return { ok: false, message: 'The monitor did not accept the factory-mode command (ECS syntax error).' };
      }
      if (st === Status.LINK) return { ok: false, message: "Can't connect to the monitor — check the cable, the port, and that the monitor is on." };
      i = next;
    } else {
      const st = await bus.write(s.id, s.value);
      if (st === Status.BAD_REPLY) return { ok: false, message: 'The monitor rejected a startup command (ECS syntax error).' };
      if (st === Status.LINK) return { ok: false, message: "Can't connect to the monitor — check the cable, the port, and that the monitor is on." };
      i++;
    }
  }
  return { ok: true, message: 'OK' };
}
