const VALID_METHODS = ['image2_t2i', 'image2_i2i', 'nano_t2i', 'nano_i2i'];

export function isValidMethod(m) {
  return VALID_METHODS.includes(m);
}

// 平台 REST 接口的 HTTP 客户端封装（纯 fetch，零依赖）
export class Client {
  constructor({ baseUrl, token, cookie } = {}) {
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.token = token || '';
    this.cookie = cookie || '';
  }

  setToken(token) { this.token = token || ''; }
  setCookie(cookie) { this.cookie = cookie || ''; }

  _headers(json = true) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (this.token) h['Authorization'] = 'Bearer ' + this.token;
    if (this.cookie) h['Cookie'] = this.cookie;
    return h;
  }

  async _req(method, path, body, raw = false) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: this._headers(!raw),
      body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)),
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) {
      const msg = json?.msg || json?.error?.message || ('HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  health() { return this._req('GET', '/api/health'); }
  login(phone, password) { return this._req('POST', '/api/login', { phone, password }); }
  me() { return this._req('GET', '/api/me'); }
  generate(payload) { return this._req('POST', '/api/generate', payload); }
  status(taskId) { return this._req('POST', '/api/status', { task_id: taskId }); }
  planner(payload) { return this._req('POST', '/api/planner', payload); }
  plannerAnalyze(payload) { return this._req('POST', '/api/planner/analyze', payload); }
  uploadRef(filename, contentBase64) { return this._req('POST', '/api/upload-ref', { filename, contentBase64 }); }
  myLogs(limit) { return this._req('GET', '/api/my/logs?limit=' + (limit || 20)); }

  // ===== 管理端（需 admin 角色，后端 adminRequired 强制校验）=====
  adminUsers() { return this._req('GET', '/api/admin/users'); }
  adminCreateUser(payload) { return this._req('POST', '/api/admin/users', payload); }
  adminUpdateUser(id, payload) { return this._req('PUT', '/api/admin/users/' + id, payload); }
  adminDeleteUser(id) { return this._req('DELETE', '/api/admin/users/' + id); }
  adminPricing() { return this._req('GET', '/api/admin/pricing'); }
  adminUpdatePricing(type, cost) { return this._req('PUT', '/api/admin/pricing/' + type, { cost }); }
  adminCredits() { return this._req('GET', '/api/admin/credits'); }
  adminLogsGen(qs = {}) {
    const p = new URLSearchParams();
    ['type', 'status', 'method', 'user_id', 'days'].forEach((k) => { if (qs[k]) p.set(k, qs[k]); });
    const s = p.toString();
    return this._req('GET', '/api/admin/logs/generation' + (s ? '?' + s : ''));
  }
  adminLogsOp() { return this._req('GET', '/api/admin/logs/operation'); }
  adminDashboard() { return this._req('GET', '/api/admin/dashboard'); }
  adminStats() { return this._req('GET', '/api/admin/stats'); }
  adminConfigGet() { return this._req('GET', '/api/admin/config'); }
  adminConfigSet(plannerEnabled) { return this._req('PUT', '/api/admin/config', { planner_enabled: !!plannerEnabled }); }
}
