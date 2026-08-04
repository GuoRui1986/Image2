import { readFileSync } from 'node:fs';

// 解析全局参数（--json / --base-url / --help）
export function parseGlobal(argv) {
  const global = { json: false, baseUrl: '', help: false };
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') global.json = true;
    else if (a === '--base-url') global.baseUrl = argv[++i];
    else if (a === '--help' || a === '-h') global.help = true;
    else args.push(a);
  }
  return { args, global };
}

// 解析命令级参数：支持 --key value / --key=value / 布尔 --flag / 位置参数
export function parseArgs(argv, spec = {}) {
  const out = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let key, val;
      if (eq >= 0) {
        key = a.slice(2, eq);
        val = a.slice(eq + 1);
      } else {
        key = a.slice(2);
        if (spec.flags && spec.flags[key] && spec.flags[key].bool) {
          val = true;
        } else {
          val = argv[++i];
        }
      }
      out[key] = val;
    } else {
      positionals.push(a);
    }
  }
  if (spec.positionals) {
    spec.positionals.forEach((p, idx) => { out[p] = positionals[idx]; });
  }
  out._ = positionals;
  return out;
}

export function readFileAsBase64(path) {
  return readFileSync(path).toString('base64');
}

export function mimeFromPath(path) {
  const ext = (path.split('.').pop() || 'png').toLowerCase();
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif',
  };
  return map[ext] || 'image/png';
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
