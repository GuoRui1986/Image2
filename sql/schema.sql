-- 多米生图内部平台 · 数据库 Schema
-- 适用：火山引擎 Supabase（PostgreSQL，100% 兼容开源 Supabase）
-- 执行方式：火山 Supabase 控制台 SQL Editor 粘贴执行，或 byted-supabase-cli 执行
-- 注意：本文件只建表/索引/种子计费规则，种子管理员由后端首次启动用 ADMIN_PHONE/ADMIN_PASSWORD（bcrypt 哈希）插入，不在 SQL 内写明文密码。

-- 扩展兜底（gen_random_uuid 在 PG13+ 内置；低版本需 pgcrypto）
create extension if not exists pgcrypto;

-- 1. 账户
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  password_hash text not null,
  balance integer not null default 0,
  role text not null default 'user',      -- admin | user
  status text not null default 'active',  -- active | frozen
  created_at timestamptz not null default now(),
  deleted_at timestamptz                  -- 软删除：保留生图/操作记录外键，不真删
);

-- 2. 计费规则（4 种生图方式）
create table if not exists pricing_rules (
  id uuid primary key default gen_random_uuid(),
  type text unique not null,   -- image2_t2i|image2_i2i|nano_t2i|nano_i2i
  cost integer not null default 10
);
insert into pricing_rules (type, cost) values
  ('image2_t2i',10),('image2_i2i',10),('nano_t2i',10),('nano_i2i',10)
on conflict (type) do nothing;

-- 3. 生图记录
create table if not exists generation_logs (
  id uuid primary key default gen_random_uuid(),
  task_id text unique not null,   -- 多米 task_id（gpt 称 id），唯一约束防止同一任务重复预扣/返还
  user_id uuid references users(id),
  method text not null,           -- image2_t2i|image2_i2i|nano_t2i|nano_i2i
  prompt text,
  ref_images jsonb,              -- URL 数组，图生图可选
  result_image text,             -- 多米返回 URL（约 5 天过期，不落盘）
  cost integer not null default 0,
  status text not null,          -- success | fail
  oversea boolean default false,
  params jsonb,                  -- 比例/尺寸/数量等留痕
  created_at timestamptz not null default now()
);
create unique index if not exists uniq_generation_task_id on generation_logs(task_id);
create index if not exists idx_generation_user on generation_logs(user_id);
create index if not exists idx_generation_created on generation_logs(created_at desc);

-- 4. 操作日志
create table if not exists operation_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references users(id),
  action text not null,   -- create_user|freeze|unfreeze|reset_pwd|delete_user|adjust_credit|update_pricing
  target_type text,       -- user | pricing
  target_id text,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists idx_operation_created on operation_logs(created_at desc);

-- 5. 积分 RPC（行锁原子，防并发超额 / 防重复预扣）
-- 预扣：提交时调用，余额不足抛 insufficient_balance
create or replace function deduct_points(p_user uuid, p_amount integer)
returns void language plpgsql as $$
declare
  v_balance integer;
begin
  select balance into v_balance from users where id = p_user for update;
  if v_balance is null then
    raise exception 'user_not_found';
  end if;
  if v_balance < p_amount then
    raise exception 'insufficient_balance';
  end if;
  update users set balance = balance - p_amount where id = p_user;
end;
$$;

-- 返还：失败/部分失败时调用
create or replace function refund_points(p_user uuid, p_amount integer)
returns void language plpgsql as $$
begin
  update users set balance = balance + p_amount where id = p_user;
end;
$$;
