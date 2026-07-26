// 生图提交流程（预扣返还模式）
// 1) 校验 JWT + 合法性
// 2) 计费：管理员跳过；普通用户查 pricing_rules → 原子预扣 deduct_points（余额不足即失败，防超额）
// 3) 调多米 submit 拿 task_id；submit 失败则返还并 502
// 4) 写 generation_logs(status='pending')，task_id 唯一约束天然防重
// 5) 返回 task_id，前端拿去轮询 /api/status
import { supabase } from './db.js';
import { submit } from './domi.js';

const VALID = ['image2_t2i', 'image2_i2i', 'nano_t2i', 'nano_i2i'];

export async function generate(req, res) {
  const u = req.user;
  const b = req.body || {};
  const {
    method, prompt, image_urls, size, quality,
    aspect_ratio, image_size, oversea, model, ref_paths,
  } = b;

  if (!VALID.includes(method)) {
    return res.status(400).json({ code: 400, msg: '未知生图方式' });
  }
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ code: 400, msg: 'prompt 不能为空' });
  }

  // —— 计费（管理员不计费）——
  let cost = 0;
  if (u.role !== 'admin') {
    const { data: rule, error } = await supabase
      .from('pricing_rules')
      .select('cost')
      .eq('type', method)
      .single();
    if (error || !rule) {
      return res.status(500).json({ code: 500, msg: '计费规则缺失：' + (error?.message || method) });
    }
    cost = rule.cost;
    try {
      await supabase.rpc('deduct_points', { p_user: u.id, p_amount: cost });
    } catch (e) {
      return res.status(400).json({ code: 400, msg: '积分不足' });
    }
  }

  // —— 组装多米 payload ——
  const payload = {
    prompt: prompt.trim(),
    size, quality,
    aspect_ratio, image_size,
    oversea: !!oversea, model,
    image_urls,
  };

  let task_id;
  try {
    const r = await submit(method, payload);
    task_id = r.task_id;
  } catch (e) {
    if (cost > 0) {
      try { await supabase.rpc('refund_points', { p_user: u.id, p_amount: cost }); }
      catch (_) { /* 返还失败仅记日志 */ }
    }
    return res.status(502).json({ code: 502, msg: '提交生图失败：' + e.message });
  }

  // —— 写草稿记录（task_id 唯一约束防重）——
  const { error: insErr } = await supabase
    .from('generation_logs')
    .insert({
      task_id,
      user_id: u.id,
      method,
      prompt: prompt.trim(),
      ref_images: image_urls || null,
      cost,
      status: 'pending',
      oversea: !!oversea,
      params: {
        size: size || null,
        quality: quality || null,
        aspect_ratio: aspect_ratio || null,
        image_size: image_size || null,
        model: model || null,
        ref_paths: ref_paths || null,
      },
    });
  if (insErr) console.error('[generate] 插入记录失败', insErr.message);

  return res.json({ code: 200, data: { task_id, cost } });
}
