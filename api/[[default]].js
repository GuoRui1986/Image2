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

// ===================== tokenhub (Phase 8 策划器) =====================
const TOKENHUB_BASE = process.env.TOKENHUB_BASE_URL || 'https://tokenhub.tencentmaas.com';
const TOKENHUB_KEY = process.env.TOKENHUB_KEY;

async function tokenhubChat(body) {
  const r = await fetch(`${TOKENHUB_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKENHUB_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

// 11.5.1 System Prompt 定稿模板（规则不可动，仅措辞可调）
const PLANNER_SYSTEM_PROMPT = `你是资深电商详情图视觉策划专家，任务是根据用户提供的商品信息，为固定的 9 个详情图板块各生成一条可直接用于 AI 图像生成模型的提示词。

【硬规则】
1. 每个板块你要同时产出两样东西：a) 图像生成提示词（prompt 字段）与 b) 营销文案包（copy 字段，含 title 主标题≤10字、subtitle 副标题≤20字、points 卖点短句数组≤3条每条≤15字）。prompt 必须以「用途」起句，明确这是用于[目标平台]电商的[板块类型]商品图（如"淘宝电商主图""抖音电商详情图"），并描述该平台电商图典型特征：淘宝/京东-白底居中、细节清晰；抖音-场景氛围、竖屏生活化；小红书-ins高级感、生活方式化；亚马逊-纯白背景、产品占比大、无文字。在此基础上贯穿五要素：画面主体、场景、光线、构图、风格。
2. prompt 中禁止出现任何文字渲染指示（文字、字母、数字、logo 均不写进 prompt）——保持纯画面描述（第1条要求的「用途」前缀属画面语境描述，不受此限）；适合放文字的板块在 prompt 中写"预留干净留白区域"。文案是否画进图由前端「文案入图」开关控制：开关打开时前端按 copy 字段自动在提示词末尾拼接排版段（主标题大字 → 副标题小一号 → 卖点底部横排小字 + "所有文字清晰工整无错别字"兜底），你只需保证 copy 文案质量。
3. 9 个板块的风格、色调、光线必须统一，全部贯穿用户指定的"目标风格"和"品牌色"；文案口吻全套统一，紧扣用户给的核心卖点，禁止编造商品没有的功能参数。
4. model 字段取值只能是 "image2" 或 "nano"，严格按板块推荐表：主图/场景/细节/材质/对比/促销 → image2；人群/尺寸/资质 → nano。
5. size 字段按用户的"目标平台"给出宽x高像素（如淘宝主图 800x800、详情 750 宽；抖音 1080x1080；亚马逊 2000x2000）。
6. prompt 用中文书写，具体、可视化、无空话；每条 60–180 字（含用途前缀）。
7. 只按给定 JSON Schema 输出，不输出任何解释、开场白、结尾语。

【9 板块固定清单（顺序、名称不可改）】
1 主图/首图；2 核心场景图；3 人群/情绪图；4 功能细节特写；5 材质/工艺图；6 尺寸/规格图；7 对比图；8 资质/保障图；9 促销收尾图`;

const PLANNER_NAME_ORDER = [
  '主图/首图', '核心场景图', '人群/情绪图', '功能细节特写', '材质/工艺图',
  '尺寸/规格图', '对比图', '资质/保障图', '促销收尾图',
];

// json_schema：字段 description 双保险（实测 hy3 只靠 schema 会填串字段）
const PLANNER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sections: {
      type: 'array',
      description: '固定 9 个详情图板块，顺序不可改变，依次为：主图/首图、核心场景图、人群/情绪图、功能细节特写、材质/工艺图、尺寸/规格图、对比图、资质/保障图、促销收尾图',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: '板块名称，固定为 9 个之一（主图/首图、核心场景图、人群/情绪图、功能细节特写、材质/工艺图、尺寸/规格图、对比图、资质/保障图、促销收尾图）' },
          prompt: { type: 'string', description: '图像生成提示词，必须以用途起句明确"用于[目标平台]电商的[板块类型]商品图"，并描述该平台电商图典型特征（淘宝/京东白底居中、抖音场景氛围、小红书ins风、亚马逊纯白大图无文字），再贯穿五要素：画面主体、场景、光线、构图、风格；禁止出现文字/字母/数字/logo 渲染指示；用中文，60-180字，具体可视化无空话' },
          size: { type: 'string', description: '宽x高像素，如 800x800、750x1000、1080x1080、2000x2000，按目标平台给出' },
          model: { type: 'string', description: '取值只能是 image2 或 nano，严格按推荐：主图/场景/细节/材质/对比/促销→image2；人群/尺寸/资质→nano' },
          note: { type: 'string', description: '该板块策划说明或生图注意点，简短一句' },
          copy: {
            type: 'object',
            additionalProperties: false,
            description: '营销文案包',
            properties: {
              title: { type: 'string', description: '主标题，≤10字' },
              subtitle: { type: 'string', description: '副标题，≤20字' },
              points: { type: 'array', description: '卖点短句数组，≤3条，每条≤15字', items: { type: 'string' } },
            },
            required: ['title', 'subtitle', 'points'],
          },
        },
        required: ['name', 'prompt', 'size', 'model', 'note', 'copy'],
      },
    },
  },
  required: ['sections'],
};

// 第一段：hy-vision 看图分析（仅传图时）
async function analyzeProductImage(base64, mime) {
  const dataUri = `data:${mime || 'image/png'};base64,${base64}`;
  const r = await tokenhubChat({
    model: 'hy-vision-2.0-instruct',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请从电商详情图策划角度分析这张商品图，输出四部分（每部分简短，总字数控制在 300 字以内）：1)品类；2)外观/材质/颜色/工艺特征；3)结构特征；4)可提炼的电商视觉卖点（4-6条短句，从图中视觉信息直接看出，如高端包装、品牌辨识度、色泽饱满、便携设计等）。只列要点，不要展开。',
          },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
  });
  if (r?.error) throw new Error('hy-vision 失败：' + JSON.stringify(r.error));
  return r?.choices?.[0]?.message?.content || '';
}

// 第二段：hy3 出 9 板块
function extractSections(content) {
  if (!content) return null;
  let parsed;
  try { parsed = JSON.parse(content); } catch { return null; }
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.sections)) return parsed.sections;
  if (Array.isArray(parsed?.data?.sections)) return parsed.data.sections;
  return null;
}

// 第二路：普通 text 出 JSON（json_schema 失败时兜底，thinking 模式尤其容易返回空数组）
async function planSectionsFallback(userPrompt) {
  const r = await tokenhubChat({
    model: 'hy3',
    temperature: 0.8,
    max_tokens: 16000,
    messages: [
      { role: 'system', content: PLANNER_SYSTEM_PROMPT + '\n\n【输出格式】只输出一个 JSON 对象：{"sections":[{name,prompt,size,model,note,copy:{title,subtitle,points}}]}，共 9 个板块，板块名称严格按清单顺序。不要输出任何解释、markdown 代码块标记或多余字符。' },
      { role: 'user', content: userPrompt },
    ],
  });
  if (r?.error) throw new Error('hy3 兜底失败：' + JSON.stringify(r.error));
  const content = r?.choices?.[0]?.message?.content;
  if (!content) throw new Error('hy3 兜底返回为空');
  // 容错：去掉可能的 ```json 包裹
  const cleaned = content.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const sections = extractSections(cleaned);
  if (!sections || !sections.length) throw new Error('9 板块结构异常：' + cleaned.slice(0, 200));
  return sections;
}

async function planSections(userPrompt, thinking) {
  let content = null, reasoning = '', lastErr = null;
  if (thinking) {
    // 深度思考模式：json_schema 极易返回空数组，直接走普通 text + 严格格式要求（保留 thinking 推理质量）
    try {
      const r = await tokenhubChat({
        model: 'hy3',
        temperature: 0.8,
        max_tokens: 24000,
        thinking: { type: 'enabled' },
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT + '\n\n【输出格式】只输出一个 JSON 对象：{"sections":[{name,prompt,size,model,note,copy:{title,subtitle,points}}]}，共 9 个板块，板块名称严格按清单顺序。不要输出任何解释、markdown 代码块标记或多余字符。' },
          { role: 'user', content: userPrompt },
        ],
      });
      if (r?.error) throw new Error('hy3 失败：' + JSON.stringify(r.error));
      content = r?.choices?.[0]?.message?.content;
      reasoning = r?.choices?.[0]?.message?.reasoning_content || '';
      if (!content) throw new Error('hy3 返回为空');
    } catch (e) { lastErr = e; }
    // 失败兜底到无 thinking 的普通 text
    if (!extractSections(content)) {
      try { content = null; const s = await planSectionsFallback(userPrompt); content = JSON.stringify({ sections: s }); reasoning = ''; }
      catch (e) { lastErr = lastErr || e; }
    }
  } else {
    // 普通模式：json_schema 优先
    const r = await tokenhubChat({
      model: 'hy3',
      temperature: 0.8,
      response_format: { type: 'json_schema', json_schema: { name: 'detail_sections', schema: PLANNER_SCHEMA } },
      messages: [
        { role: 'system', content: PLANNER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });
    if (r?.error) throw new Error('hy3 失败：' + JSON.stringify(r.error));
    content = r?.choices?.[0]?.message?.content;
    if (!content) throw new Error('hy3 返回为空：' + JSON.stringify(r).slice(0, 300));
    // json_schema 空数组 → 普通 text 兜底
    if (!extractSections(content)) {
      try { const s = await planSectionsFallback(userPrompt); content = JSON.stringify({ sections: s }); }
      catch (e) { lastErr = e; }
    }
  }
  const sections = extractSections(content);
  if (!sections || !sections.length) {
    throw lastErr || new Error('9 板块结构异常：' + (content || '').slice(0, 200));
  }
  // 按固定顺序对齐 name，防止 LLM 填串
  const aligned = sections.slice(0, 9).map((s, i) => ({ ...s, name: PLANNER_NAME_ORDER[i] || s.name }));
  return { sections: aligned, reasoning };
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

// ===================== planner (Phase 8 策划器) =====================
async function getPlannerEnabled() {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'planner_enabled')
    .maybeSingle();
  return data?.value === true;
}

function buildPlannerUserPrompt(b, analysis) {
  const sp = [];
  sp.push(`商品名：${b.product_name || ''}；类目：${b.category || ''}；核心卖点：${b.selling_points || ''}；`);
  sp.push(`目标风格：${b.style || ''}；目标平台：${b.platform || ''}；品牌色/关键词：${b.brand || ''}；`);
  if (analysis) sp.push(`产品图 AI 分析（看图中提炼）：${analysis}`);
  return sp.join('\n');
}

async function plannerHandler(c) {
  if (!TOKENHUB_KEY) {
    return c.json({ code: 500, msg: '服务端未配置 TOKENHUB_KEY，策划器不可用' }, 500);
  }
  const u = c.get('user');
  const b = await c.req.json();
  const { product_name, category, image_base64, thinking } = b;
  if (!product_name || !product_name.trim() || !category || !category.trim()) {
    return c.json({ code: 400, msg: '商品名与类目必填' }, 400);
  }

  const enabled = await getPlannerEnabled();
  if (!enabled) {
    return c.json({ code: 403, msg: '详情图策划功能暂停使用' }, 403);
  }

  // 计费预扣（管理员免费）
  let cost = 0;
  if (u.role !== 'admin') {
    const { data: rule } = await supabase
      .from('pricing_rules')
      .select('cost')
      .eq('type', 'detail_planner')
      .single();
    cost = rule?.cost || 5;
    try {
      await supabase.rpc('deduct_points', { p_user: u.id, p_amount: cost });
    } catch (e) {
      return c.json({ code: 400, msg: '积分不足' }, 400);
    }
  }

  const hasImage = !!(image_base64 && image_base64.trim());
  let analysis = '';
  let sections = null;
  let reasoning = '';

  try {
    if (hasImage) {
      analysis = await analyzeProductImage(image_base64, b.image_mime);
    }
    const r = await planSections(buildPlannerUserPrompt(b, analysis), !!thinking);
    sections = r.sections;
    reasoning = r.reasoning;
  } catch (e) {
    if (cost > 0) {
      try { await supabase.rpc('refund_points', { p_user: u.id, p_amount: cost }); }
      catch (_) { /* 返还失败仅记日志 */ }
    }
    await supabase.from('planner_logs').insert({
      user_id: u.id, product_name, category, platform: b.platform || null,
      style: b.style || null, brand_color: b.brand || null,
      thinking: !!thinking, has_image: hasImage, cost, status: 'fail',
    });
    return c.json({ code: 502, msg: '策划生成失败：' + e.message }, 502);
  }

  await supabase.from('planner_logs').insert({
    user_id: u.id, product_name, category, platform: b.platform || null,
    style: b.style || null, brand_color: b.brand || null,
    thinking: !!thinking, has_image: hasImage, cost, status: 'success',
  });

  return c.json({ code: 200, data: { analysis, reasoning, sections } });
}

async function plannerAnalyzeHandler(c) {
  if (!TOKENHUB_KEY) {
    return c.json({ code: 500, msg: '服务端未配置 TOKENHUB_KEY' }, 500);
  }
  const { image_base64, image_mime } = await c.req.json();
  if (!image_base64 || !image_base64.trim()) {
    return c.json({ code: 400, msg: '请先上传产品图' }, 400);
  }
  try {
    const analysis = await analyzeProductImage(image_base64, image_mime);
    return c.json({ code: 200, data: { analysis } });
  } catch (e) {
    return c.json({ code: 502, msg: '看图分析失败：' + e.message }, 502);
  }
}

async function plannerStatusHandler(c) {
  const enabled = await getPlannerEnabled();
  return c.json({ code: 200, data: { enabled } });
}

async function getConfigHandler(c) {
  const enabled = await getPlannerEnabled();
  return c.json({ code: 200, data: { planner_enabled: enabled } });
}

async function putConfigHandler(c) {
  const { planner_enabled } = await c.req.json();
  const val = planner_enabled === true || planner_enabled === 'true';
  const { error } = await supabase
    .from('app_config')
    .update({ value: val, updated_at: new Date().toISOString() })
    .eq('key', 'planner_enabled');
  if (error) return c.json({ code: 400, msg: error.message }, 400);
  await logOp(c.get('user').id, 'toggle_feature', 'config', 'planner_enabled', `策划器功能${val ? '启用' : '停用'}`);
  return c.json({ code: 200, data: { planner_enabled: val } });
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
  const { phone, password, balance, role } = await c.req.json();
  if (!phone || !password) {
    return c.json({ code: 400, msg: '手机号与密码必填' }, 400);
  }
  const safeRole = role === 'admin' ? 'admin' : 'user';
  const hashStr = await hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({ phone, password_hash: hashStr, balance: Number(balance) || 0, role: safeRole })
    .select('id, phone, balance')
    .single();
  if (error) return c.json({ code: 400, msg: '创建失败：' + error.message }, 400);
  await logOp(c.get('user').id, 'create_user', 'user', data.id, `创建用户 ${phone}（角色 ${safeRole}）`);
  return c.json({ code: 200, data });
}

async function updateUser(c) {
  const id = c.req.param('id');
  const { action, password, delta, remark } = await c.req.json();
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
    await logOp(c.get('user').id, 'adjust_credit', 'user', id, `调整积分 ${target.phone} ${d >= 0 ? '+' : ''}${d} → ${newBal}${remark ? '（备注：' + remark + '）' : ''}`);
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

async function fetchUsersLite() {
  const { data } = await supabase
    .from('users')
    .select('id, phone, role, status, balance, created_at, deleted_at');
  return data || [];
}

async function listGenLogs(c) {
  const { user_id, method, status, days, type } = c.req.query();
  const users = await fetchUsersLite();
  const umap = Object.fromEntries(users.map((u) => [u.id, u.phone]));
  if (type === 'planner') {
    let q = supabase
      .from('planner_logs')
      .select('id, user_id, product_name, style, thinking, has_image, cost, status, created_at')
      .order('created_at', { ascending: false })
      .limit(300);
    if (user_id) q = q.eq('user_id', user_id);
    if (status) q = q.eq('status', status);
    const d = Number(days);
    if (Number.isFinite(d) && d > 0) q = q.gte('created_at', new Date(Date.now() - d * 86400000).toISOString());
    const { data, error } = await q;
    if (error) return c.json({ code: 500, msg: error.message }, 500);
    const rows = (data || []).map((p) => ({
      rec_type: 'planner', id: p.id, user_id: p.user_id, phone: umap[p.user_id] || p.user_id,
      product_name: p.product_name, style: p.style, thinking: !!p.thinking, has_image: !!p.has_image,
      cost: p.cost, status: p.status, created_at: p.created_at,
    }));
    return c.json({ code: 200, data: rows });
  }
  let q = supabase
    .from('generation_logs')
    .select('id, task_id, user_id, method, prompt, cost, status, created_at, result_image, ref_images')
    .order('created_at', { ascending: false })
    .limit(300);
  if (user_id) q = q.eq('user_id', user_id);
  if (method) q = q.eq('method', method);
  if (status) q = q.eq('status', status);
  const d = Number(days);
  if (Number.isFinite(d) && d > 0) {
    q = q.gte('created_at', new Date(Date.now() - d * 86400000).toISOString());
  }
  const { data, error } = await q;
  if (error) return c.json({ code: 500, msg: error.message }, 500);
  const rows = (data || []).map((g) => ({ rec_type: 'gen', ...g, phone: umap[g.user_id] || g.user_id }));
  return c.json({ code: 200, data: rows });
}

async function listOpLogs(c) {
  const { data, error } = await supabase
    .from('operation_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return c.json({ code: 500, msg: error.message }, 500);
  const users = await fetchUsersLite();
  const umap = Object.fromEntries(users.map((u) => [u.id, u.phone]));
  const rows = (data || []).map((o) => ({ ...o, admin_phone: umap[o.admin_id] || o.admin_id, target_phone: umap[o.target_id] || null }));
  return c.json({ code: 200, data: rows });
}

// ===================== 统计聚合 =====================
async function fetchGenLogsLite() {
  const { data, error } = await supabase
    .from('generation_logs')
    .select('user_id, method, cost, status, created_at')
    .limit(5000);
  if (error) throw new Error(error.message);
  return data || [];
}

async function dashboardHandler(c) {
  let logs, users, plogs;
  try {
    logs = await fetchGenLogsLite();
    users = await fetchUsersLite();
    const pr = await supabase.from('planner_logs').select('status, cost, created_at').limit(5000);
    plogs = pr.data || [];
  } catch (e) {
    return c.json({ code: 500, msg: e.message }, 500);
  }
  const alive = users.filter((u) => !u.deleted_at);
  const activeUsers = alive.filter((u) => u.status === 'active').length;

  let totalCost = 0;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let mTotal = 0, mFail = 0;

  const days = [];
  const dayMap = {};
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(now.getTime() - i * 86400000);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const row = { key, label: `${dt.getMonth() + 1}-${dt.getDate()}`, image2: 0, nano: 0, total: 0, planner: 0 };
    days.push(row); dayMap[key] = row;
  }

  logs.forEach((g) => {
    if (g.status === 'success') totalCost += g.cost || 0;
    const t = new Date(g.created_at);
    if (t >= monthStart) { mTotal++; if (g.status === 'fail') mFail++; }
    const key = (g.created_at || '').slice(0, 10);
    if (dayMap[key]) {
      const row = dayMap[key];
      if ((g.method || '').startsWith('image2')) row.image2++; else row.nano++;
      row.total++;
    }
  });

  let plannerCount = 0;
  plogs.forEach((p) => {
    if (p.status === 'success') plannerCount++;
    const key = (p.created_at || '').slice(0, 10);
    if (dayMap[key]) dayMap[key].planner++;
  });

  return c.json({
    code: 200,
    data: {
      total_cost: totalCost,
      total_count: logs.length,
      planner_count: plannerCount,
      active_users: activeUsers,
      total_users: alive.length,
      month_fail_rate: mTotal ? +((mFail / mTotal) * 100).toFixed(1) : 0,
      trend: days,
    },
  });
}

async function statsHandler(c) {
  let logs, users, plogs;
  try {
    logs = await fetchGenLogsLite();
    users = await fetchUsersLite();
    const pr = await supabase.from('planner_logs').select('user_id, status, cost').limit(5000);
    plogs = pr.data || [];
  } catch (e) {
    return c.json({ code: 500, msg: e.message }, 500);
  }
  const umap = Object.fromEntries(users.map((u) => [u.id, u]));
  let totalCost = 0, success = 0, fail = 0;
  const methods = {};
  const perUser = {};
  let plannerCount = 0, plannerSuccess = 0, plannerCost = 0;
  plogs.forEach((p) => {
    plannerCount++;
    if (p.status === 'success') { plannerSuccess++; plannerCost += p.cost || 0; }
  });
  logs.forEach((g) => {
    if (g.status === 'success') { success++; totalCost += g.cost || 0; }
    else if (g.status === 'fail') fail++;
    const m = methods[g.method] || (methods[g.method] = { method: g.method, count: 0, cost: 0 });
    m.count++;
    if (g.status === 'success') m.cost += g.cost || 0;
    const u = umap[g.user_id];
    if (u && u.role !== 'admin' && g.status === 'success' && (g.cost || 0) > 0) {
      perUser[g.user_id] = (perUser[g.user_id] || 0) + g.cost;
    }
  });
  const ranking = Object.entries(perUser)
    .map(([uid, cost]) => ({ phone: umap[uid]?.phone || uid, cost }))
    .sort((a, b) => b.cost - a.cost);
  const methodsArr = Object.values(methods).sort((a, b) => b.count - a.count);
  if (plannerCount > 0) methodsArr.push({ method: 'detail_planner', count: plannerCount, cost: plannerCost });
  return c.json({
    code: 200,
    data: {
      total_cost: totalCost,
      total_count: logs.length,
      avg_cost: logs.length ? +(totalCost / Math.max(success, 1)).toFixed(1) : 0,
      success, fail,
      methods: methodsArr,
      ranking,
      planner: { count: plannerCount, success: plannerSuccess, cost: plannerCost },
    },
  });
}

async function creditsHandler(c) {
  let logs, users;
  try {
    logs = await fetchGenLogsLite();
    users = await fetchUsersLite();
  } catch (e) {
    return c.json({ code: 500, msg: e.message }, 500);
  }
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthCost = {};
  logs.forEach((g) => {
    if (g.status === 'success' && new Date(g.created_at) >= monthStart) {
      monthCost[g.user_id] = (monthCost[g.user_id] || 0) + (g.cost || 0);
    }
  });
  const rows = users
    .filter((u) => !u.deleted_at)
    .map((u) => ({
      id: u.id, phone: u.phone, role: u.role, balance: u.balance,
      month_cost: monthCost[u.id] || 0,
    }));
  return c.json({ code: 200, data: rows });
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
app.get('/api/admin/dashboard', dashboardHandler);
app.get('/api/admin/stats', statsHandler);
app.get('/api/admin/credits', creditsHandler);

// Phase 8 策划器路由
app.post('/api/planner', authRequired, plannerHandler);
app.post('/api/planner/analyze', authRequired, plannerAnalyzeHandler);
app.get('/api/planner/status', authRequired, plannerStatusHandler);
app.get('/api/admin/config', getConfigHandler);
app.put('/api/admin/config', putConfigHandler);

export default app;
