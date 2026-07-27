// Rui生图 · 前端 SPA（原生 JS + hash 路由）
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = { token: localStorage.getItem('token'), user: null, refItems: [], pollQueue: new Set(), pollTimer: null };

// ---------- 请求封装 ----------
async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const r = await fetch(path, Object.assign({ headers }, opts));
  if (r.status === 401) { logout(); throw new Error('登录已过期，请重新登录'); }
  const j = await r.json().catch(() => ({ code: r.status, msg: '响应解析失败' }));
  return { status: r.status, body: j };
}
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body) });

function logout() {
  state.token = null; state.user = null;
  localStorage.removeItem('token');
  location.hash = '#/login';
  route();
}
async function refreshBalance() {
  try {
    const { body } = await api('/api/me');
    if (body.code === 200 && state.user) {
      state.user.balance = body.data.balance;
      $('#hdr-balance').textContent = body.data.balance;
    }
  } catch (_) {}
}

// ---------- 路由 ----------
function route() {
  const h = location.hash || '#/login';
  const loggedIn = !!state.token;
  $('#app-header').style.display = loggedIn ? 'flex' : 'none';
  $('#view-login').style.display = (!loggedIn && h === '#/login') ? 'block' : 'none';
  $('#view-user').style.display = (loggedIn && h === '#/user') ? 'block' : 'none';
  $('#view-admin').style.display = (loggedIn && h === '#/admin') ? 'block' : 'none';

  if (loggedIn && state.user) {
    $('#hdr-phone').textContent = state.user.phone;
    $('#hdr-balance').textContent = state.user.balance;
    $('#hdr-role').textContent = state.user.role === 'admin' ? '管理员' : '用户';
    $('#btn-to-user').style.display = (h !== '#/user') ? 'inline-block' : 'none';
    $('#btn-to-admin').style.display = (state.user.role === 'admin' && h !== '#/admin') ? 'inline-block' : 'none';
    const vt = $('#hdr-view-tag');
    vt.style.display = 'inline-block';
    vt.textContent = h === '#/admin' ? '管理端' : '用户端';
  } else {
    $('#hdr-view-tag').style.display = 'none';
  }
  if (loggedIn && h === '#/admin' && state.user?.role === 'admin') loadAdminAll();
}

// ---------- 登录 ----------
$('#btn-login').addEventListener('click', async () => {
  const phone = $('#login-phone').value.trim();
  const password = $('#login-pwd').value;
  const msg = $('#login-msg'); msg.className = 'msg';
  if (!phone || !password) { msg.textContent = '请输入手机号和密码'; msg.classList.add('err'); return; }
  try {
    const { body } = await post('/api/login', { phone, password });
    if (body.code !== 200) { msg.textContent = body.msg; msg.classList.add('err'); return; }
    state.token = body.data.token; state.user = { phone: body.data.phone, role: body.data.role, balance: body.data.balance };
    localStorage.setItem('token', state.token);
    location.hash = '#/user';
    route();
  } catch (e) { msg.textContent = e.message; msg.classList.add('err'); }
});

// ---------- 用户端：控件联动 ----------
function syncUserControls() {
  const engine = $('#sel-engine').value;
  const mode = $('#sel-mode').value;
  $('#param-image2').style.display = engine === 'image2' ? 'block' : 'none';
  $('#param-nano').style.display = engine === 'nano' ? 'block' : 'none';
  $('#ref-zone').style.display = mode === 'i2i' ? 'block' : 'none';
}
$('#sel-engine').addEventListener('change', syncUserControls);
$('#sel-mode').addEventListener('change', syncUserControls);
$$('#mode-cards .mode-card').forEach(card => {
  card.addEventListener('click', () => {
    $$('#mode-cards .mode-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    $('#sel-mode').value = card.dataset.mode;
    syncUserControls();
  });
});
$('#inp-prompt').addEventListener('input', () => { $('#prompt-count').textContent = $('#inp-prompt').value.length; });
$('#inp-count').addEventListener('input', () => { $('#count-label').textContent = $('#inp-count').value + ' 张'; });
$('#btn-clear-results').addEventListener('click', () => { $('#result-grid').innerHTML = ''; });
syncUserControls();

// 参考图上传（点击 + 拖拽）
const refDrop = $('#ref-drop');
const inpRef = $('#inp-ref');
refDrop.addEventListener('click', () => inpRef.click());
refDrop.addEventListener('dragover', (e) => { e.preventDefault(); refDrop.classList.add('dragover'); });
refDrop.addEventListener('dragleave', () => refDrop.classList.remove('dragover'));
refDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  refDrop.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleRefFiles(e.dataTransfer.files);
});
inpRef.addEventListener('change', (e) => { if (e.target.files.length) handleRefFiles(e.target.files); });
async function handleRefFiles(fileList) {
  const files = [...fileList].slice(0, 10 - state.refItems.length);
  for (const f of files) {
    const b64 = await fileToBase64(f);
    const { body } = await post('/api/upload-ref', { filename: f.name, contentBase64: b64 });
    if (body.code === 200) {
      state.refItems.push({ url: body.data.url, path: body.data.path, name: f.name });
      renderRefs();
    } else {
      alert('上传失败：' + body.msg);
    }
  }
  inpRef.value = '';
}
function fileToBase64(f) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.readAsDataURL(f);
  });
}
function renderRefs() {
  const box = $('#ref-list'); box.innerHTML = '';
  state.refItems.forEach((it, i) => {
    const d = document.createElement('div'); d.className = 'ref-item';
    d.innerHTML = `<img src="${it.url}"><span class="x" data-i="${i}">×</span>`;
    box.appendChild(d);
  });
  $$('#ref-list .x').forEach(x => x.addEventListener('click', () => {
    state.refItems.splice(+x.dataset.i, 1); renderRefs();
  }));
}

// ---------- 生成 + 轮询 ----------
$('#btn-generate').addEventListener('click', async () => {
  const btn = $('#btn-generate'); const msg = $('#gen-msg'); msg.className = 'msg';
  const engine = $('#sel-engine').value, mode = $('#sel-mode').value;
  const method = `${engine}_${mode}`;
  const prompt = $('#inp-prompt').value.trim();
  if (!prompt) { msg.textContent = '请输入提示词'; msg.classList.add('err'); return; }

  const payload = { method, prompt };
  if (engine === 'image2') {
    const size = $('#sel-size').value, quality = $('#sel-quality').value;
    if (size) payload.size = size;
    if (quality) payload.quality = quality;
    payload.oversea = $('#chk-oversea').checked;
  } else {
    payload.aspect_ratio = $('#sel-aspect').value;
    payload.image_size = $('#sel-imgsize').value;
    payload.model = $('#sel-nano-model').value;
  }
  if (mode === 'i2i') {
    if (state.refItems.length === 0) { msg.textContent = '图生图请先上传参考图'; msg.classList.add('err'); return; }
    payload.image_urls = state.refItems.map(r => r.url);
    payload.ref_paths = state.refItems.map(r => r.path);
  }

  const N = +$('#inp-count').value;
  btn.disabled = true;
  for (let i = 0; i < N; i++) {
    try {
      const { body } = await post('/api/generate', payload);
      if (body.code !== 200) { msg.textContent = '第' + (i + 1) + '张失败：' + body.msg; msg.classList.add('err'); break; }
      addCard(body.data.task_id, payload.prompt);
      state.pollQueue.add(body.data.task_id);
    } catch (e) { msg.textContent = e.message; msg.classList.add('err'); break; }
  }
  startPoll();
});

function addCard(taskId, prompt) {
  const grid = $('#result-grid');
  const c = document.createElement('div'); c.className = 'result-item'; c.dataset.task = taskId; c.dataset.prompt = prompt || '';
  c.innerHTML = `<button class="res-close" title="移除">×</button><div class="res-status">排队中…</div><img style="display:none">`;
  c.querySelector('.res-close').addEventListener('click', (e) => { e.stopPropagation(); c.remove(); });
  c.addEventListener('click', () => {
    const img = c.querySelector('img');
    if (img && img.src && img.style.display !== 'none') openPreview(img.src, c.dataset.prompt);
  });
  grid.prepend(c);
}
function updateCard(taskId, data) {
  const c = $(`.result-item[data-task="${taskId}"]`); if (!c) return;
  const st = c.querySelector('.res-status');
  const img = c.querySelector('img');
  if (data.status === 'running') { st.textContent = '生成中…'; }
  else if (data.status === 'success') {
    st.textContent = '完成' + (data.cost ? ' · ' + data.cost + '积分' : '');
    st.classList.add('ok');
    img.src = data.url; img.style.display = 'block';
    c.dataset.url = data.url;
    refreshBalance();
  } else if (data.status === 'fail') {
    st.textContent = '失败（已返还）';
    st.classList.add('fail');
  }
}
function openPreview(url, prompt) {
  if (!url) return;
  $('#preview-img').src = url;
  $('#preview-prompt').textContent = prompt || '无提示词';
  $('#preview-download').dataset.url = url;
  $('#preview-modal').style.display = 'flex';
}
function closePreview() { $('#preview-modal').style.display = 'none'; }
$('#preview-close').addEventListener('click', closePreview);
$('#preview-modal').addEventListener('click', (e) => { if (e.target === $('#preview-modal')) closePreview(); });
$('#preview-copy').addEventListener('click', async () => {
  const t = $('#preview-prompt').textContent;
  try { await navigator.clipboard.writeText(t); alert('提示词已复制'); } catch (_) { alert('复制失败，请手动复制'); }
});
async function downloadImage(url, filename) {
  if (!url) return;
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error('fetch failed');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'Rui生图-' + new Date().toISOString().slice(0, 10) + '.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (_) {
    window.open(url, '_blank');
  }
}
$('#preview-download').addEventListener('click', () => {
  const url = $('#preview-download').dataset.url;
  downloadImage(url);
});
function startPoll() { if (!state.pollTimer) state.pollTimer = setInterval(pollTick, 4000); }
async function pollTick() {
  const ids = [...state.pollQueue];
  for (const tid of ids) {
    try {
      const { body } = await post('/api/status', { task_id: tid });
      if (body.code === 200) {
        updateCard(tid, body.data);
        if (body.data.status !== 'running') state.pollQueue.delete(tid);
      }
    } catch (_) {}
  }
  if (state.pollQueue.size === 0) { clearInterval(state.pollTimer); state.pollTimer = null; }
  $('#btn-generate').disabled = state.pollQueue.size > 0;
}

// ---------- 管理端 ----------
const METHOD_META = {
  image2_t2i: { name: 'image2 文生图', engine: 'GPT Image 2', note: '真实成本约 ¥0.04/次' },
  image2_i2i: { name: 'image2 图生图', engine: 'GPT Image 2', note: '带参考图，略高于文生图' },
  nano_t2i: { name: 'nano 文生图', engine: 'Nano Banana', note: '真实成本约 ¥0.07/次' },
  nano_i2i: { name: 'nano 图生图', engine: 'Nano Banana', note: '支持多张参考图（最多10张）' },
};
const mName = (m) => METHOD_META[m]?.name || m;
const STATUS_BADGE = {
  success: '<span class="badge ok">成功</span>',
  fail: '<span class="badge fail">失败</span>',
  pending: '<span class="badge run">进行中</span>',
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

let adminPage = 'dash';
const adminLoaders = {
  dash: loadDash, accounts: loadUsers, credits: loadCredits,
  pricing: loadPricing, records: loadGenLogs, oplogs: loadOpLogs, stats: loadStats,
};
function showAdminPage(name) {
  adminPage = name;
  $$('#admin-nav .nav-item').forEach(x => x.classList.toggle('active', x.dataset.page === name));
  $$('.apage').forEach(p => p.style.display = 'none');
  $('#apage-' + name).style.display = 'block';
  (adminLoaders[name] || (() => {}))();
}
$$('#admin-nav .nav-item').forEach(item =>
  item.addEventListener('click', () => showAdminPage(item.dataset.page)));
function loadAdminAll() { showAdminPage(adminPage); }

function mkBtn(label, fn, cls = 'btn-sm') { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = fn; return b; }

// ----- 仪表盘 -----
async function loadDash() {
  const { body } = await api('/api/admin/dashboard');
  if (body.code !== 200) return;
  const d = body.data;
  $('#dash-cards').innerHTML = `
    <div class="stat-card"><div class="label">总消耗积分</div><div class="num">${d.total_cost.toLocaleString()}<small>分</small></div></div>
    <div class="stat-card"><div class="label">累计生成</div><div class="num">${d.total_count.toLocaleString()}<small>次</small></div></div>
    <div class="stat-card"><div class="label">活跃用户</div><div class="num">${d.active_users}<small>/${d.total_users} 人</small></div></div>
    <div class="stat-card"><div class="label">本月失败率</div><div class="num">${d.month_fail_rate}<small>%</small></div></div>`;
  const max = Math.max(1, ...d.trend.map(t => t.total));
  $('#dash-trend').innerHTML = d.trend.map(t => {
    const wg = Math.round((t.image2 / max) * 100);
    const wn = Math.round((t.nano / max) * 100);
    return `<div class="bar-row"><div class="name">${t.label}</div><div class="bar-track">
      ${t.image2 ? `<div class="bar-fill fill-gpt" style="width:${wg}%">${t.image2}</div>` : ''}
      ${t.nano ? `<div class="bar-fill fill-nano" style="width:${wn}%">${t.nano}</div>` : ''}
    </div><div class="val">${t.total} 次</div></div>`;
  }).join('');
}

// ----- 账户管理 -----
$('#btn-toggle-create').addEventListener('click', () => {
  const box = $('#create-box');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
});
$('#btn-cancel-create').addEventListener('click', () => { $('#create-box').style.display = 'none'; });
$('#btn-newuser').addEventListener('click', async () => {
  const msg = $('#nu-msg'); msg.className = 'msg';
  const phone = $('#nu-phone').value.trim();
  const pwd = $('#nu-pwd').value, pwd2 = $('#nu-pwd2').value;
  if (!/^1\d{10}$/.test(phone)) { msg.textContent = '请输入 11 位手机号'; msg.classList.add('err'); return; }
  if (!pwd) { msg.textContent = '请设置密码'; msg.classList.add('err'); return; }
  if (pwd !== pwd2) { msg.textContent = '两次密码不一致'; msg.classList.add('err'); return; }
  const { body } = await post('/api/admin/users', {
    phone, password: pwd, balance: +($('#nu-balance').value || 0), role: $('#nu-role').value,
  });
  if (body.code !== 200) { msg.textContent = body.msg; msg.classList.add('err'); return; }
  msg.textContent = '创建成功'; msg.classList.add('ok');
  $('#nu-phone').value = ''; $('#nu-pwd').value = ''; $('#nu-pwd2').value = ''; $('#nu-balance').value = '0';
  loadUsers();
});

async function loadUsers() {
  const { body } = await api('/api/admin/users');
  if (body.code !== 200) return;
  $('#user-count').textContent = `共 ${body.data.length} 人`;
  const tb = $('#user-table tbody'); tb.innerHTML = '';
  body.data.forEach(u => {
    const tr = document.createElement('tr');
    const frozen = u.status === 'frozen';
    const isAdmin = u.role === 'admin';
    tr.innerHTML = `<td>${esc(u.phone)}</td>
      <td><span class="badge role">${u.role}</span></td>
      <td>${frozen ? '<span class="badge dis">已冻结</span>' : '<span class="badge ok">正常</span>'}</td>
      <td>${isAdmin ? '∞' : u.balance}</td>
      <td class="td-muted">${(u.created_at || '').slice(0, 10)}</td><td class="ops"></td>`;
    const ops = tr.querySelector('.ops');
    if (!isAdmin) {
      ops.appendChild(mkBtn(frozen ? '启用' : '冻结', () => userAction(u.id, frozen ? 'unfreeze' : 'freeze'), frozen ? 'btn-sm' : 'btn-sm warn'));
      ops.appendChild(mkBtn('重置密码', () => {
        const p = prompt('输入新密码'); if (p) userAction(u.id, 'reset_pwd', { password: p });
      }, 'btn-sm ghost'));
      ops.appendChild(mkBtn('删除', () => { if (confirm(`确认删除 ${u.phone}？（软删除，记录保留）`)) userDel(u.id); }, 'btn-sm danger'));
    } else {
      ops.innerHTML = '<span class="td-muted">—</span>';
    }
    tb.appendChild(tr);
  });
}
async function userAction(id, action, extra = {}) {
  const { body } = await api('/api/admin/users/' + id, { method: 'PUT', body: JSON.stringify({ action, ...extra }) });
  if (body.code !== 200) alert(body.msg || '失败');
  loadUsers();
}
async function userDel(id) {
  const { body } = await api('/api/admin/users/' + id, { method: 'DELETE' });
  if (body.code !== 200) alert(body.msg || '失败');
  loadUsers();
}

// ----- 积分管理 -----
let adjustTarget = null;
async function loadCredits() {
  const { body } = await api('/api/admin/credits');
  if (body.code !== 200) return;
  const tb = $('#credit-table tbody'); tb.innerHTML = '';
  body.data.forEach(u => {
    const tr = document.createElement('tr');
    const isAdmin = u.role === 'admin';
    tr.innerHTML = `<td>${esc(u.phone)}${isAdmin ? '（管理员）' : ''}</td>
      <td>${isAdmin ? '∞' : u.balance}</td>
      <td>${isAdmin ? '—' : u.month_cost}</td><td class="ops"></td>`;
    const ops = tr.querySelector('.ops');
    if (!isAdmin) ops.appendChild(mkBtn('调整', () => openAdjust(u)));
    else ops.innerHTML = '<span class="td-muted">—</span>';
    tb.appendChild(tr);
  });
}
function openAdjust(u) {
  adjustTarget = u;
  $('#adj-phone').textContent = u.phone;
  $('#adj-balance').textContent = u.balance;
  $('#adj-amount').value = ''; $('#adj-remark').value = '';
  $('#adj-msg').className = 'msg'; $('#adj-msg').textContent = '';
  $('#adjust-modal').style.display = 'flex';
}
function closeAdjust() { $('#adjust-modal').style.display = 'none'; adjustTarget = null; }
$('#adjust-close').addEventListener('click', closeAdjust);
$('#adj-cancel').addEventListener('click', closeAdjust);
$('#adjust-modal').addEventListener('click', (e) => { if (e.target === $('#adjust-modal')) closeAdjust(); });
$('#adj-ok').addEventListener('click', async () => {
  if (!adjustTarget) return;
  const msg = $('#adj-msg'); msg.className = 'msg';
  const n = Math.abs(+$('#adj-amount').value);
  if (!n) { msg.textContent = '请输入正确的数额'; msg.classList.add('err'); return; }
  const delta = $('#adj-type').value === 'sub' ? -n : n;
  const { body } = await api('/api/admin/users/' + adjustTarget.id, {
    method: 'PUT',
    body: JSON.stringify({ action: 'adjust_credit', delta, remark: $('#adj-remark').value.trim() }),
  });
  if (body.code !== 200) { msg.textContent = body.msg || '失败'; msg.classList.add('err'); return; }
  closeAdjust(); loadCredits();
});

// ----- 计费规则 -----
async function loadPricing() {
  const { body } = await api('/api/admin/pricing');
  if (body.code !== 200) return;
  const tb = $('#pricing-table tbody'); tb.innerHTML = '';
  const order = ['image2_t2i', 'image2_i2i', 'nano_t2i', 'nano_i2i'];
  body.data.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  body.data.forEach(r => {
    const meta = METHOD_META[r.type] || { name: r.type, engine: '-', note: '' };
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${meta.name}</td><td class="td-muted">${meta.engine}</td>
      <td><input class="finput" type="number" min="0" value="${r.cost}" style="max-width:90px"></td>
      <td class="td-muted">${meta.note}</td><td></td>`;
    const inp = tr.querySelector('input');
    tr.querySelector('td:last-child').appendChild(mkBtn('保存', async () => {
      const { body: b2 } = await api('/api/admin/pricing/' + r.type, { method: 'PUT', body: JSON.stringify({ cost: +inp.value }) });
      if (b2.code !== 200) alert(b2.msg || '失败');
      loadPricing();
    }));
    tb.appendChild(tr);
  });
}

// ----- 生图记录 -----
let genLogCache = [];
async function loadFilterUsers() {
  const sel = $('#flt-user');
  if (sel.options.length > 1) return;
  const { body } = await api('/api/admin/users');
  if (body.code !== 200) return;
  body.data.forEach(u => {
    const o = document.createElement('option');
    o.value = u.id; o.textContent = u.phone;
    sel.appendChild(o);
  });
}
async function loadGenLogs() {
  loadFilterUsers();
  const qs = new URLSearchParams();
  if ($('#flt-user').value) qs.set('user_id', $('#flt-user').value);
  if ($('#flt-method').value) qs.set('method', $('#flt-method').value);
  if ($('#flt-status').value) qs.set('status', $('#flt-status').value);
  if ($('#flt-days').value) qs.set('days', $('#flt-days').value);
  const { body } = await api('/api/admin/logs/generation?' + qs.toString());
  if (body.code !== 200) return;
  genLogCache = body.data;
  const tb = $('#genlog-table tbody'); tb.innerHTML = '';
  body.data.forEach(g => {
    const tr = document.createElement('tr');
    const refs = Array.isArray(g.ref_images) && g.ref_images.length
      ? `<span class="thumb-ph">参×${g.ref_images.length}</span>` : '<span class="td-muted">—</span>';
    const result = g.result_image
      ? `<img class="thumb-img" src="${esc(g.result_image)}" onerror="this.outerHTML='<span class=&quot;thumb-ph&quot;>过期</span>'" data-url="${esc(g.result_image)}" data-prompt="${esc(g.prompt || '')}">`
      : '<span class="td-muted">无</span>';
    tr.innerHTML = `<td><span class="user-cell"><svg class="user-ico"><use href="#i-user"/></svg>${esc(g.phone)}</span></td><td class="td-muted">${mName(g.method)}</td>
      <td class="td-muted prompt-cell" title="${esc(g.prompt)}">${esc((g.prompt || '').slice(0, 40))}</td>
      <td>${refs}</td><td class="res-cell"></td>
      <td>${g.cost ? '-' + g.cost : 0}</td>
      <td>${STATUS_BADGE[g.status] || esc(g.status)}</td>
      <td class="td-muted">${(g.created_at || '').slice(5, 16).replace('T', ' ')}</td>`;
    tr.querySelector('.res-cell').innerHTML = result;
    const im = tr.querySelector('.thumb-img');
    if (im) im.addEventListener('click', () => openPreview(im.dataset.url, im.dataset.prompt));
    tb.appendChild(tr);
  });
  $('#record-count').textContent = `共 ${body.data.length} 条记录`;
}
$('#btn-filter').addEventListener('click', loadGenLogs);
$('#btn-export').addEventListener('click', () => {
  if (!genLogCache.length) { alert('无可导出数据'); return; }
  const head = ['用户', '方式', '提示词', '参考图数', '结果图URL', '扣分', '状态', '时间'];
  const lines = [head.join(',')].concat(genLogCache.map(g => [
    g.phone, mName(g.method), '"' + (g.prompt || '').replace(/"/g, '""') + '"',
    Array.isArray(g.ref_images) ? g.ref_images.length : 0,
    g.result_image || '', g.cost, g.status, g.created_at,
  ].join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '生图记录-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click(); URL.revokeObjectURL(a.href);
});

// ----- 操作日志 -----
const ACTION_NAME = {
  create_user: '创建账户', freeze: '冻结账户', unfreeze: '启用账户',
  reset_pwd: '重置密码', delete_user: '删除账户', adjust_credit: '调整积分', update_pricing: '修改计费',
};
async function loadOpLogs() {
  const { body } = await api('/api/admin/logs/operation');
  if (body.code !== 200) return;
  const tb = $('#oplog-table tbody'); tb.innerHTML = '';
  body.data.forEach(o => {
    const target = o.target_type === 'pricing' ? '计费规则' : (o.target_phone || o.target_id || '');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="td-muted">${(o.created_at || '').slice(5, 16).replace('T', ' ')}</td>
      <td>${esc(o.admin_phone || '')}</td>
      <td>${ACTION_NAME[o.action] || esc(o.action)}</td>
      <td>${esc(target)}</td><td class="td-muted">${esc(o.detail || '')}</td>`;
    tb.appendChild(tr);
  });
}

// ----- 使用统计 -----
async function loadStats() {
  const { body } = await api('/api/admin/stats');
  if (body.code !== 200) return;
  const d = body.data;
  $('#stats-cards').innerHTML = `
    <div class="stat-card"><div class="label">总消耗</div><div class="num">${d.total_cost.toLocaleString()}<small>分</small></div></div>
    <div class="stat-card"><div class="label">总生成次数</div><div class="num">${d.total_count.toLocaleString()}<small>次</small></div></div>
    <div class="stat-card"><div class="label">平均单次成本</div><div class="num">${d.avg_cost}<small>分</small></div></div>
    <div class="stat-card"><div class="label">成功 / 失败</div><div class="num">${d.success} / ${d.fail}</div></div>`;
  const maxC = Math.max(1, ...d.methods.map(m => m.count));
  $('#stats-methods').innerHTML = d.methods.map(m => `
    <div class="bar-row"><div class="name">${mName(m.method)}</div>
      <div class="bar-track"><div class="bar-fill fill-gpt" style="width:${Math.max(6, Math.round((m.count / maxC) * 100))}%">${m.count} 次</div></div>
      <div class="val">${m.cost.toLocaleString()} 分</div></div>`).join('') || '<div class="td-muted">暂无数据</div>';
  $('#stats-ranking').innerHTML = d.ranking.map((r, i) => `
    <div class="rank"><div class="no ${i < 3 ? 'top' : ''}">${i + 1}</div>
      <div class="who">${esc(r.phone)}</div><div class="score">${r.cost.toLocaleString()} 分</div></div>`).join('') || '<div class="td-muted">暂无消耗记录</div>';
}

// ---------- 顶栏按钮 ----------
$('#btn-to-user').addEventListener('click', () => { location.hash = '#/user'; route(); });
$('#btn-to-admin').addEventListener('click', () => { location.hash = '#/admin'; route(); });
$('#btn-logout').addEventListener('click', logout);
window.addEventListener('hashchange', route);

// ---------- 启动 ----------
syncUserControls();
if (state.token) {
  // 校验 token 仍有效
  api('/api/me').then(({ body }) => {
    if (body.code === 200) {
      state.user = { phone: body.data.phone, role: body.data.role, balance: body.data.balance };
      location.hash = '#/user'; route();
    } else { logout(); }
  }).catch(() => logout());
} else { route(); }
