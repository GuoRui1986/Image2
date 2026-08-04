# 交接-CLI开发.md —— CLI + Skill 包开发会话必读

> 写于 2026-08-04。本文件是「给生图系统做 CLI + Skill 包，让 agent 能操作这个系统」专项开发的交接。
> 主交接文档见 `交接文档.md`（架构/决策/接口实测）；本文件只讲 CLI 这一块怎么落地，**零侵入现有功能**是铁律。

---

## 0. 一句话背景

生图平台本身是 API 优先架构（前端只是 `api/[[default]].js` 那套 REST 接口的壳）。CLI 无非是给同一套接口再套一个命令行壳；Skill 包是一份教 agent 怎么用 CLI 的说明书。后端业务逻辑一行都不用重写。

**睿哥的硬要求：绝对不能影响现有功能。本文件第三节列了红线文件，碰了就出事。**

---

## 1. 目标产出

| 产物 | 位置 | 说明 |
|---|---|---|
| **CLI 工具** | 项目内 `cli/` 子目录（独立 `package.json`，不污染根 `package.json`） | 命令行客户端，调平台 `/api/*`，让人在终端 / agent 在 shell 里操作生图系统 |
| **Skill 包** | `~/.workbuddy/skills/imgcli/` 一份 `SKILL.md` | 教 WorkBuddy 这类 agent 正确使用 CLI（命令、参数、输出格式、注意事项） |

CLI 是**外部 HTTP 客户端**，与现有 `index.html` / `js/` / `css/` / `api/` 是调用关系，不是包含关系。

---

## 2. 现有真实接口（CLI 要调的就是这些，站在用户视角）

> 来源：已读 `api/[[default]].js` 路由定义（第 1023–1049 行）。CLI **只调平台自有接口，不直连多米/TokenHub**。

### 2.1 鉴权

- 方式：`Authorization: Bearer <JWT>` 或 `x-auth-token: <JWT>`（见 `extractToken`，第 53–59 行）
- 登录：`POST /api/login` body `{phone, password}` → 返回 `{code, data:{token, role, balance, phone}}`
- JWT 有效期：`7d`（`TOKEN_TTL`）；算法 HS256，密钥 `JWT_SECRET` 环境变量
- **CLI 默认用「账号密码登录拿 JWT」即可工作，零后端改动**

### 2.2 用户端接口（需登录）

| 方法 | 路径 | 作用 | 备注 |
|---|---|---|---|
| GET | `/api/health` | 健康检查 | 公开，无鉴权 |
| GET | `/api/me` | 当前用户信息 + 余额 | |
| POST | `/api/generate` | **生图**：image2/nano 文生图/图生图 | 异步，返回 task_id，需轮询 |
| POST | `/api/status` | 轮询生图任务结果 | 传 task_id，拿到图 URL |
| POST | `/api/upload-ref` | 上传参考图（Supabase 临时桶） | 图生图用，返回 URL |
| POST | `/api/planner` | **详情图策划**：商品信息→9 板块提示词 JSON | 调 TokenHub hy3，单独计费 |
| POST | `/api/planner/analyze` | 视觉分析：产品图→卖点/材质（hy-vision） | 传图（base64 或 URL） |
| GET | `/api/planner/status` | 策划任务状态 | |

### 2.3 管理端接口（需 `role=admin` + 登录）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/admin/users` | 用户列表 |
| POST | `/api/admin/users` | 创建用户（手机号+密码+角色+积分） |
| PUT | `/api/admin/users/:id` | 改用户（冻结/解冻/重置密码/积分） |
| DELETE | `/api/admin/users/:id` | 软删除 |
| GET | `/api/admin/pricing` | 计费规则列表 |
| PUT | `/api/admin/pricing/:type` | 改某方式扣分 |
| GET | `/api/admin/logs/generation` | 生图记录 |
| GET | `/api/admin/logs/operation` | 操作日志 |
| GET | `/api/admin/dashboard` | 仪表盘数据 |
| GET | `/api/admin/stats` | 使用统计 |
| GET | `/api/admin/credits` | 积分查询 |
| GET | `/api/admin/config` | 功能开关配置（含 planner_enabled） |
| PUT | `/api/admin/config` | 改功能开关 |

> ⚠️ 管理端命令**建议先不开放给 agent**（涉及删用户、改积分等高危操作）。CLI 可以先只做用户端命令，管理命令留作人工使用。若开放，必须加二次确认 + 危险操作白名单。

---

## 3. 红线文件（绝对不要碰，碰了就可能伤现有功能）

| 文件 / 目录 | 为什么不能动 |
|---|---|
| `api/[[default]].js` 现有 `/api/*` 路由 | 前端 + 已上线功能全靠它。CLI 只调用，不改写 |
| `index.html` / `js/app.js` / `css/style.css` | 现有前端，与 CLI 无关 |
| `sql/schema.sql` 现有表结构 | 只可**追加**新表（如 `api_keys`），不可改现有表 |
| 根 `package.json` 的 `dependencies` | CLI 用自己 `cli/package.json`，别往根依赖塞 CLI 的包 |

**安全做法（推荐）：API Key 鉴权走独立分支，现有路由一行不碰**
- 方案 A（最干净）：在 `api/[[default]].js` 末尾**追加** `app.use('/api/cli/*', cliAuth, cliRouter)`，cliRouter 内部复用现有 `generate`/`plannerHandler` 等函数（import 或直接调用），鉴权用 `X-API-Key` 头查 `api_keys` 表。现有 `/api/*` 路由完全不受影响。
- 方案 B（轻量）：在 `extractToken` 里加一行「若有 `x-api-key` 头则查 `api_keys` 表换 user 上下文」，现有 Bearer 逻辑不变。

**改完后必须验证（隔离回归测试）：**
1. `GET /api/health` 仍返回 `{ok:true}`
2. 浏览器前端登录 + 生一张图，流程无变化
3. 原 JWT 登录的已有用户不受影响

---

## 4. CLI 设计

### 4.1 目录与运行

```
cli/
  package.json        # 独立依赖（commander / node-fetch 或内置 fetch / chalk 可选）
  bin/imgcli.js       # 入口（#!/usr/bin/env node）
  src/
    client.js         # HTTP 客户端：封装 login / generate / status / planner / admin
    auth.js           # token 存 ~/.imgcli/config（或 IMGCLI_API_KEY 环境变量）
    commands/
      gen.js  plan.js  status.js  credits.js  records.js  login.js
      admin/  (可选，高危，默认不暴露给 agent)
    json.js           # --json 全局输出 + 退出码规范
  README.md
```

运行环境：Node 22。开发测试用 managed runtime：
`C:\Users\HUAWEI\.workbuddy\binaries\node\versions\22.22.2\node.exe cli/bin/imgcli.js ...`

### 4.2 命令清单（草案）

```bash
imgcli login <手机号> [密码]          # 账号密码登录，token 存本地；也可 IMGCLI_API_KEY=xxx 跳过
imgcli gen "提示词" --engine image2 --size 1024x1024 --wait
imgcli gen "提示词" --engine nano --ref ./product.jpg --wait     # 图生图
imgcli plan --name "保温杯" --category 家居 --points "保温24h,一键开盖" --json
imgcli status <task_id>              # 查单任务（不带 --wait 时手动查）
imgcli credits                       # 查剩余积分
imgcli records --limit 10 --json     # 我的生图/策划记录
# 管理员（默认不开放给 agent）
imgcli admin user-add / credit-set / pricing ...
```

### 4.3 Agent 友好的四个设计点（人用和 agent 用不一样）

| 设计点 | 做法 |
|---|---|
| **`--json` 全局输出** | 每个命令都能输出纯 JSON；agent 要解析，不给花哨进度条。规范退出码：0 成功 / 非 0 失败 |
| **`--wait` 把异步变同步** | 生图是「提交→轮询」两步，CLI 内部封装轮询（轮询间隔建议 2–3s，超时上限 5min），agent 一条命令拿到最终图 URL |
| **预估扣分提示** | 执行前输出「本次预计扣分：image2 文生图 40 分」，agent 可先确认余额 |
| **`--max-cost` 单次上限** | 防止 agent 失控烧积分（如 `imgcli gen ... --max-cost 40`） |

### 4.4 积分护栏（重要，agent 会烧真积分）

- CLI 支持 `--max-cost` 单次上限
- 若做 API Key：`api_keys` 表加 `daily_limit`（日消耗上限），后端在 cliAuth 中间件里统计当日消耗并拦截
- 管理端可看到「API Key 消耗」维度（Phase 9 的统计可顺带覆盖）

---

## 5. Skill 包设计

位置：`~/.workbuddy/skills/imgcli/SKILL.md`（用户级，跨项目可用）

内容要点：
- 这是什么工具、解决什么问题
- 安装 / 鉴权（login 或环境变量）
- 命令速查表（gen / plan / status / credits / records）
- **每个命令的 JSON 输出 schema**（agent 要按 schema 解析）
- 注意事项（积分消耗、--wait 必带、危险命令不开放）
- 典型 agent 工作流示例：「批量给 20 个商品各出一套详情图提示词并生成主图」

> Skill 包是纯文档，不碰任何业务代码，零风险。

---

## 6. API Key 后端改动（可选增强，向后兼容）

仅当要做「长期 key 鉴权」时才动后端，且必须按第三节红线做：

```sql
-- 追加到 schema（不要改现有表）
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  key_hash text not null,          -- 存哈希，不存明文
  name text,
  daily_limit int default 0,       -- 0=不限
  status text default 'active',
  created_at timestamptz default now()
);
```

- 生成 key：随机串，明文只返回一次，库里存 SHA-256
- 鉴权：CLI 带 `X-API-Key: <明文key>` → 后端查 `api_keys` 表（哈希比对）→ 命中则构造 user 上下文，复用现有生图/策划函数
- **现有 `Bearer <JWT>` 路径完全不变**

---

## 7. 不做的事（明确边界）

- ❌ 不复制整套项目来做 CLI（CLI 是外部客户端，复制反而要同步两套）
- ❌ 不改现有 `/api/*` 路由语义（只追加 `/api/cli/*` 分支）
- ❌ 不把管理端高危命令默认开放给 agent
- ❌ 不接自定义通道（CLI 只走现有两种通道：多米 + TokenHub，由后端决定）

---

## 8. 开工指令（新会话第一句话直接粘）

> 读 `交接-CLI开发.md`、`交接文档.md`、`实施计划.md`，在 `E:\workbuddy space\image2作图` 工作区开发「CLI + Skill 包」：
> 1. 在 `cli/` 子目录建独立 Node 包（独立 package.json），实现 login / gen(--wait) / plan / status / credits / records 命令，全部支持 `--json`；
> 2. 默认用账号密码登录拿 JWT（零后端改动即可运行）；
> 3. 写 `~/.workbuddy/skills/imgcli/SKILL.md` 教 agent 使用；
> 4. **绝对不要碰** `api/[[default]].js` 现有 `/api/*` 路由、`index.html`、`js/`、`css/`、`sql/schema.sql` 现有表；
> 5. （可选增强）追加 `api_keys` 表 + `/api/cli/*` 独立鉴权分支，向后兼容；
> 6. 改完跑回归：GET /api/health 正常 + 前端生图流程无变化。
> 验收：终端 `imgcli login ... && imgcli gen "测试" --engine nano --wait --json` 能出图 URL；agent 通过 Skill 能调通 gen/plan。

---

## 9. 本会话约束提醒（给新会话）

- 本工作区的 git **由编码会话统一 push**（触发 IGA 部署）；本 CLI 开发会话只本地 commit，不要 push。
- 文档改动（如本文件）继续本地 commit。
- 真实密钥已在 `.env`（DOMI_KEY / TOKENHUB_KEY），CLI 开发测试可本地用，**勿提交 .env**。
