// Supabase 客户端（服务端用 service_role key，全权限）
// 火山引擎 Supabase 100% 兼容开源 Supabase，变量名使用官方标准。
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = createClient(url || '', serviceKey || '', {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 启动自检：缺环境变量时显式报错，避免上线后静默失败
export function checkDbConfig() {
  if (!url || !serviceKey) {
    console.error('[db] 缺少 SUPABASE_URL / SUPABASE_SERVICE_KEY，请在 IGA 控制台配置环境变量');
    return false;
  }
  return true;
}
