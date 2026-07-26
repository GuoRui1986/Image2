// 管理端接口（均需 authRequired + adminRequired）
// 用户：列表 / 新增 / 修改(冻结·解冻·重置密码·调积分) / 软删除
// 计费：列表 / 修改
// 日志：生图记录 / 操作日志
import bcrypt from 'bcryptjs';
import { supabase } from './db.js';

async function logOp(adminId, action, targetType, targetId, detail) {
  await supabase.from('operation_logs').insert({
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: String(targetId ?? ''),
    detail,
  });
}

export async function listUsers(req, res) {
  const { data, error } = await supabase
    .from('users')
    .select('id, phone, balance, role, status, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ code: 500, msg: error.message });
  return res.json({ code: 200, data });
}

export async function createUser(req, res) {
  const { phone, password, balance } = req.body || {};
  if (!phone || !password) {
    return res.status(400).json({ code: 400, msg: '手机号与密码必填' });
  }
  const hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({ phone, password_hash: hash, balance: Number(balance) || 0, role: 'user' })
    .select('id, phone, balance')
    .single();
  if (error) return res.status(400).json({ code: 400, msg: '创建失败：' + error.message });
  await logOp(req.user.id, 'create_user', 'user', data.id, `创建用户 ${phone}`);
  return res.json({ code: 200, data });
}

export async function updateUser(req, res) {
  const id = req.params.id;
  const { action, password, delta } = req.body || {};
  const { data: target, error: te } = await supabase
    .from('users')
    .select('id, role, balance, phone')
    .eq('id', id)
    .single();
  if (te || !target) return res.status(404).json({ code: 404, msg: '用户不存在' });
  if (target.role === 'admin') {
    return res.status(403).json({ code: 403, msg: '不能修改管理员账号' });
  }

  if (action === 'freeze') {
    await supabase.from('users').update({ status: 'frozen' }).eq('id', id);
    await logOp(req.user.id, 'freeze', 'user', id, `冻结用户 ${target.phone}`);
    return res.json({ code: 200, data: { ok: true } });
  }
  if (action === 'unfreeze') {
    await supabase.from('users').update({ status: 'active' }).eq('id', id);
    await logOp(req.user.id, 'unfreeze', 'user', id, `解冻用户 ${target.phone}`);
    return res.json({ code: 200, data: { ok: true } });
  }
  if (action === 'reset_pwd') {
    if (!password) return res.status(400).json({ code: 400, msg: '新密码必填' });
    const hash = await bcrypt.hash(password, 10);
    await supabase.from('users').update({ password_hash: hash }).eq('id', id);
    await logOp(req.user.id, 'reset_pwd', 'user', id, `重置密码 ${target.phone}`);
    return res.json({ code: 200, data: { ok: true } });
  }
  if (action === 'adjust_credit') {
    const d = Number(delta);
    if (!Number.isFinite(d)) return res.status(400).json({ code: 400, msg: 'delta 非法' });
    const newBal = target.balance + d;
    if (newBal < 0) return res.status(400).json({ code: 400, msg: '余额不能为负' });
    await supabase.from('users').update({ balance: newBal }).eq('id', id);
    await logOp(req.user.id, 'adjust_credit', 'user', id, `调整积分 ${target.phone} ${d >= 0 ? '+' : ''}${d} → ${newBal}`);
    return res.json({ code: 200, data: { balance: newBal } });
  }
  return res.status(400).json({ code: 400, msg: '未知 action' });
}

export async function deleteUser(req, res) {
  const id = req.params.id;
  const { data: target, error: te } = await supabase
    .from('users')
    .select('id, role, phone')
    .eq('id', id)
    .single();
  if (te || !target) return res.status(404).json({ code: 404, msg: '用户不存在' });
  if (target.role === 'admin') return res.status(403).json({ code: 403, msg: '不能删除管理员' });
  await supabase.from('users').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  await logOp(req.user.id, 'delete_user', 'user', id, `软删除用户 ${target.phone}`);
  return res.json({ code: 200, data: { ok: true } });
}

export async function listPricing(req, res) {
  const { data, error } = await supabase
    .from('pricing_rules')
    .select('type, cost')
    .order('type');
  if (error) return res.status(500).json({ code: 500, msg: error.message });
  return res.json({ code: 200, data });
}

export async function updatePricing(req, res) {
  const type = req.params.type;
  const { cost } = req.body || {};
  const c = Number(cost);
  if (!Number.isFinite(c) || c < 0) return res.status(400).json({ code: 400, msg: 'cost 非法' });
  const { error } = await supabase.from('pricing_rules').update({ cost: c }).eq('type', type);
  if (error) return res.status(400).json({ code: 400, msg: error.message });
  await logOp(req.user.id, 'update_pricing', 'pricing', type, `计费 ${type} → ${c}`);
  return res.json({ code: 200, data: { ok: true } });
}

export async function listGenLogs(req, res) {
  const { data, error } = await supabase
    .from('generation_logs')
    .select('id, task_id, user_id, method, prompt, cost, status, created_at, result_image')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return res.status(500).json({ code: 500, msg: error.message });
  return res.json({ code: 200, data });
}

export async function listOpLogs(req, res) {
  const { data, error } = await supabase
    .from('operation_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return res.status(500).json({ code: 500, msg: error.message });
  return res.json({ code: 200, data });
}
