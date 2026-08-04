import { parseArgs } from '../util.js';

export default async function recordsCmd(args, ctx) {
  const opts = parseArgs(args, { flags: { limit: {} } });
  const limit = Number(opts.limit) || 20;
  const r = await ctx.client.myLogs(limit);
  if (r.code !== 200) throw new Error('查询记录失败: ' + (r.msg || JSON.stringify(r)));
  const rows = r.data || [];
  let text = `我的记录（最近 ${rows.length} 条）\n`;
  rows.forEach((row, i) => {
    text += `\n${i + 1}. [${row.type}] ${row.title || ''}\n   ${row.time || ''}  扣分: ${row.cost ?? '-'}\n`;
    if (row.url) text += `   ${row.url}\n`;
  });
  return { code: 0, data: { records: rows }, text };
}
