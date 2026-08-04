import { parseArgs, readFileAsBase64, mimeFromPath } from '../util.js';

export default async function planCmd(args, ctx) {
  const opts = parseArgs(args, {
    flags: {
      name: {}, category: {}, points: {}, style: {}, platform: {},
      brand: {}, image: {}, thinking: { bool: true }, mime: {},
    },
  });
  const product_name = opts.name;
  const category = opts.category;
  if (!product_name || !category) {
    return { code: 2, text: '用法: imgcli plan --name 商品名 --category 类目 [--points "卖点1,卖点2"] [--style 风格] [--platform 淘宝] [--brand 品牌色] [--image ./product.jpg] [--thinking]' };
  }
  const payload = {
    product_name,
    category,
    selling_points: opts.points || '',
    style: opts.style || '',
    platform: opts.platform || '',
    brand: opts.brand || '',
    thinking: !!opts.thinking,
  };
  if (opts.image) {
    payload.image_base64 = readFileAsBase64(opts.image);
    payload.image_mime = opts.mime || mimeFromPath(opts.image);
  }
  const r = await ctx.client.planner(payload);
  if (r.code !== 200) throw new Error('策划失败: ' + (r.msg || JSON.stringify(r)));
  const { analysis, reasoning, sections } = r.data;
  let text = `策划生成成功\n`;
  if (analysis) text += `\n[产品图分析]\n${analysis}\n`;
  text += `\n[9 板块提示词]\n`;
  (sections || []).forEach((s, i) => {
    text += `\n${i + 1}. ${s.name}\n   提示词: ${s.prompt || ''}\n   尺寸: ${s.size || ''}  模型: ${s.model || ''}\n`;
    if (s.copy) {
      text += `   文案: ${s.copy.title || ''} / ${s.copy.subtitle || ''}\n`;
      if (Array.isArray(s.copy.points)) text += `   卖点: ${s.copy.points.join('、')}\n`;
    }
  });
  return { code: 0, data: { analysis, reasoning, sections }, text };
}
