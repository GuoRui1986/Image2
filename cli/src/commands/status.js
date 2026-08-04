import { parseArgs, sleep } from '../util.js';

const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 5 * 60 * 1000;

function fmt(data) {
  return `任务 ${data?.task_id || ''}\n状态: ${data?.status}` +
    (data?.url ? `\n图片URL: ${data.url}` : '') +
    (data?.cost != null ? `\n扣分: ${data.cost}` : '');
}

export default async function statusCmd(args, ctx) {
  const opts = parseArgs(args, { positionals: ['task_id'], flags: { wait: { bool: true } } });
  const task_id = opts.task_id;
  if (!task_id) {
    return { code: 2, text: '用法: imgcli status <task_id> [--wait]' };
  }
  let data;
  if (opts.wait) {
    const deadline = Date.now() + POLL_TIMEOUT;
    let last;
    while (Date.now() < deadline) {
      const r = await ctx.client.status(task_id);
      const st = r?.data?.status;
      if (st === 'success' || st === 'fail') { last = r; break; }
      await sleep(POLL_INTERVAL);
    }
    if (!last) last = await ctx.client.status(task_id);
    data = { ...(last?.data || {}), task_id };
  } else {
    const r = await ctx.client.status(task_id);
    data = { ...(r?.data || {}), task_id };
  }
  return { code: 0, data, text: fmt(data) };
}
