// Loads a model through the file chain: .mdl -> .chs -> .std -> .bus/.ec2, from the user's own WINDAS folder.
import { parseChs, parseEcsTable, parseMdl, parseModelList, parseStd } from './tables.js';

/** `root` is a directory handle (File System Access API) or any object with getBytes(path) -> Promise<Uint8Array>. */
export function folderSource(root) {
  async function dive(path) {
    const parts = path.split('/');
    let dir = root;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    const fh = await dir.getFileHandle(parts.at(-1));
    return new Uint8Array(await (await fh.getFile()).arrayBuffer());
  }
  return { getBytes: dive };
}

export async function loadModelList(src) {
  return parseModelList(await src.getBytes('mdlsel.ins'));
}

export async function loadModel(src, mdlTitle) {
  const mdl = parseMdl(await src.getBytes(`data/${mdlTitle}.mdl`));
  const chs = parseChs(await src.getBytes(`data/${mdl.chassis}`));
  const std = parseStd(await src.getBytes(`data/${chs.std}`));
  const ecsName = std.ecs;
  const mode = ecsName.toLowerCase().endsWith('.bus') ? 1 : 2;
  const table = parseEcsTable(await src.getBytes(`data/${ecsName}`), mode);
  return { title: mdlTitle, mdl, chs, std, table, ecsName };
}
