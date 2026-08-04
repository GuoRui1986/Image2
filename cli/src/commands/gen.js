import { parseArgs, readFileAsBase64, mimeFromPath, sleep } from '../util.js';

const VALID_METHODS = ['image2_t2i', 'image2_i2i', 'nano_t2i', 'nano_i2i'];
const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 5 * 60 * 1000;

export default async function genCmd(args, ctx) {
  const opts = parseArgs(args, {
    positionals: ['prompt'],
    flags: {
      wait: { bool: true }, ref: {}, engine: {}, mode: {}, size: {},
      quality: {}, 'max-cost': {}, count: {},
    },
  });
  const prompt = (opts.prompt || '').trim();
  if (!prompt) {
    return { code: 2, text: '用法: imgcli gen "提示词" --engine image2|nano --mode t2i|i2i --size 1024x1024 --quality --ref ./x.jpg --wait --max-cost 40' };
  }
  const engine = opts.engine || 'image2';
  const mode = opts.mode || 't2i';
  const method = `${engine}_${mode}`;
  if (!VALID_METHODS.includes(method)) {
    throw new Error('非法 engine/mode 组合: ' + method + '（应为 image2|nano + t2i|i2i）');
  }

  // 护栏：若设 --max-cost，先查余额，余额不足则拦截（避免透支）
  if (opts['max-cost']) {
    try {
      const me = await ctx.client.me();
      const bal = me?.data?.balance;
      if (typeof bal === 'number' && bal < Number(opts['max-cost'])) {
        return { code: 4, text: `余额 ${bal} 分 < --max-cost ${opts['max-cost']}，已拦截本次生图以防透支` };
      }
    } catch (e) { /* 查余额失败不阻断主流程 */ }
  }

  // 参考图上传（图生图）
  let image_urls = [];
  if (opts.ref) {
    const files = String(opts.ref).split(',').map((s) => s.trim()).filter(Boolean);
    for (const f of files) {
      const b64 = readFileAsBase64(f);
      const mime = mimeFromPath(f);
      const up = await ctx.client.uploadRef(f.split(/[\\/]/).pop(), b64);
      if (up.code !== 200) throw new Error('参考图上传失败: ' + (up.msg || JSON.stringify(up)));
      image_urls.push(up.data.url);
    }
  }

  const payload = { method, prompt, size: opts.size, quality: opts.quality };
  if (image_urls.length) payload.image_urls = image_urls;

  const r = await ctx.client.generate(payload);
  if (r.code !== 200) throw new Error('生图提交失败: ' + (r.msg || JSON.stringify(r)));
  const { task_id, cost } = r.data;

  let text = `已提交生图\n任务ID: ${task_id}\n方式: ${method}\n本次扣分: ${cost} 分`;
  const data = { task_id, method, cost, status: 'pending' };

  if (opts['max-cost'] && typeof cost === 'number' && cost > Number(opts['max-cost'])) {
    text += `\n⚠️ 警告: 本次扣分 ${cost} 已超过 --max-cost ${opts['max-cost']}`;
  }

  if (opts.wait) {
    const deadline = Date.now() + POLL_TIMEOUT;
    let last;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL);
      const sr = await ctx.client.status(task_id);
      const st = sr?.data?.status;
      if (st === 'success' || st === 'fail') { last = sr; break; }
    }
    if (last) {
      data.status = last.data.status;
      data.url = last.data.url;
      if (last.data.status === 'success') text += `\n状态: 成功\n图片URL: ${last.data.url}`;
      else text += `\n状态: 失败`;
    } else {
      text += `\n(轮询超时 ${POLL_TIMEOUT / 1000}s，任务仍在后台，可用 imgcli status ${task_id} --wait 继续)`;
    }
  } else {
    text += `\n(未加 --wait，结果请用: imgcli status ${task_id})`;
  }

  return { code: 0, data, text };
}
