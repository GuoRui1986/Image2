import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const CONFIG_DIR = join(homedir(), '.imgcli');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function loadAuth() {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    // 配置损坏则忽略，回退到空对象
  }
  return { baseUrl: '', token: '', phone: '' };
}

export function saveAuth(partial) {
  const cur = loadAuth();
  const next = { ...cur, ...partial };
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    throw new Error('保存本地配置失败: ' + e.message);
  }
  return next;
}
