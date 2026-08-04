#!/usr/bin/env node
import { parseGlobal } from '../src/util.js';
import { loadAuth, saveAuth } from '../src/auth.js';
import { Client } from '../src/client.js';
import loginCmd from '../src/commands/login.js';
import genCmd from '../src/commands/gen.js';
import planCmd from '../src/commands/plan.js';
import statusCmd from '../src/commands/status.js';
import creditsCmd from '../src/commands/credits.js';
import recordsCmd from '../src/commands/records.js';

const COMMANDS = {
  login: loginCmd,
  gen: genCmd,
  plan: planCmd,
  status: statusCmd,
  credits: creditsCmd,
  records: recordsCmd,
};

const HELP = `imgcli - Rui 生图平台命令行客户端 (零依赖)

用法:
  imgcli <command> [options]

命令:
  login <手机号> [密码]     账号密码登录，token 存本地 (~/.imgcli/config.json)
  gen "提示词"              生图（--engine image2|nano --mode t2i|i2i --size --quality --ref --wait --max-cost）
  plan                      详情图策划（--name --category --points --style --platform --brand --image --thinking）
  status <task_id>          查生图任务（--wait 轮询至终态）
  credits                  查剩余积分（走 /api/me）
  records                  我的生图/策划记录（--limit）

全局选项:
  --json                   输出纯 JSON（agent 友好，退出码 0 成功 / 非0 失败）
  --base-url <url>         覆盖 API 地址（默认读 IMGCLI_BASE_URL 或本地配置）
  --help, -h               显示本帮助

环境变量:
  IMGCLI_BASE_URL          平台 API 地址
  IMGCLI_TOKEN             直接指定 JWT（跳过 login）

示例:
  imgcli --base-url https://your.iga-pages.com login 13800138000 mypassword
  imgcli credits --json
  imgcli gen "一只戴墨镜的猫" --engine nano --wait --json
  imgcli plan --name 保温杯 --category 家居 --points "保温24h,一键开盖" --json
`;

async function main() {
  const { args, global } = parseGlobal(process.argv.slice(2));
  if (global.help || args.length === 0) {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }
  const cmd = args[0];
  const rest = args.slice(1);
  const handler = COMMANDS[cmd];
  if (!handler) {
    process.stderr.write(`未知命令: ${cmd}\n\n${HELP}\n`);
    process.exit(2);
  }
  const auth = loadAuth();
  const baseUrl = global.baseUrl || process.env.IMGCLI_BASE_URL || auth.baseUrl || '';
  if (!baseUrl && cmd !== 'login') {
    process.stderr.write('未配置 API 地址。请先设置 IMGCLI_BASE_URL 环境变量，或用 imgcli --base-url <url> login ...\n');
    process.exit(3);
  }
  const client = new Client({ baseUrl, token: process.env.IMGCLI_TOKEN || auth.token, cookie: process.env.IMGCLI_COOKIE || auth.cookie });
  const ctx = { client, auth, global, saveAuth };
  try {
    const result = await handler(rest, ctx);
    if (global.json) {
      process.stdout.write(JSON.stringify(result.data ?? result, null, 2) + '\n');
    } else if (result.text) {
      process.stdout.write(result.text + '\n');
    }
    process.exit(result.code ?? 0);
  } catch (e) {
    if (global.json) {
      process.stdout.write(JSON.stringify({ error: e.message }, null, 2) + '\n');
    } else {
      process.stderr.write('错误: ' + e.message + '\n');
    }
    process.exit(1);
  }
}

main();
