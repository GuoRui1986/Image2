export default async function creditsCmd(args, ctx) {
  const r = await ctx.client.me();
  if (r.code !== 200) throw new Error('查询失败: ' + (r.msg || JSON.stringify(r)));
  const { balance, phone, role } = r.data;
  return {
    code: 0,
    data: { phone, role, balance },
    text: `手机号: ${phone}\n角色: ${role}\n剩余积分: ${balance} 分`,
  };
}
