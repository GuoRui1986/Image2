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
    $('#btn-to-admin').style.display = state.user.role === 'admin' ? 'inline-block' : 'none';
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
$('#inp-count').addEventListener('input', () => { $('#count-label').textContent = $('#inp-count').value + ' 张'; });

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
  c.innerHTML = `<div class="res-status">排队中…</div><div class="copy-prompt">复制提示词</div><img style="display:none">`;
  c.addEventListener('click', () => openPreview(c.dataset.task));
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
function openPreview(taskId) {
  const c = $(`.result-item[data-task="${taskId}"]`); if (!c) return;
  const img = c.querySelector('img');
  if (!img.src || img.style.display === 'none') return;
  $('#preview-img').src = img.src;
  $('#preview-prompt').textContent = c.dataset.prompt || '无提示词';
  $('#preview-modal').style.display = 'flex';
}
function closePreview() { $('#preview-modal').style.display = 'none'; }
$('#preview-close').addEventListener('click', closePreview);
$('#preview-modal').addEventListener('click', (e) => { if (e.target === $('#preview-modal')) closePreview(); });
$('#preview-copy').addEventListener('click', async () => {
  const t = $('#preview-prompt').textContent;
  try { await navigator.clipboard.writeText(t); alert('提示词已复制'); } catch (_) { alert('复制失败，请手动复制'); }
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
function loadAdminAll() { loadUsers(); loadPricing(); loadGenLogs(); loadOpLogs(); }
$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  const name = t.dataset.tab;
  ['users', 'pricing', 'genlogs', 'oplogs'].forEach(n =>
    $('#tab-' + n).style.display = n === name ? 'block' : 'none');
}));

async function loadUsers() {
  const { body } = await api('/api/admin/users');
  if (body.code !== 200) return;
  const tb = $('#user-table tbody'); tb.innerHTML = '';
  body.data.forEach(u => {
    const tr = document.createElement('tr');
    const frozen = u.status === 'frozen';
    tr.innerHTML = `<td>${u.phone}</td><td>${u.role}</td>
      <td class="${frozen ? 'st-frozen' : 'st-active'}">${frozen ? '已冻结' : '正常'}</td>
      <td>${u.balance}</td><td class="ops"></td>`;
    const ops = tr.querySelector('.ops');
    if (u.role !== 'admin') {
      ops.appendChild(mkBtn(frozen ? '解冻' : '冻结', () => userAction(u.id, frozen ? 'unfreeze' : 'freeze')));
      ops.appendChild(mkBtn('改密', () => {
        const p = prompt('输入新密码'); if (p) userAction(u.id, 'reset_pwd', { password: p });
      }));
      ops.appendChild(mkBtn('调积分', () => {
        const d = prompt('积分增减（正加负减，如 100 / -50）'); if (d) userAction(u.id, 'adjust_credit', { delta: +d });
      }));
      ops.appendChild(mkBtn('删除', () => { if (confirm('确认软删除？')) userDel(u.id); }));
    }
    tb.appendChild(tr);
  });
}
function mkBtn(label, fn) { const b = document.createElement('button'); b.className = 'btn-sm'; b.textContent = label; b.onclick = fn; return b; }
async function userAction(id, action, extra = {}) {
  const { body } = await api('/api/admin/users/' + id, { method: 'PUT', body: JSON.stringify({ action, ...extra }) });
  alert(body.msg || (body.code === 200 ? 'ok' : '失败'));
  if (body.code === 200) loadUsers();
}
async function userDel(id) {
  const { body } = await api('/api/admin/users/' + id, { method: 'DELETE' });
  alert(body.msg || (body.code === 200 ? 'ok' : '失败'));
  if (body.code === 200) loadUsers();
}
$('#btn-newuser').addEventListener('click', async () => {
  const phone = prompt('手机号'); if (!phone) return;
  const password = prompt('初始密码'); if (!password) return;
  const balance = prompt('初始积分', '0') || '0';
  const { body } = await post('/api/admin/users', { phone, password, balance: +balance });
  alert(body.msg || (body.code === 200 ? 'ok' : '失败'));
  if (body.code === 200) loadUsers();
});

async function loadPricing() {
  const { body } = await api('/api/admin/pricing');
  if (body.code !== 200) return;
  const tb = $('#pricing-table tbody'); tb.innerHTML = '';
  body.data.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.type}</td><td>${r.cost}</td>
      <td><input type="number" min="0" value="${r.cost}" style="width:90px"></td>
      <td></td>`;
    const inp = tr.querySelector('input');
    const btn = mkBtn('保存', async () => {
      const { body: b2 } = await api('/api/admin/pricing/' + r.type, { method: 'PUT', body: JSON.stringify({ cost: +inp.value }) });
      alert(b2.msg || (b2.code === 200 ? 'ok' : '失败')); if (b2.code === 200) loadPricing();
    });
    tr.querySelector('td:last-child').appendChild(btn);
    tb.appendChild(tr);
  });
}
async function loadGenLogs() {
  const { body } = await api('/api/admin/logs/generation');
  if (body.code !== 200) return;
  const tb = $('#genlog-table tbody'); tb.innerHTML = '';
  body.data.forEach(g => {
    const tr = document.createElement('tr');
    const img = g.result_image ? `<a href="${g.result_image}" target="_blank">查看</a>` : '-';
    tr.innerHTML = `<td>${g.created_at?.slice(0, 19)}</td><td>${g.method}</td>
      <td>${(g.prompt || '').slice(0, 30)}</td><td>${g.cost}</td>
      <td class="${g.status === 'success' ? 'st-active' : (g.status === 'fail' ? 'st-frozen' : '')}">${g.status}</td>
      <td>${img}</td>`;
    tb.appendChild(tr);
  });
}
async function loadOpLogs() {
  const { body } = await api('/api/admin/logs/operation');
  if (body.code !== 200) return;
  const tb = $('#oplog-table tbody'); tb.innerHTML = '';
  body.data.forEach(o => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${o.created_at?.slice(0, 19)}</td><td>${o.action}</td>
      <td>${o.target_type || ''} ${o.target_id || ''}</td><td>${o.detail || ''}</td>`;
    tb.appendChild(tr);
  });
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
