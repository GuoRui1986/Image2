// IGA Pages Functions 单一入口（Hono + Edge Runtime 兼容）
// 约定：api/[[default]].js 作为 catch-all，export default app，平台接管监听
import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { hash, compare } from 'bcrypt-ts';
import { SignJWT, jwtVerify } from 'jose';

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

// ===================== utils =====================
function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ===================== auth =====================
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const TOKEN_TTL = '7d';
const encSecret = new TextEncoder().encode(JWT_SECRET);

async function signToken(user) {
  return new SignJWT({ sub: user.id, phone: user.phone, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(TOKEN_TTL)
    .sign(encSecret);
}

async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, encSecret);
    return payload;
  } catch {
    return null;
  }
}

function extractToken(c) {
  const auth = c.req.header('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const x = c.req.header('x-auth-token');
  if (x) return x;
  return null;
}

async function authRequired(c, next) {
  const token = extractToken(c);
  const payload = token ? await verifyToken(token) : null;
  if (!payload) {
    return c.json({ code: 401, msg: '未登录或登录已过期' }, 401);
  }
  c.set('user', { id: payload.sub, phone: payload.phone, role: payload.role });
  await next();
}

async function adminRequired(c, next) {
  if (c.get('user')?.role !== 'admin') {
    return c.json({ code: 403, msg: '需要管理员权限' }, 403);
  }
  await next();
}

async function login(c) {
  const { phone, password } = await c.req.json();
  if (!phone || !password) {
    return c.json({ code: 400, msg: '手机号或密码缺失' }, 400);
  }
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single();
  if (error || !user) {
    return c.json({ code: 401, msg: '账号不存在' }, 401);
  }
  if (user.status === 'frozen') {
    return c.json({ code: 403, msg: '账号已冻结' }, 403);
  }
  const ok = await compare(password, user.password_hash);
  if (!ok) {
    return c.json({ code: 401, msg: '密码错误' }, 401);
  }
  const token = await signToken(user);
  return c.json({
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
  const hashStr = await hash(pwd, 10);
  const { error } = await supabase
    .from('users')
    .insert({ phone, password_hash: hashStr, role: 'admin', balance: 999999 });
  if (error) {
    console.error('[seedAdmin] 创建失败:', error.message);
  } else {
    console.log('[seedAdmin] 已创建管理员', phone);
  }
}

async function me(c) {
  const user = c.get('user');
  const { data, error } = await supabase
    .from('users')
    .select('id, phone, balance, role, status, created_at')
    .eq('id', user.id)
    .single();
  if (error || !data) {
    return c.json({ code: 404, msg: '用户不存在' }, 404);
  }
  return c.json({ code: 200, data });
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
  const path = `temp/${crypto.randomUUID()}-${filename.replace(/[^\w.-]/g, '_')}`;
  const buf = base64ToUint8Array(contentBase64);

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

async function uploadRefHandler(c) {
  const { filename, contentBase64 } = await c.req.json();
  try {
    const r = await uploadRef(filename, contentBase64);
    return c.json({ code: 200, data: r });
  } catch (e) {
    return c.json({ code: 400, msg: e.message }, 400);
  }
}

// ===================== generate =====================
const VALID_METHODS = ['image2_t2i', 'image2_i2i', 'nano_t2i', 'nano_i2i'];

async function generate(c) {
  const u = c.get('user');
  const b = await c.req.json();
  const {
    method, prompt, image_urls, size, quality,
    aspect_ratio, image_size, oversea, model, ref_paths,
  } = b;

  if (!VALID_METHODS.includes(method)) {
    return c.json({ code: 400, msg: '未知生图方式' }, 400);
  }
  if (!prompt || !prompt.trim()) {
    return c.json({ code: 400, msg: 'prompt 不能为空' }, 400);
  }

  let cost = 0;
  if (u.role !== 'admin') {
    const { data: rule, error } = await supabase
      .from('pricing_rules')
      .select('cost')
      .eq('type', method)
      .single();
    if (error || !rule) {
      return c.json({ code: 500, msg: '计费规则缺失：' + (error?.message || method) }, 500);
    }
    cost = rule.cost;
    try {
      await supabase.rpc('deduct_points', { p_user: u.id, p_amount: cost });
    } catch (e) {
      return c.json({ code: 400, msg: '积分不足' }, 400);
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
    return c.json({ code: 502, msg: '提交生图失败：' + e.message }, 502);
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

  return c.json({ code: 200, data: { task_id, cost } });
}

// ===================== status =====================
async function cleanupRefs(refPaths) {
  if (Array.isArray(refPaths)) {
    for (const p of refPaths) {
      try { await deleteRef(p); } catch (e) { console.error('[cleanup] 删除参考图失败', e.message); }
    }
  }
}

async function statusQuery(c) {
  const u = c.get('user');
  const { task_id } = await c.req.json();
  if (!task_id) return c.json({ code: 400, msg: 'task_id 缺失' }, 400);

  const { data: log, error } = await supabase
    .from('generation_logs')
    .select('*')
    .eq('task_id', task_id)
    .single();
  if (error || !log) return c.json({ code: 404, msg: '任务不存在' }, 404);

  if (log.status === 'success') {
    return c.json({ code: 200, data: { status: 'success', url: log.result_image, cost: log.cost } });
  }
  if (log.status === 'fail') {
    return c.json({ code: 200, data: { status: 'fail', cost: log.cost } });
  }

  let q;
  try {
    q = await domiQuery(log.method, task_id);
  } catch (e) {
    return c.json({ code: 502, msg: '查询失败：' + e.message }, 502);
  }

  if (q.status === 'running') {
    return c.json({ code: 200, data: { status: 'running' } });
  }

  if (q.status === 'success') {
    const { error: upErr } = await supabase
      .from('generation_logs')
      .update({ status: 'success', result_image: q.imageUrl })
      .eq('task_id', task_id);
    if (upErr) console.error('[status] 更新成功记录失败', upErr.message);
    await cleanupRefs(log.params?.ref_paths);
    return c.json({ code: 200, data: { status: 'success', url: q.imageUrl, cost: log.cost } });
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
  return c.json({ code: 200, data: { status: 'fail', cost: log.cost } });
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

async function listUsers(c) {
  const { data, error } = await supabase
    .from('users')
    .select('id, phone, balance, role, status, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) return c.json({ code: 500, msg: error.message }, 500);
  return c.json({ code: 200, data });
}

async function createUser(c) {
  const { phone, password, balance } = await c.req.json();
  if (!phone || !password) {
    return c.json({ code: 400, msg: '手机号与密码必填' }, 400);
  }
  const hashStr = await hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({ phone, password_hash: hashStr, balance: Number(balance) || 0, role: 'user' })
    .select('id, phone, balance')
    .single();
  if (error) return c.json({ code: 400, msg: '创建失败：' + error.message }, 400);
  await logOp(c.get('user').id, 'create_user', 'user', data.id, `创建用户 ${phone}`);
  return c.json({ code: 200, data });
}

async function updateUser(c) {
  const id = c.req.param('id');
  const { action, password, delta } = await c.req.json();
  const { data: target, error: te } = await supabase
    .from('users')
    .select('id, role, balance, phone')
    .eq('id', id)
    .single();
  if (te || !target) return c.json({ code: 404, msg: '用户不存在' }, 404);
  if (target.role === 'admin') {
    return c.json({ code: 403, msg: '不能修改管理员账号' }, 403);
  }

  if (action === 'freeze') {
    await supabase.from('users').update({ status: 'frozen' }).eq('id', id);
    await logOp(c.get('user').id, 'freeze', 'user', id, `冻结用户 ${target.phone}`);
    return c.json({ code: 200, data: { ok: true } });
  }
  if (action === 'unfreeze') {
    await supabase.from('users').update({ status: 'active' }).eq('id', id);
    await logOp(c.get('user').id, 'unfreeze', 'user', id, `解冻用户 ${target.phone}`);
    return c.json({ code: 200, data: { ok: true } });
  }
  if (action === 'reset_pwd') {
    if (!password) return c.json({ code: 400, msg: '新密码必填' }, 400);
    const hashStr = await hash(password, 10);
    await supabase.from('users').update({ password_hash: hashStr }).eq('id', id);
    await logOp(c.get('user').id, 'reset_pwd', 'user', id, `重置密码 ${target.phone}`);
    return c.json({ code: 200, data: { ok: true } });
  }
  if (action === 'adjust_credit') {
    const d = Number(delta);
    if (!Number.isFinite(d)) return c.json({ code: 400, msg: 'delta 非法' }, 400);
    const newBal = target.balance + d;
    if (newBal < 0) return c.json({ code: 400, msg: '余额不能为负' }, 400);
    await supabase.from('users').update({ balance: newBal }).eq('id', id);
    await logOp(c.get('user').id, 'adjust_credit', 'user', id, `调整积分 ${target.phone} ${d >= 0 ? '+' : ''}${d} → ${newBal}`);
    return c.json({ code: 200, data: { balance: newBal } });
  }
  return c.json({ code: 400, msg: '未知 action' }, 400);
}

async function deleteUser(c) {
  const id = c.req.param('id');
  const { data: target, error: te } = await supabase
    .from('users')
    .select('id, role, phone')
    .eq('id', id)
    .single();
  if (te || !target) return c.json({ code: 404, msg: '用户不存在' }, 404);
  if (target.role === 'admin') return c.json({ code: 403, msg: '不能删除管理员' }, 403);
  await supabase.from('users').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  await logOp(c.get('user').id, 'delete_user', 'user', id, `软删除用户 ${target.phone}`);
  return c.json({ code: 200, data: { ok: true } });
}

async function listPricing(c) {
  const { data, error } = await supabase
    .from('pricing_rules')
    .select('type, cost')
    .order('type');
  if (error) return c.json({ code: 500, msg: error.message }, 500);
  return c.json({ code: 200, data });
}

async function updatePricing(c) {
  const type = c.req.param('type');
  const { cost } = await c.req.json();
  const cnum = Number(cost);
  if (!Number.isFinite(cnum) || cnum < 0) return c.json({ code: 400, msg: 'cost 非法' }, 400);
  const { error } = await supabase.from('pricing_rules').update({ cost: cnum }).eq('type', type);
  if (error) return c.json({ code: 400, msg: error.message }, 400);
  await logOp(c.get('user').id, 'update_pricing', 'pricing', type, `计费 ${type} → ${cnum}`);
  return c.json({ code: 200, data: { ok: true } });
}

async function listGenLogs(c) {
  const { data, error } = await supabase
    .from('generation_logs')
    .select('id, task_id, user_id, method, prompt, cost, status, created_at, result_image')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return c.json({ code: 500, msg: error.message }, 500);
  return c.json({ code: 200, data });
}

async function listOpLogs(c) {
  const { data, error } = await supabase
    .from('operation_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return c.json({ code: 500, msg: error.message }, 500);
  return c.json({ code: 200, data });
}

// ===================== hono app =====================
checkDbConfig();

const app = new Hono();

let seeded = false;
app.use('*', async (c, next) => {
  if (!seeded) {
    seeded = true;
    seedAdmin().catch((e) => console.error('[seed]', e.message));
  }
  await next();
});

app.onError((err, c) => {
  console.error('[error]', err);
  return c.json({ code: 500, msg: err.message || '服务器内部错误' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true, time: Date.now() }));

app.post('/api/login', login);
app.get('/api/me', authRequired, me);
app.post('/api/generate', authRequired, generate);
app.post('/api/status', authRequired, statusQuery);
app.post('/api/upload-ref', authRequired, uploadRefHandler);

app.use('/api/admin/*', authRequired, adminRequired);
app.get('/api/admin/users', listUsers);
app.post('/api/admin/users', createUser);
app.put('/api/admin/users/:id', updateUser);
app.delete('/api/admin/users/:id', deleteUser);
app.get('/api/admin/pricing', listPricing);
app.put('/api/admin/pricing/:type', updatePricing);
app.get('/api/admin/logs/generation', listGenLogs);
app.get('/api/admin/logs/operation', listOpLogs);

export default app;
