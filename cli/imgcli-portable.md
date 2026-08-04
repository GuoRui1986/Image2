# imgcli —— Rui 生图平台命令行客户端（跨平台通用说明）

> 本文档为 imgcli 的**跨平台通用版**，适用于任何支持「运行命令行 / 代码」的 AI 工具或平台（如 Claude Project、GPTs、Coze、Dify、本地 Agent 等）。它与 WorkBuddy 专属的 `SKILL.md` 内容一致，仅去掉了平台专有 frontmatter，并补充了移植说明。
>
> 配套执行文件：本目录下的 `cli/`（零依赖 Node 包）。**知识文档（本文件）+ 执行代码（cli/ 目录）必须一起给对方**，单独一份没法跑。

`imgcli` 是 Rui 生图平台（GPT-IMAGE-2 生图 + 电商详情图提示词策划）的一个轻量命令行壳，调用平台同一套 REST 接口（`https://你的域名/api/*`）。纯 Node 实现、**零第三方依赖**（Node 18+ 全局 `fetch` 即可，无需 `npm install`）。

## 1. 运行环境与位置

- 执行代码是独立的 `cli/` 目录（`package.json` 标记 `type: module`，零 dependencies）。
- 运行：`node cli/bin/imgcli.js <command> [options]`
  - 用你环境中的 Node 可执行文件即可（Node 18+）。Windows 例如 `node.exe cli/bin/imgcli.js ...`；Linux/macOS 例如 `node cli/bin/imgcli.js ...`。
  - 前提是 `cli/` 目录已放到对方机器某个可访问路径，且 `node` 在 PATH 或写明绝对路径。
- 调用示例（请把 `cli/bin/imgcli.js` 换成对方机器上的实际路径）：
  ```
  node /path/to/cli/bin/imgcli.js credits --json
  ```

## 2. 鉴权（两种方式，二选一）

**方式 A：账号密码登录（推荐，零后端改动）**
```
node cli/bin/imgcli.js --base-url https://你的平台地址 login <手机号> <密码>
```
登录成功后 token 存到 `~/.imgcli/config.json`，后续命令自动带。base-url 也会记下来。

**方式 B：环境变量直连（适合 agent / CI / 无交互场景）**
- `IMGCLI_BASE_URL`：平台 API 地址（必填，换成你部署的真实域名，不要带末尾斜杠）
- `IMGCLI_TOKEN`：直接指定 JWT（跳过 login）
- `IMGCLI_COOKIE`：仅当连接 **preview 环境** 时需要（把 preview 链接里的 `iga_token` / `iga_time` 作为 cookie 传入，如 `iga_token=xxx; iga_time=yyy`）

## 3. 命令速查表

| 命令 | 作用 | 关键参数 |
|---|---|---|
| `login <手机号> [密码]` | 登录并存 token | 首次需 `--base-url` 或设 `IMGCLI_BASE_URL` |
| `gen "提示词"` | 生图（异步提交） | `--engine image2\|nano` `--mode t2i\|i2i` `--size 1024x1024` `--quality` `--ref ./图.jpg` `--wait` `--max-cost 40` |
| `plan` | 详情图策划（9 板块提示词） | `--name` `--category` `--points "卖点1,卖点2"` `--style` `--platform 淘宝` `--brand` `--image ./产品图.jpg` `--thinking` |
| `status <task_id>` | 查生图任务 | `--wait`（轮询至终态） |
| `credits` | 查剩余积分 | 走 `/api/me` |
| `records` | 我的生图/策划记录 | `--limit 20` |
| `admin <子命令>` | 管理端命令（需 **admin 角色**，后端强制校验） | 见下方第 3.1 节；**写操作必须追加 `--yes`** |

所有命令均支持全局 `--json`（输出纯 JSON，退出码 0 成功 / 非 0 失败）。

### 3.1 admin 子命令

输入 `node cli/bin/imgcli.js admin` 查看完整帮助。子命令分两类：

**查询类**（直接输出，无需 `--yes`）：

| 子命令 | 作用 | 关键参数 |
|---|---|---|
| `users` | 用户列表 | — |
| `credits` | 积分台账（含本月消耗） | — |
| `pricing` | 计费规则 | — |
| `logs-gen` | 生图/策划日志 | `--user_id` `--method` `--status` `--days` `--type planner` |
| `logs-op` | 操作日志 | — |
| `dashboard` | 运营看板（近 7 日趋势） | — |
| `stats` | 统计报表（引擎分布 + 消耗排行） | — |
| `config-get` | 读取配置（策划器开关） | — |

**写类**（高危，**必须显式 `--yes`**，否则直接拦截报错）：

| 子命令 | 作用 | 关键参数 |
|---|---|---|
| `user-add` | 创建用户 | `--phone` `--password` `--balance 1000` `--role user\|admin` |
| `user-update` | 冻结/解冻/重置密码/调积分 | `--id` `--action freeze\|unfreeze\|reset_pwd\|adjust_credit`（`reset_pwd` 需 `--password`；`adjust_credit` 需 `--delta ±N` 可负，可选 `--remark`） |
| `user-del` | 软删除用户（不可删管理员） | `--id` |
| `pricing-set` | 改计费规则 | `--type` `--cost <数字>` |
| `config-set` | 设策划器开关 | `--value true\|false` |

**admin 示例**
```
# 查用户列表
node cli/bin/imgcli.js admin users
# 创建一个测试用户（积分 1000，必须 --yes）
node cli/bin/imgcli.js admin user-add --phone 18680052872 --password 123456 --balance 1000 --yes
# 给某用户调积分（+100 / -100）
node cli/bin/imgcli.js admin user-update --id 12 --action adjust_credit --delta 100 --yes
# 软删除（会先打印红色警告摘要）
node cli/bin/imgcli.js admin user-del --id 12 --yes
```

**admin JSON 输出**：查询类 `data` 即后端返回的对应数组/对象（`users`→`[{id,phone,balance,role,status,created_at}]`、`credits`→`[{id,phone,role,balance,month_cost}]`、`pricing`→`[{type,cost}]`、`logs-gen`/`logs-op`→数组、`dashboard`/`stats`→聚合对象、`config-get`→`{planner_enabled}`）；写类 `data` 为操作结果（`user-add`→`{id,phone,balance}`、`user-update adjust_credit`→`{balance}` 等）。

## 4. 各命令 JSON 输出 schema（`--json`）

**login** → `data`: `{ token, role, balance, phone }`

**gen（无 --wait）** → `data`: `{ task_id, method, cost, status: "pending" }`
**gen（--wait 成功）** → `data`: `{ task_id, method, cost, status: "success", url }`
**gen（--wait 失败）** → `data`: `{ task_id, method, cost, status: "fail" }`

**plan** → `data`:
```
{
  analysis: string,          // 产品图 AI 分析（传图时）
  reasoning: string,         // 深度思考推理（开 --thinking 时）
  sections: [                // 9 个板块
    { name, prompt, size, model, note,
      copy: { title, subtitle, points: string[] } }
  ]
}
```

**status** → `data`: `{ task_id, status: "success"|"fail"|"running", url?, cost? }`

**credits** → `data`: `{ phone, role, balance }`

**records** → `data`: `{ records: [ { type: "generation"|"planner", title, time, cost, url?, method?, status? } ] }`

## 5. 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 运行错误（网络不可达 / API 返回错误，如 401 未登录、403 功能暂停、积分不足、TOKENHUB 未配置等） |
| 2 | 用法错误（缺必填参数） |
| 3 | 未配置 API 地址（需 `--base-url` / `IMGCLI_BASE_URL`） |
| 4 | 护栏拦截（如 `--max-cost` 超余额） |

解析时：**永远先看退出码**，非 0 则读 stderr / JSON 里的 `error` 字段。

## 6. 注意事项（很重要）

- **积分是真金白银**：`gen` 与 `plan` 都会按平台计费规则扣积分（管理员账号免费）。agent 批量操作前务必先看 `credits`，并用 `--max-cost` 设单次上限防失控。
- **`--wait` 必带才能得到最终图 URL**：生图是「提交→轮询」两步异步。不加 `--wait` 只返回 `task_id`，需再用 `status <task_id> --wait` 取图。
- **图生图用 `--ref`**：传本地图片路径，CLI 自动 `upload-ref` 拿 URL 再提交；`--engine/--mode` 决定 `method`（image2/nano × t2i/i2i）。
- **`plan --image`**：传本地产品图，CLI 读为 base64 调 `/api/planner/analyze` 提炼卖点。
- **admin 子命令现已支持，但属高危操作**：删用户、改积分、改计费、软删等会直接改动生产数据；后端用 `adminRequired` 强制校验 admin 角色，CLI 端再用 `--yes` 做二次确认护栏（`user-del` / `adjust_credit` 还会额外打印红色警告摘要）。agent 自动调用 `admin` 写类命令时，**必须显式带上 `--yes` 且确认参数无误**，否则会被拦截；强烈建议先在 `--json` 下用查询类核对手动确认再执行写类。
- **preview 环境**：连接带 `preview.iga-pages.com` 的地址时，需从链接提取 `iga_token`/`iga_time` 设 `IMGCLI_COOKIE`，否则边缘层返回 401。正式域名部署不需要。

## 7. 典型 agent 工作流

**场景：给一个商品出一套电商主图 + 详情图提示词**
```
# 1. 看余额
node cli/bin/imgcli.js credits --json
# 2. 策划 9 板块提示词（可选传产品图）
node cli/bin/imgcli.js plan --name 保温杯 --category 家居 --points "保温24h,一键开盖,316不锈钢" --platform 淘宝 --json
# 3. 取 sections[0]（主图）的 prompt，直接生图
node cli/bin/imgcli.js gen "<主图 prompt>" --engine image2 --size 800x800 --wait --max-cost 40 --json
# 4. 轮询拿 URL（若上一步没加 --wait）
node cli/bin/imgcli.js status <task_id> --wait --json
```

**场景：批量给 20 个商品各出主图**（伪代码/循环）
```
for each product:
  r = exec('node cli/bin/imgcli.js gen "<prompt>" --engine nano --wait --max-cost 10 --json')
  if r.exit == 0: save(r.data.url)
  else: log(r.data.error or stderr)
```

## 8. 后端依赖（只读，不碰现有功能）

CLI 仅调用平台既有 `/api/*` 接口；`records` 命令额外依赖只读接口 `GET /api/my/logs`（查当前登录用户的生图+策划记录，已在后端以「只追加不改正」原则新增）。现有 `/api/*` 路由语义、前端、数据库现有表均未改动。

---

## 9. 跨平台移植要点（给分发者看）

1. **本文件是「知识层」**：把它整篇贴进目标 AI 工具的「知识库 / 项目说明 / System Instructions」即可让那个 agent 学会怎么调 CLI。
2. **`cli/` 目录是「执行层」**：必须和本文件一起发给对方，放在对方机器任意可访问路径。对方机器需 **Node 18+** 且能访问你部署的 `BASE_URL`。
3. **BASE_URL 必须替换**：本文件里的 `https://你的平台地址` / `https://你的域名` 要换成你实际部署的域名（正式域名，不是 preview 链接）。
4. **能否真的跑起来取决于目标工具是否支持执行命令**：
   - Claude（Project + 启用代码执行 / MCP）、GPTs（Actions / Code Interpreter）、Coze / Dify（工作流节点 / 代码节点）等支持执行命令或函数调用 → 可真跑；
   - 纯聊天 LLM（无代码执行）只能把本文件当「说明文档」给人看，无法自动调用 CLI。
5. **鉴权二选一**：给 agent 用推荐方式 B（设 `IMGCLI_BASE_URL` + `IMGCLI_TOKEN` 环境变量，跳过交互式 login）；正式域名部署不需要 `IMGCLI_COOKIE`。
6. **勿泄露管理员 JWT**：`IMGCLI_TOKEN` 等同账号凭证，仅在私有/可信环境使用。
