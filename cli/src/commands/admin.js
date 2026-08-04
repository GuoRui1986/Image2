import { parseArgs } from '../util.js';

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

// 统一校验后端返回
function ok(r) {
  if (r.code !== 200) throw new Error('请求失败: ' + (r.msg || JSON.stringify(r)));
  return r.data;
}

// 危险写操作护栏：必须显式 --yes
function requireYes(opts) {
  if (!opts.yes) {
    throw new Error('危险写操作需二次确认：请在命令末尾追加 --yes 后再执行（可在 --help 查看示例）');
  }
}

const ADMIN_HELP = `admin - 管理端命令（需 admin 角色，后端强制校验）

用法:
  imgcli admin <子命令> [选项]

子命令（查询类）:
  users               用户列表
  credits             积分台账（含本月消耗）
  pricing             计费规则
  logs-gen [筛选]     生图/策划日志（--user_id --method --status --days --type planner）
  logs-op             操作日志
  dashboard           运营看板（近7日趋势）
  stats               统计报表（引擎分布 + 消耗排行）
  config-get          读取配置（策划器开关）

子命令（写类，必须 --yes）:
  user-add --phone <手机号> --password <密码> [--balance 1000] [--role user|admin] --yes
  user-update --id <用户id> --action <freeze|unfreeze|reset_pwd|adjust_credit> [--password <新密码>] [--delta ±N] [--remark 备注] --yes
  user-del --id <用户id> --yes
  pricing-set --type <规则类型> --cost <数字> --yes
  config-set --value true|false --yes   设置策划器开关

说明:
  user-del 为软删除（隐藏账号但保留数据），且不可删除管理员。
  user-update adjust_credit 的 --delta 可正可负（如 --delta -100）。
`;

export default async function adminCmd(args, ctx) {
  const sub = args[0];
  const rest = args.slice(1);
  if (!sub || sub === '--help' || sub === '-h') {
    return { code: 0, data: {}, text: ADMIN_HELP };
  }
  switch (sub) {
    case 'users': return adminUsers(rest, ctx);
    case 'user-add': return adminUserAdd(rest, ctx);
    case 'user-update': return adminUserUpdate(rest, ctx);
    case 'user-del': return adminUserDel(rest, ctx);
    case 'pricing': return adminPricing(rest, ctx);
    case 'pricing-set': return adminPricingSet(rest, ctx);
    case 'credits': return adminCredits(rest, ctx);
    case 'logs-gen': return adminLogsGen(rest, ctx);
    case 'logs-op': return adminLogsOp(rest, ctx);
    case 'dashboard': return adminDashboard(rest, ctx);
    case 'stats': return adminStats(rest, ctx);
    case 'config-get': return adminConfigGet(rest, ctx);
    case 'config-set': return adminConfigSet(rest, ctx);
    default:
      throw new Error('未知管理子命令: ' + sub + '\n' + ADMIN_HELP);
  }
}

async function adminUsers(rest, ctx) {
  const data = ok(await ctx.client.adminUsers());
  let text = `用户列表（${data.length} 个）`;
  data.forEach((u, i) => {
    text += `\n${i + 1}. #${u.id} ${u.phone}  角色:${u.role}  状态:${u.status}  余额:${u.balance}\n   创建:${u.created_at || ''}`;
  });
  return { code: 0, data, text };
}

async function adminUserAdd(rest, ctx) {
  const opts = parseArgs(rest, { flags: { yes: { bool: true } } });
  const phone = opts.phone || opts._[0];
  const password = opts.password || opts._[1];
  if (!phone || !password) {
    throw new Error('用法: admin user-add --phone <手机号> --password <密码> [--balance 1000] [--role user|admin] --yes');
  }
  requireYes(opts);
  const payload = { phone, password, balance: Number(opts.balance) || 0, role: opts.role || 'user' };
  const data = ok(await ctx.client.adminCreateUser(payload));
  return { code: 0, data, text: `已创建用户 #${data.id} 手机号:${data.phone} 角色:${payload.role} 初始余额:${data.balance}` };
}

async function adminUserUpdate(rest, ctx) {
  const opts = parseArgs(rest, { flags: { yes: { bool: true } } });
  const id = opts.id || opts._[0];
  const action = opts.action || opts._[1];
  if (!id || !action) {
    throw new Error('用法: admin user-update --id <用户id> --action <freeze|unfreeze|reset_pwd|adjust_credit> [--password <新密码>] [--delta ±N] [--remark 备注] --yes');
  }
  const payload = { action };
  if (action === 'reset_pwd') {
    if (!opts.password) throw new Error('reset_pwd 必须提供 --password <新密码>');
    payload.password = opts.password;
  }
  if (action === 'adjust_credit') {
    if (opts.delta === undefined) throw new Error('adjust_credit 必须提供 --delta（正负整数，如 -100）');
    payload.delta = Number(opts.delta);
    if (Number.isNaN(payload.delta)) throw new Error('delta 非法，需为整数');
    if (opts.remark) payload.remark = opts.remark;
    process.stderr.write(`${RED}⚠️ 即将调整用户 #${id} 积分 delta=${payload.delta}${RESET}\n`);
  }
  requireYes(opts);
  const data = ok(await ctx.client.adminUpdateUser(id, payload));
  let text = `用户 #${id} 操作=${action} 成功`;
  if (action === 'adjust_credit') text += `  → 新余额:${data.balance}`;
  return { code: 0, data, text };
}

async function adminUserDel(rest, ctx) {
  const opts = parseArgs(rest, { flags: { yes: { bool: true } } });
  const id = opts.id || opts._[0];
  if (!id) throw new Error('用法: admin user-del --id <用户id> --yes');
  const list = ok(await ctx.client.adminUsers());
  const target = list.find((u) => String(u.id) === String(id));
  if (!target) throw new Error('用户 #' + id + ' 不存在');
  process.stderr.write(`${RED}⚠️ 危险操作：即将软删除用户 #${id}（手机号 ${target.phone}）。账号将被隐藏，操作不可撤销。${RESET}\n`);
  requireYes(opts);
  ok(await ctx.client.adminDeleteUser(id));
  return { code: 0, data: { id }, text: `已软删除用户 #${id}（手机号 ${target.phone}）` };
}

async function adminPricing(rest, ctx) {
  const data = ok(await ctx.client.adminPricing());
  let text = `计费规则（${data.length} 条）`;
  data.forEach((p, i) => { text += `\n${i + 1}. ${p.type}  = ${p.cost} 分/次`; });
  return { code: 0, data, text };
}

async function adminPricingSet(rest, ctx) {
  const opts = parseArgs(rest, { flags: { yes: { bool: true } } });
  const type = opts.type || opts._[0];
  const cost = opts.cost ?? opts._[1];
  if (!type || cost === undefined) {
    throw new Error('用法: admin pricing-set --type <规则类型> --cost <数字> --yes');
  }
  requireYes(opts);
  ok(await ctx.client.adminUpdatePricing(type, Number(cost)));
  return { code: 0, data: { type, cost }, text: `已更新计费 ${type} = ${cost} 分` };
}

async function adminCredits(rest, ctx) {
  const data = ok(await ctx.client.adminCredits());
  let text = `积分台账（${data.length} 个用户）`;
  data.forEach((u, i) => {
    text += `\n${i + 1}. #${u.id} ${u.phone}  角色:${u.role}  余额:${u.balance}  本月消耗:${u.month_cost}`;
  });
  return { code: 0, data, text };
}

async function adminLogsGen(rest, ctx) {
  const opts = parseArgs(rest, {});
  const qs = { user_id: opts.user_id, method: opts.method, status: opts.status, days: opts.days, type: opts.type };
  const data = ok(await ctx.client.adminLogsGen(qs));
  let text = `生图/策划日志（${data.length} 条）`;
  data.slice(0, 50).forEach((r, i) => {
    text += `\n${i + 1}. [${r.rec_type}] ${r.phone || r.user_id}  ${r.method || r.style || ''}  ${r.status || ''}  花费:${r.cost ?? '-'}  ${r.created_at || ''}`;
    if (r.product_name) text += `  产品:${r.product_name}`;
    if (r.prompt) text += `\n   ${(r.prompt || '').slice(0, 60)}`;
  });
  if (data.length > 50) text += `\n...仅显示前 50 条（共 ${data.length}）`;
  return { code: 0, data, text };
}

async function adminLogsOp(rest, ctx) {
  const data = ok(await ctx.client.adminLogsOp());
  let text = `操作日志（${data.length} 条）`;
  data.slice(0, 50).forEach((o, i) => {
    text += `\n${i + 1}. ${o.created_at || ''}  ${o.admin_phone || o.admin_id}  ${o.action}  ${o.target_type}:${o.target_id}${o.target_phone ? '(' + o.target_phone + ')' : ''}  ${o.detail || ''}`;
  });
  if (data.length > 50) text += `\n...仅显示前 50 条（共 ${data.length}）`;
  return { code: 0, data, text };
}

async function adminDashboard(rest, ctx) {
  const d = ok(await ctx.client.adminDashboard());
  let text = `运营看板\n`;
  text += `总消耗: ${d.total_cost} 分   总次数: ${d.total_count}\n`;
  text += `策划次数: ${d.planner_count}   活跃用户: ${d.active_users}/${d.total_users}\n`;
  text += `本月失败率: ${d.month_fail_rate}%\n`;
  text += `近 7 日趋势:\n`;
  d.trend.forEach((t) => { text += `  ${t.label}  生图:${t.total}(image2:${t.image2}/nano:${t.nano})  策划:${t.planner}\n`; });
  return { code: 0, data: d, text };
}

async function adminStats(rest, ctx) {
  const d = ok(await ctx.client.adminStats());
  let text = `统计报表\n`;
  text += `总消耗:${d.total_cost}  总次数:${d.total_count}  成功:${d.success}  失败:${d.fail}  单次均耗:${d.avg_cost}\n`;
  text += `各引擎:\n`;
  d.methods.forEach((m) => { text += `  ${m.method}  次数:${m.count}  消耗:${m.cost}\n`; });
  text += `消耗排行榜(前10):\n`;
  (d.ranking || []).slice(0, 10).forEach((r, i) => { text += `  ${i + 1}. ${r.phone}  ${r.cost} 分\n`; });
  text += `策划: 次数:${d.planner.count} 成功:${d.planner.success} 消耗:${d.planner.cost}\n`;
  return { code: 0, data: d, text };
}

async function adminConfigGet(rest, ctx) {
  const d = ok(await ctx.client.adminConfigGet());
  return { code: 0, data: d, text: `策划器功能(planner_enabled): ${d.planner_enabled ? '已启用' : '已停用'}` };
}

async function adminConfigSet(rest, ctx) {
  const opts = parseArgs(rest, { flags: { yes: { bool: true } } });
  const val = opts.value ?? opts._[0];
  if (val === undefined) throw new Error('用法: admin config-set --value true|false --yes');
  const bool = val === true || val === 'true' || val === '1';
  requireYes(opts);
  const d = ok(await ctx.client.adminConfigSet(bool));
  return { code: 0, data: d, text: `策划器功能已${d.planner_enabled ? '启用' : '停用'}` };
}
