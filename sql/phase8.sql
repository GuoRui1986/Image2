-- Phase 8：电商详情图提示词策划器 · 增量 Schema
-- 在现有 schema.sql 基础上「增量执行」，不改动已建表/已写入数据
-- 执行方式：火山 Supabase 控制台 SQL Editor 粘贴全部内容执行

-- A. 计费规则：策划器单独计费类型（默认 5 分/次）
insert into pricing_rules (type, cost) values ('detail_planner', 5)
on conflict (type) do nothing;

-- B. 功能开关配置表（键值对，jsonb 存值便于存布尔/数字/对象）
create table if not exists app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into app_config (key, value) values ('planner_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- C. 策划器使用记录（只存元数据，不落提示词全文，节省存储）
create table if not exists planner_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  product_name text,                       -- 商品名
  category text,                           -- 类目
  platform text,                          -- 目标平台（淘宝/京东/小红书…）
  style text,                             -- 目标风格
  brand_color text,                       -- 品牌色/关键词
  thinking boolean not null default false,-- 是否开启深度思考
  has_image boolean not null default false,-- 是否上传了产品图
  cost integer not null default 0,        -- 本次扣分
  status text not null,                   -- success | fail
  created_at timestamptz not null default now()
);
create index if not exists idx_planner_user on planner_logs(user_id);
create index if not exists idx_planner_created on planner_logs(created_at desc);
