// IGA Pages Functions 入口（Node.js 运行时）
// 约定：api/[[default]].js 作为 catch-all，export default app，平台接管监听，勿调 app.listen()
import express from 'express';
import { checkDbConfig } from './db.js';
import { login, me, authRequired, adminRequired, seedAdmin } from './auth.js';
import { generate } from './generate.js';
import { statusQuery } from './status.js';
import { uploadRefHandler } from './storage.js';
import {
  listUsers, createUser, updateUser, deleteUser,
  listPricing, updatePricing, listGenLogs, listOpLogs,
} from './admin.js';

checkDbConfig();

const app = express();
app.use(express.json({ limit: '12mb' }));

// 首次请求自动种子管理员（幂等：已存在则跳过）
let seeded = false;
app.use(async (req, res, next) => {
  if (!seeded) {
    seeded = true;
    seedAdmin().catch((e) => console.error('[seed]', e.message));
  }
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// 公开
app.post('/api/login', login);

// 登录态
app.get('/api/me', authRequired, me);
app.post('/api/generate', authRequired, generate);
app.post('/api/status', authRequired, statusQuery);
app.post('/api/upload-ref', authRequired, uploadRefHandler);

// 管理端（管理员专属）
const admin = express.Router();
admin.use(authRequired, adminRequired);
admin.get('/users', listUsers);
admin.post('/users', createUser);
admin.put('/users/:id', updateUser);
admin.delete('/users/:id', deleteUser);
admin.get('/pricing', listPricing);
admin.put('/pricing/:type', updatePricing);
admin.get('/logs/generation', listGenLogs);
admin.get('/logs/operation', listOpLogs);
app.use('/api/admin', admin);

export default app;
