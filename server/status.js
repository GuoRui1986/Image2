// 状态轮询（前端每 3-5 秒调一次）
// - running：返回 running
// - success：更新 generation_logs(status='success', result_image) → 返回 URL（已预扣不再扣）
// - fail：更新 status='fail' → 非管理员返还积分 → 返回 fail
// 终态幂等：已是 success/fail 直接返回，不重复处理。
import { supabase } from './db.js';
import { query } from './domi.js';
import { deleteRef } from './storage.js';

async function cleanupRefs(refPaths) {
  if (Array.isArray(refPaths)) {
    for (const p of refPaths) {
      try { await deleteRef(p); } catch (e) { console.error('[cleanup] 删除参考图失败', e.message); }
    }
  }
}

export async function statusQuery(req, res) {
  const u = req.user;
  const { task_id } = req.body || {};
  if (!task_id) return res.status(400).json({ code: 400, msg: 'task_id 缺失' });

  const { data: log, error } = await supabase
    .from('generation_logs')
    .select('*')
    .eq('task_id', task_id)
    .single();
  if (error || !log) return res.status(404).json({ code: 404, msg: '任务不存在' });

  // 终态直接返回（幂等）
  if (log.status === 'success') {
    return res.json({ code: 200, data: { status: 'success', url: log.result_image, cost: log.cost } });
  }
  if (log.status === 'fail') {
    return res.json({ code: 200, data: { status: 'fail', cost: log.cost } });
  }

  let q;
  try {
    q = await query(log.method, task_id);
  } catch (e) {
    return res.status(502).json({ code: 502, msg: '查询失败：' + e.message });
  }

  if (q.status === 'running') {
    return res.json({ code: 200, data: { status: 'running' } });
  }

  if (q.status === 'success') {
    const { error: upErr } = await supabase
      .from('generation_logs')
      .update({ status: 'success', result_image: q.imageUrl })
      .eq('task_id', task_id);
    if (upErr) console.error('[status] 更新成功记录失败', upErr.message);
    await cleanupRefs(log.params?.ref_paths);
    return res.json({ code: 200, data: { status: 'success', url: q.imageUrl, cost: log.cost } });
  }

  // fail
  const { error: upErr2 } = await supabase
    .from('generation_logs')
    .update({ status: 'fail' })
    .eq('task_id', task_id);
  if (upErr2) console.error('[status] 更新失败记录失败', upErr2.message);
  if (log.cost > 0) {
    try { await supabase.rpc('refund_points', { p_user: u.id, p_amount: log.cost }); }
    catch (_) { /* 返还失败仅记日志 */ }
  }
  await cleanupRefs(log.params?.ref_paths);
  return res.json({ code: 200, data: { status: 'fail', cost: log.cost } });
}
