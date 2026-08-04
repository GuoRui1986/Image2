import { saveAuth } from '../auth.js';
import { parseArgs } from '../util.js';

export default async function loginCmd(args, ctx) {
  const opts = parseArgs(args, { positionals: ['phone', 'password'] });
  const phone = opts.phone;
  const password = opts.password;
  if (!phone || !password) {
    return { code: 2, text: '用法: imgcli login <手机号> <密码>\n（首次使用请加 --base-url https://你的平台地址，或先设置环境变量 IMGCLI_BASE_URL）' };
  }
  if (!ctx.client.baseUrl) {
    return { code: 3, text: '未配置 API 地址。请设置环境变量 IMGCLI_BASE_URL，或用 imgcli --base-url https://你的地址 login ...' };
  }
  const r = await ctx.client.login(phone, password);
  if (r.code !== 200) {
    throw new Error('登录失败: ' + (r.msg || JSON.stringify(r)));
  }
  const { token, role, balance, phone: respPhone } = r.data;
  ctx.client.setToken(token);
  saveAuth({ baseUrl: ctx.client.baseUrl, token, phone: respPhone || phone });
  return {
    code: 0,
    data: { token, role, balance, phone: respPhone || phone },
    text: `登录成功\n手机号: ${respPhone || phone}\n角色: ${role}\n余额: ${balance} 分\nToken 已保存到本地 ~/.imgcli/config.json`,
  };
}
