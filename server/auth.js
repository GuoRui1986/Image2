// 鉴权：自建 users 表 + bcrypt + JWT（单 token，7 天有效期，存前端 localStorage）
// 说明：方案原定 access(15min)+refresh(7d)，为降低前端复杂度先采用单 token 跑通，
//       后续如需可平滑升级为双 token。
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const TOKEN_TTL = '7d';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, phone: user.phone, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function extractToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.headers['x-auth-token']) return req.headers['x-auth-token'];
  return null;
}

// 登录态中间件
export function authRequired(req, res, next) {
  const token = extractToken(req);
  const payload = token && verifyToken(token);
  if (!payload) {
    return res.status(401).json({ code: 401, msg: '未登录或登录已过期' });
  }
  req.user = { id: payload.sub, phone: payload.phone, role: payload.role };
  next();
}

// 管理员中间件
export function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ code: 403, msg: '需要管理员权限' });
  }
  next();
}

// 登录
export async function login(req, res) {
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

// 首次启动种子管理员（ADMIN_PHONE / ADMIN_PASSWORD，bcrypt 哈希，不在 SQL 写明文）
export async function seedAdmin() {
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

// 取当前用户信息（含余额），供前端刷新
export async function me(req, res) {
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
