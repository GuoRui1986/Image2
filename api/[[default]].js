// IGA Pages Functions 单一入口（把所有后端模块内联，避免跨目录 import 导致部署 outputs 失败）
// 约定：api/[[default]].js 作为 catch-all，export default app，平台接管监听，勿调 app.listen()
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

// ===================== db =====================
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(url || '', serviceKey || '', {
  auth: { autoRefreshToken: false, persistSession: false },
});

function checkDbConfig() {
  if (!url || !serviceKey) {
    console.error('[db] 缺少 SUPABASE_URL / SUPABASE_SERVICE_KEY，请在 IGA 控制台配置环境变量');
    return false;
  }
  return true;
}

// ===================== auth =====================
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const TOKEN_TTL = '7d';

function signToken(user) {
  return jwt.sign(
    { sub: user.id, phone: user.phone, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function extractToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.headers['x-auth-token']) return req.headers['x-auth-token'];
  return null;
}

function authRequired(req, res, next) {
  const token = extractToken(req);
  const payload = token && verifyToken(token);
  if (!payload) {
    return res.status(401).json({ code: 401, msg: '未登录或登录已过期' });
  }
  req.user = { id: payload.sub, phone: payload.phone, role: payload.role };
  next();
}

function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ code: 403, msg: '需要管理员权限' });
  }
  next();
}

async function login(req, res) {
  const { phone, password } = req.body || {};
  if (!phone || !password) {
    return res.status(400).json({ code: 400, msg: '手机号或密码缺失' });
  }
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single();
  if (error || !user) {
    return res.status(401).json({ code: 401, msg: '账号不存在' });
  }
  if (user.status === 'frozen') {
    return res.status(403).json({ code: 403, msg: '账号已冻结' });
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ code: 401, msg: '密码错误' });
  }
  const token = signToken(user);
  return res.json({
    code: 200,
    data: { token, role: user.role, balance: user.balance, phone: user.phone },
  });
}

async function seedAdmin() {
  const phone = process.env.ADMIN_PHONE;
  const pwd = process.env.ADMIN_PASSWORD;
  if (!phone || !pwd) {
    console.log('[seedAdmin] 未配置 ADMIN_PHONE/ADMIN_PASSWORD，跳过');
    return;
  }
  const { data: exist } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  if (exist) {
    console.log('[seedAdmin] 管理员已存在，跳过');
    return;
  }
  const hash = await bcrypt.hash(pwd, 10);
  const { error } = await supabase
    .from('users')
    .insert({ phone, password_hash: hash, role: 'admin', balance: 999999 });
  if (error) {
    console.error('[seedAdmin] 创建失败:', error.message);
  } else {
    console.log('[seedAdmin] 已创建管理员', phone);
  }
}

async function me(req, res) {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, phone, balance, role, status, created_at')
    .eq('id', req.user.id)
    .single();
  if (error || !user) {
    return res.status(404).json({ code: 404, msg: '用户不存在' });
  }
  return res.json({ code: 200, data: user });
}

// ===================== domi =====================
const DOMI_BASE = process.env.DOMI_BASE_URL || 'https://duomiapi.com';
const DOMI_KEY = process.env.DOMI_KEY;

async function postJson(url, body, headers) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function getJson(url, headers) {
  const r = await fetch(url, { headers });
  return r.json();
}

async function domiSubmit(method, p) {
  if (method === 'image2_t2i' || method === 'image2_i2i') {
    const body = { model: 'gpt-image-2', prompt: p.prompt };
    if (p.size) body.size = p.size;
    if (p.quality) body.quality = p.quality;
    if (typeof p.oversea === 'boolean') body.oversea = p.oversea;
    if (method === 'image2_i2i' && p.image_urls?.length) {
      body.image = p.image_urls;
    }
    const data = await postJson(`${DOMI_BASE}/v1/images/generations?async=true`, body, {
      Authorization: DOMI_KEY,
    });
    if (!data || !data.id) {
      throw new Error('gpt submit failed: ' + JSON.stringify(data));
    }
    return { task_id: data.id };
  }

  if (method === 'nano_t2i') {
    const body = {
      prompt: p.prompt,
      model: p.model || 'gemini-3.1-flash-image-preview',
      image_size: p.image_size || '1K',
      aspect_ratio: p.aspect_ratio || 'auto',
    };
    const data = await postJson(`${DOMI_BASE}/api/gemini/nano-banana`, body, {
      Authorization: DOMI_KEY,
    });
    if (data?.code !== 200 || !data.data?.task_id) {
      throw new Error('nano submit failed: ' + JSON.stringify(data));
    }
    return { task_id: data.data.task_id };
  }

  if (method === 'nano_i2i') {
    const body = {
      prompt: p.prompt,
      model: p.model || 'gemini-3.1-flash-image-preview',
      image_urls: p.image_urls || [],
      aspect_ratio: p.aspect_ratio || 'auto',
      image_size: p.image_size || '1K',
    };
    const data = await postJson(`${DOMI_BASE}/api/gemini/nano-banana-edit`, body, {
      Authorization: DOMI_KEY,
    });
    if (data?.code !== 200 || !data.data?.task_id) {
      throw new Error('nano edit failed: ' + JSON.stringify(data));
    }
    return { task_id: data.data.task_id };
  }

  throw new Error('unknown method: ' + method);
}

async function domiQuery(method, taskId) {
  if (method?.startsWith('image2')) {
    const data = await getJson(`${DOMI_BASE}/v1/tasks/${taskId}`, {
      Authorization: DOMI_KEY,
    });
    const state = data?.state;
    if (state === 'succeeded') {
      const url = data?.data?.images?.[0]?.url;
      return { status: 'success', imageUrl: url };
    }
    if (state === 'error' || state === 'failed') return { status: 'fail' };
    return { status: 'running' };
  }

  const data = await getJson(
    `${DOMI_BASE}/api/gemini/nano-banana/result?id=${encodeURIComponent(taskId)}&key=${DOMI_KEY}`
  );
  const state = data?.data?.state;
  if (state === 'succeeded') {
    const url = data?.data?.data?.images?.[0]?.url;
    return { status: 'success', imageUrl: url };
  }
  if (state === 'failed' || state === 'error') return { status: 'fail' };
  return { status: 'running' };
}

// ===================== storage =====================
const BUCKET = process.env.SUPABASE_TEMP_BUCKET || 'temp-refs';

async function uploadRef(filename, contentBase64) {
  if (!filename || !contentBase64) throw new Error('filename 与 contentBase64 必填');
  const ext = (filename.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? ext : 'png';
  const contentType = safeExt === 'jpg' ? 'image/jpeg' : `image/${safeExt}`;
  const path = `temp/${randomUUID()}-${filename.replace(/[^\w.-]/g, '_')}`;
  const buf = Buffer.from(contentBase64, 'base64');

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType, upsert: false });
  if (error) throw new Error('上传失败：' + error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

async function deleteRef(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.error('[storage] 删除失败', error.message);
}

async function uploadRefHandler(req, res) {
  const { filename, contentBase64 } = req.body || {};
  try {
    const r = await uploadRef(filename, contentBase64);
    return res.json({ code: 200, data: r });
  } catch (e) {
    return res.status(400).json({ code: 400, msg: e.message });
  }
}

// ===================== generate =====================
const VALID_METHODS = ['image2_t2i', 'image2_i2i', 'nano_t2i', 'nano_i2i'];

async function generate(req, res) {
  const u = req.user;
  const b = req.body || {};
  const {
    method, prompt, image_urls, size, quality,
    aspect_ratio, image_size, oversea, model, ref_paths,
  } = b;

  if (!VALID_METHODS.includes(method)) {
    return res.status(400).json({ code: 400, msg: '未知生图方式' });
  }
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ code: 400, msg: 'prompt 不能为空' });
  }

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

  const payload = {
    prompt: prompt.trim(),
    size, quality,
    aspect_ratio, image_size,
    oversea: !!oversea, model,
    image_urls,
  };

  let task_id;
  try {
    const r = await domiSubmit(method, payload);
    task_id = r.task_id;
  } catch (e) {
    if (cost > 0) {
      try { await supabase.rpc('refund_points', { p_user: u.id, p_amount: cost }); }
      catch (_) { /* 返还失败仅记日志 */ }
    }
    return res.status(502).json({ code: 502, msg: '提交生图失败：' + e.message });
  }

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

// ===================== status =====================
async function cleanupRefs(refPaths) {
  if (Array.isArray(refPaths)) {
    for (const p of refPaths) {
      try { await deleteRef(p); } catch (e) { console.error('[cleanup] 删除参考图失败', e.message); }
    }
  }
}

async function statusQuery(req, res) {
  const u = req.user;
  const { task_id } = req.body || {};
  if (!task_id) return res.status(400).json({ code: 400, msg: 'task_id 缺失' });

  const { data: log, error } = await supabase
    .from('generation_logs')
    .select('*')
    .eq('task_id', task_id)
    .single();
  if (error || !log) return res.status(404).json({ code: 404, msg: '任务不存在' });

  if (log.status === 'success') {
    return res.json({ code: 200, data: { status: 'success', url: log.result_image, cost: log.cost } });
  }
  if (log.status === 'fail') {
    return res.json({ code: 200, data: { status: 'fail', cost: log.cost } });
  }

  let q;
  try {
    q = await domiQuery(log.method, task_id);
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

// ===================== admin =====================
async function logOp(adminId, action, targetType, targetId, detail) {
  await supabase.from('operation_logs').insert({
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: String(targetId ?? ''),
    detail,
  });
}

async function listUsers(req, res) {
  const { data, error } = await supabase
    .from('users')
    .select('id, phone, balance, role, status, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ code: 500, msg: error.message });
  return res.json({ code: 200, data });
}

async function createUser(req, res) {
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

async function updateUser(req, res) {
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

async function deleteUser(req, res) {
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

async function listPricing(req, res) {
  const { data, error } = await supabase
    .from('pricing_rules')
    .select('type, cost')
    .order('type');
  if (error) return res.status(500).json({ code: 500, msg: error.message });
  return res.json({ code: 200, data });
}

async function updatePricing(req, res) {
  const type = req.params.type;
  const { cost } = req.body || {};
  const c = Number(cost);
  if (!Number.isFinite(c) || c < 0) return res.status(400).json({ code: 400, msg: 'cost 非法' });
  const { error } = await supabase.from('pricing_rules').update({ cost: c }).eq('type', type);
  if (error) return res.status(400).json({ code: 400, msg: error.message });
  await logOp(req.user.id, 'update_pricing', 'pricing', type, `计费 ${type} → ${c}`);
  return res.json({ code: 200, data: { ok: true } });
}

async function listGenLogs(req, res) {
  const { data, error } = await supabase
    .from('generation_logs')
    .select('id, task_id, user_id, method, prompt, cost, status, created_at, result_image')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return res.status(500).json({ code: 500, msg: error.message });
  return res.json({ code: 200, data });
}

async function listOpLogs(req, res) {
  const { data, error } = await supabase
    .from('operation_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return res.status(500).json({ code: 500, msg: error.message });
  return res.json({ code: 200, data });
}

// ===================== express app =====================
checkDbConfig();

const app = express();
app.use(express.json({ limit: '12mb' }));

let seeded = false;
app.use(async (req, res, next) => {
  if (!seeded) {
    seeded = true;
    seedAdmin().catch((e) => console.error('[seed]', e.message));
  }
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

app.post('/api/login', login);
app.get('/api/me', authRequired, me);
app.post('/api/generate', authRequired, generate);
app.post('/api/status', authRequired, statusQuery);
app.post('/api/upload-ref', authRequired, uploadRefHandler);

const adminRouter = express.Router();
adminRouter.use(authRequired, adminRequired);
adminRouter.get('/users', listUsers);
adminRouter.post('/users', createUser);
adminRouter.put('/users/:id', updateUser);
adminRouter.delete('/users/:id', deleteUser);
adminRouter.get('/pricing', listPricing);
adminRouter.put('/pricing/:type', updatePricing);
adminRouter.get('/logs/generation', listGenLogs);
adminRouter.get('/logs/operation', listOpLogs);
app.use('/api/admin', adminRouter);

export default app;
