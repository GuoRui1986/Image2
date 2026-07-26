// 参考图临时桶：用户上传 → 存 Supabase Storage 临时桶 → 取公开 URL 给多米
// 生成成功/失败后由 status.js 调 deleteRef 清理（几 MB 几乎零成本，与「结果图不存」不冲突）
import { supabase } from './db.js';
import { randomUUID } from 'node:crypto';

const BUCKET = process.env.SUPABASE_TEMP_BUCKET || 'temp-refs';

export async function uploadRef(filename, contentBase64) {
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

export async function deleteRef(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.error('[storage] 删除失败', error.message);
}

// HTTP 入口：接收 { filename, contentBase64 }，返回 { url, path }
export async function uploadRefHandler(req, res) {
  const { filename, contentBase64 } = req.body || {};
  try {
    const r = await uploadRef(filename, contentBase64);
    return res.json({ code: 200, data: r });
  } catch (e) {
    return res.status(400).json({ code: 400, msg: e.message });
  }
}
