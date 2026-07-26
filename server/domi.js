// 多米生图适配层（照 总体方案 §11 实测规格实抄）
// 两套鉴权并存：
//   - nano 系列：提交用 Authorization 头，查询用 ?key= 参数
//   - gpt(image2) 系列：提交与查询都用 Authorization 头，查询路径 /v1/tasks/{id}
// method 映射：image2_t2i / image2_i2i / nano_t2i / nano_i2i
const BASE = process.env.DOMI_BASE_URL || 'https://duomiapi.com';
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

// 提交生图，返回 { task_id }
export async function submit(method, p) {
  if (method === 'image2_t2i' || method === 'image2_i2i') {
    const body = { model: 'gpt-image-2', prompt: p.prompt };
    if (p.size) body.size = p.size;
    if (p.quality) body.quality = p.quality;
    if (typeof p.oversea === 'boolean') body.oversea = p.oversea;
    if (method === 'image2_i2i' && p.image_urls?.length) {
      body.image = p.image_urls; // string | array[string]
    }
    const data = await postJson(`${BASE}/v1/images/generations?async=true`, body, {
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
    const data = await postJson(`${BASE}/api/gemini/nano-banana`, body, {
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
    const data = await postJson(`${BASE}/api/gemini/nano-banana-edit`, body, {
      Authorization: DOMI_KEY,
    });
    if (data?.code !== 200 || !data.data?.task_id) {
      throw new Error('nano edit failed: ' + JSON.stringify(data));
    }
    return { task_id: data.data.task_id };
  }

  throw new Error('unknown method: ' + method);
}

// 查询状态，归一化返回 { status: 'running'|'success'|'fail', imageUrl? }
export async function query(method, taskId) {
  if (method?.startsWith('image2')) {
    const data = await getJson(`${BASE}/v1/tasks/${taskId}`, {
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

  // nano：查询用 ?id= &key=
  const data = await getJson(
    `${BASE}/api/gemini/nano-banana/result?id=${encodeURIComponent(taskId)}&key=${DOMI_KEY}`
  );
  const state = data?.data?.state;
  if (state === 'succeeded') {
    const url = data?.data?.data?.images?.[0]?.url;
    return { status: 'success', imageUrl: url };
  }
  if (state === 'failed' || state === 'error') return { status: 'fail' };
  return { status: 'running' };
}
