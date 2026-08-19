/* =========================================================================
   My Friends - PWA logic
   Storage: IndexedDB (offline, private, on-device)
   Screens: Home, List, Add/Edit, Detail, Search, Reports, Settings
   Lock: PIN gate (Face ID isn't available to web apps; see notes)
   ========================================================================= */

'use strict';

/* ---------------------- IndexedDB data layer ---------------------------- */
const DB_NAME = 'myfriends';
const STORE = 'friends';
let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(mode) { return _db.transaction(STORE, mode).objectStore(STORE); }

function getAll() {
  return new Promise((resolve, reject) => {
    const req = tx('readonly').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
function getOne(id) {
  return new Promise((resolve, reject) => {
    const req = tx('readonly').get(Number(id));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
function putFriend(f) {
  return new Promise((resolve, reject) => {
    const req = tx('readwrite').put(f);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function deleteFriend(id) {
  return new Promise((resolve, reject) => {
    const req = tx('readwrite').delete(Number(id));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ---------------------- Helpers ----------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  });
  kids.flat().forEach((c) => n.append(c && c.nodeType ? c : document.createTextNode(c ?? '')));
  return n;
};
const esc = (s) => (s ?? '').toString().replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const trim = (s) => (s ?? '').toString().trim();
const initials = (f) => ((trim(f.firstName)[0] || '') + (trim(f.lastName)[0] || '')).toUpperCase() || '?';
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

function toast(msg) {
  let t = $('#toast');
  if (!t) { t = el('div', { id: 'toast', class: 'toast' }); document.body.append(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------------------- Router ------------------------------------------ */
const app = () => $('#app');

const routes = {
  '': renderHome,
  'home': renderHome,
  'list': renderList,
  'add': renderForm,
  'edit': renderForm,
  'detail': renderDetail,
  'search': renderSearch,
  'reports': renderReports,
  'settings': renderSettings,
};

function go(hash) { location.hash = hash; }
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, param] = raw.split('/');
  return { name: name || 'home', param };
}
async function route() {
  const { name, param } = parseHash();
  const fn = routes[name] || renderHome;
  app().innerHTML = '';
  await fn(param);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ---------------------- Shared UI --------------------------------------- */
function topbar(title, { back = false, right = null } = {}) {
  const bar = el('div', { class: 'topbar' });
  if (back) bar.append(el('button', { class: 'back', onclick: () => history.back() }, '‹ Back'));
  bar.append(el('h1', {}, title));
  if (right) bar.append(right);
  return bar;
}
function emptyState(emoji, text, actionLabel, onAction) {
  const box = el('div', { class: 'empty' }, el('span', { class: 'emoji' }, emoji), el('div', {}, text));
  if (actionLabel) box.append(el('button', { class: 'btn primary', onclick: onAction }, actionLabel));
  return box;
}

/* ---------------------- Screens ----------------------------------------- */
async function renderHome() {
  const all = await getAll();
  app().append(topbar('My Friends', {
    right: el('button', { title: 'Settings', onclick: () => go('#/settings') }, '⚙︎')
  }));
  const main = el('main');
  const tiles = el('div', { class: 'tiles' },
    tile('➕', 'Add Friend', 'Create a record', () => go('#/add')),
    tile('👥', 'All Contacts', `${all.length} saved`, () => go('#/list')),
    tile('🔎', 'Search', 'Find by field', () => go('#/search')),
    tile('📄', 'Reports', 'Export CSV/PDF/Excel', () => go('#/reports')),
  );
  main.append(tiles);
  app().append(main);
}
function tile(emoji, label, sub, onclick) {
  return el('div', { class: 'tile', onclick },
    el('span', { class: 'emoji' }, emoji),
    el('div', { class: 'label' }, label),
    el('div', { class: 'sub' }, sub));
}

async function renderList() {
  app().append(topbar('All Contacts', {
    back: true,
    right: el('button', { title: 'Add', onclick: () => go('#/add') }, '＋')
  }));
  const main = el('main');
  const search = el('input', { type: 'search', placeholder: 'Quick search…', oninput: apply });
  main.append(search);
  const listWrap = el('div');
  main.append(listWrap);
  app().append(main);

  const all = (await getAll()).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  function apply() {
    const q = trim(search.value).toLowerCase();
    const rows = all.filter((f) => !q ||
      [f.firstName, f.lastName, f.postCode, f.searchTag, f.notes, f.address]
        .some((v) => (v || '').toLowerCase().includes(q)));
    listWrap.innerHTML = '';
    if (!all.length) { listWrap.append(emptyState('👋', 'No friends yet.', 'Add your first friend', () => go('#/add'))); return; }
    if (!rows.length) { listWrap.append(emptyState('🔍', 'No matches.')); return; }
    const ul = el('ul', { class: 'list' });
    rows.forEach((f) => ul.append(friendRow(f)));
    listWrap.append(ul);
  }
  apply();
}
function friendRow(f) {
  const meta = [f.postCode, f.searchTag].filter(Boolean).join(' · ');
  return el('li', { class: 'row', onclick: () => go('#/detail/' + f.id) },
    el('div', { class: 'row-flex' },
      el('span', { class: 'avatar' }, initials(f)),
      el('div', { class: 'body' },
        el('div', { class: 'name' }, `${f.firstName} ${f.lastName}`),
        meta ? el('div', { class: 'meta' }, meta) : '')));
}

async function renderForm(id) {
  const editing = !!id;
  const f = editing ? await getOne(id) : { firstName: '', lastName: '', address: '', postCode: '', notes: '', searchTag: '' };
  if (editing && !f) { go('#/list'); return; }

  app().append(topbar(editing ? 'Edit Friend' : 'Add Friend', { back: true }));
  const main = el('main');

  const fName = input('First Name', f.firstName, true);
  const lName = input('Last Name', f.lastName, true);
  const addr = textarea('Address', f.address);
  const post = input('Post Code', f.postCode);
  const tags = input('Search Tags (comma-separated)', f.searchTag);
  const notes = textarea('Notes', f.notes);

  const save = el('button', { class: 'btn primary' }, editing ? 'Save Changes' : 'Save');
  const validate = () => { save.disabled = !(trim(fName.value) && trim(lName.value)); };
  [fName, lName].forEach((i) => i.addEventListener('input', validate));
  validate();

  save.addEventListener('click', async () => {
    const now = new Date().toISOString();
    const rec = {
      ...(editing ? { id: f.id } : {}),
      firstName: trim(fName.value), lastName: trim(lName.value),
      address: trim(addr.value), postCode: trim(post.value),
      searchTag: trim(tags.value), notes: trim(notes.value),
      createdAt: editing ? (f.createdAt || now) : now,
      updatedAt: now,
    };
    const newId = await putFriend(rec);
    toast(editing ? 'Saved' : 'Friend added');
    location.replace('#/detail/' + (editing ? f.id : newId));
  });

  main.append(fName._label, fName, lName._label, lName, addr._label, addr,
    post._label, post, tags._label, tags, notes._label, notes, save);
  app().append(main);
}
function input(labelText, value, required) {
  const lbl = el('label', {}, labelText, required ? el('span', { class: 'req' }, ' *') : '');
  const i = el('input', { type: 'text', value: value || '' });
  i._label = lbl; return i;
}
function textarea(labelText, value) {
  const lbl = el('label', {}, labelText);
  const t = el('textarea', {}, value || '');
  t._label = lbl; return t;
}

async function renderDetail(id) {
  const f = await getOne(id);
  if (!f) { go('#/list'); return; }
  app().append(topbar('Contact', {
    back: true,
    right: el('button', { onclick: () => go('#/edit/' + f.id) }, 'Edit')
  }));
  const main = el('main');
  main.append(el('div', { style: 'text-align:center;margin:8px 0 18px;' },
    el('span', { class: 'avatar', style: 'width:64px;height:64px;font-size:24px;' }, initials(f)),
    el('h2', { style: 'margin:10px 0 0;' }, `${f.firstName} ${f.lastName}`)));

  const fld = (k, v) => v ? el('div', { class: 'field' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)) : '';
  main.append(
    fld('Address', f.address), fld('Post Code', f.postCode),
    fld('Search Tags', f.searchTag), fld('Notes', f.notes),
    fld('Created', fmtDate(f.createdAt)), fld('Updated', fmtDate(f.updatedAt)));

  const del = el('button', { class: 'btn danger' }, 'Delete');
  del.addEventListener('click', async () => {
    if (confirm(`Delete ${f.firstName} ${f.lastName}? This cannot be undone.`)) {
      await deleteFriend(f.id); toast('Deleted'); go('#/list');
    }
  });
  main.append(del);
  app().append(main);
}

/* ---------------------- Search ------------------------------------------ */
const FIELDS = [
  { key: 'firstName', label: 'First Name', on: true },
  { key: 'lastName', label: 'Last Name', on: true },
  { key: 'postCode', label: 'Post Code', on: true },
  { key: 'searchTag', label: 'Tags', on: true },
  { key: 'notes', label: 'Notes', on: true },
  { key: 'address', label: 'Address', on: false },
];

async function renderSearch() {
  app().append(topbar('Search', { back: true }));
  const main = el('main');
  const box = el('input', { type: 'search', placeholder: 'Type to search…', oninput: apply });
  const state = FIELDS.map((f) => ({ ...f }));
  const chips = el('div', { class: 'chips' });
  state.forEach((f) => {
    const chip = el('div', { class: 'chip' + (f.on ? ' on' : '') }, f.label);
    chip.addEventListener('click', () => { f.on = !f.on; chip.classList.toggle('on', f.on); apply(); });
    chips.append(chip);
  });
  const count = el('div', { class: 'count' });
  const exportBtn = el('button', { class: 'btn ghost' }, 'Export these results');
  const listWrap = el('div');
  main.append(box, chips, count, listWrap, exportBtn);
  app().append(main);

  const all = await getAll();
  let current = [];
  function apply() {
    const q = trim(box.value).toLowerCase();
    const keys = state.filter((f) => f.on).map((f) => f.key);
    current = !q ? [] : all.filter((f) => keys.some((k) => (f[k] || '').toLowerCase().includes(q)));
    count.textContent = q ? `${current.length} result(s)` : 'Type to search across selected fields.';
    listWrap.innerHTML = '';
    if (q && !current.length) listWrap.append(emptyState('🔍', 'No results.'));
    else { const ul = el('ul', { class: 'list' }); current.forEach((f) => ul.append(friendRow(f))); listWrap.append(ul); }
    exportBtn.disabled = !current.length;
    exportBtn.style.opacity = current.length ? '1' : '.5';
  }
  exportBtn.addEventListener('click', () => { if (current.length) openExportSheet(current); });
  apply();
}

/* ---------------------- Reports & Export -------------------------------- */
async function renderReports() {
  app().append(topbar('Reports & Export', { back: true }));
  const main = el('main');
  const fn = input('First Name contains', '');
  const ln = input('Last Name contains', '');
  const pc = input('Post Code contains', '');
  const tg = input('Tags contain', '');
  const nt = input('Notes contain', '');
  const preview = el('div', { class: 'count' });
  const btns = el('div', { class: 'export-btns' });
  const all = await getAll();
  let filtered = all.slice();

  function apply() {
    const f = trim(fn.value).toLowerCase(), l = trim(ln.value).toLowerCase(),
      p = trim(pc.value).toLowerCase(), t = trim(tg.value).toLowerCase(), n = trim(nt.value).toLowerCase();
    filtered = all.filter((r) =>
      (!f || (r.firstName || '').toLowerCase().includes(f)) &&
      (!l || (r.lastName || '').toLowerCase().includes(l)) &&
      (!p || (r.postCode || '').toLowerCase().includes(p)) &&
      (!t || (r.searchTag || '').toLowerCase().includes(t)) &&
      (!n || (r.notes || '').toLowerCase().includes(n)));
    preview.textContent = `${filtered.length} of ${all.length} record(s) match`;
    const enabled = filtered.length > 0;
    btns.querySelectorAll('button').forEach((b) => { b.disabled = !enabled; b.style.opacity = enabled ? '1' : '.5'; });
  }
  [fn, ln, pc, tg, nt].forEach((i) => i.addEventListener('input', apply));

  btns.append(
    el('button', { class: 'btn ghost', onclick: () => exportCSV(filtered) }, 'CSV'),
    el('button', { class: 'btn ghost', onclick: () => exportPDF(filtered) }, 'PDF'),
    el('button', { class: 'btn ghost', onclick: () => exportXLSX(filtered) }, 'Excel'),
  );

  main.append(fn._label, fn, ln._label, ln, pc._label, pc, tg._label, tg, nt._label, nt,
    el('label', {}, 'Preview'), preview, btns);
  app().append(main);
  apply();
}

const EXPORT_COLS = [
  ['id', 'Id'], ['firstName', 'First Name'], ['lastName', 'Last Name'],
  ['address', 'Address'], ['postCode', 'Post Code'], ['notes', 'Notes'],
  ['searchTag', 'Search Tags'], ['createdAt', 'Created'], ['updatedAt', 'Updated'],
];

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  // On iOS, share via the sheet if available
  tryShare(filename, blob);
}
async function tryShare(filename, blob) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'My Friends export' });
    }
  } catch { /* user cancelled or unsupported; the download already happened */ }
}
function openExportSheet(rows) {
  const choice = prompt('Export format? Type: csv, pdf, or excel', 'csv');
  if (!choice) return;
  const c = choice.toLowerCase();
  if (c.startsWith('p')) exportPDF(rows);
  else if (c.startsWith('e') || c.startsWith('x')) exportXLSX(rows);
  else exportCSV(rows);
}

function csvCell(v) {
  const s = (v ?? '').toString();
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportCSV(rows) {
  if (!rows.length) return;
  const header = EXPORT_COLS.map(([, l]) => csvCell(l)).join(',');
  const body = rows.map((r) => EXPORT_COLS.map(([k]) => csvCell(r[k])).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  download('my_friends.csv', blob);
  toast('CSV ready');
}

function exportPDF(rows) {
  if (!rows.length) return;
  // Zero-dependency PDF: open a print-ready page; user picks "Save as PDF".
  const w = window.open('', '_blank');
  const style = `body{font-family:-apple-system,Segoe UI,Arial,sans-serif;padding:24px;color:#111;}
    h1{color:#0b3d91;margin:0 0 4px;} .sub{color:#666;margin:0 0 16px;font-size:12px;}
    table{border-collapse:collapse;width:100%;font-size:12px;} th,td{border:1px solid #999;padding:5px 7px;text-align:left;vertical-align:top;}
    th{background:#eef2fb;} @media print{.noprint{display:none;}}
    button{background:#0b3d91;color:#fff;border:none;padding:10px 18px;border-radius:8px;font-size:15px;cursor:pointer;margin-bottom:16px;}`;
  const cols = EXPORT_COLS.filter(([k]) => k !== 'id');
  const head = cols.map(([, l]) => `<th>${esc(l)}</th>`).join('');
  const body = rows.map((r) => '<tr>' + cols.map(([k]) => `<td>${esc(k.endsWith('At') ? fmtDate(r[k]) : r[k])}</td>`).join('') + '</tr>').join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>My Friends Report</title><style>${style}</style></head>
    <body><button class="noprint" onclick="window.print()">Save as PDF / Print</button>
    <h1>My Friends — Contact Report</h1>
    <p class="sub">Generated ${new Date().toLocaleString()} · ${rows.length} record(s)</p>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`);
  w.document.close();
  toast('PDF report opened');
}

function exportXLSX(rows) {
  if (!rows.length) return;
  if (window.XLSX) {
    const data = [EXPORT_COLS.map(([, l]) => l)].concat(
      rows.map((r) => EXPORT_COLS.map(([k]) => k.endsWith('At') ? fmtDate(r[k]) : (r[k] ?? ''))));
    const ws = window.XLSX.utils.aoa_to_sheet(data);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Friends');
    window.XLSX.writeFile(wb, 'my_friends.xlsx');
    toast('Excel ready');
  } else {
    // Offline fallback: CSV opens directly in Excel / Numbers.
    exportCSV(rows);
    toast('Excel engine offline — exported CSV (opens in Excel)');
  }
}

/* ---------------------- Settings & Lock --------------------------------- */
const LOCK_ENABLED = 'mf_lock_enabled';
const LOCK_PIN = 'mf_lock_pin';

function lockEnabled() { return localStorage.getItem(LOCK_ENABLED) !== 'false'; } // default ON
function getPin() { return localStorage.getItem(LOCK_PIN) || ''; }

async function renderSettings() {
  app().append(topbar('Settings', { back: true }));
  const main = el('main');

  const sw = el('input', { type: 'checkbox' });
  sw.checked = lockEnabled();
  sw.addEventListener('change', () => {
    if (sw.checked && !getPin()) { promptSetPin(); }
    localStorage.setItem(LOCK_ENABLED, sw.checked ? 'true' : 'false');
    toast(sw.checked ? 'App lock ON' : 'App lock OFF');
  });
  main.append(el('div', { class: 'switch' }, el('span', {}, '🔒 App lock (PIN on launch)'), sw));

  main.append(el('button', { class: 'btn ghost', onclick: promptSetPin }, getPin() ? 'Change PIN' : 'Set PIN'));

  const all = await getAll();
  main.append(el('button', { class: 'btn ghost', onclick: () => exportCSV(all) }, `Backup all (${all.length}) to CSV`));

  main.append(el('p', { class: 'count', style: 'margin-top:24px;' },
    'Note: Web apps cannot use Face ID directly. This PIN protects the app. ' +
    'All data stays on this device in the browser database.'));
  app().append(main);
}
function promptSetPin() {
  const pin = prompt('Set a 4–8 digit PIN:');
  if (pin && /^\d{4,8}$/.test(pin)) {
    localStorage.setItem(LOCK_PIN, pin);
    localStorage.setItem(LOCK_ENABLED, 'true');
    toast('PIN set');
  } else if (pin !== null) {
    alert('PIN must be 4–8 digits.');
  }
}

function showLock() {
  return new Promise((resolve) => {
    const pin = getPin();
    if (!lockEnabled() || !pin) { resolve(); return; }
    const lock = el('div', { id: 'lock' });
    const inp = el('input', { type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: '••••' });
    const err = el('div', { class: 'err' });
    const btn = el('button', { class: 'btn ghost' }, 'Unlock');
    const check = () => {
      if (inp.value === pin) { lock.remove(); resolve(); }
      else { err.textContent = 'Wrong PIN, try again.'; inp.value = ''; inp.focus(); }
    };
    btn.addEventListener('click', check);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    lock.append(el('span', { class: 'emoji' }, '🔒'),
      el('h2', {}, 'My Friends'), el('p', {}, 'Enter your PIN to unlock'),
      inp, btn, err);
    document.body.append(lock);
    setTimeout(() => inp.focus(), 100);
  });
}

/* ---------------------- Boot -------------------------------------------- */
async function boot() {
  await openDB();
  await showLock();
  if (!location.hash) location.hash = '#/home';
  route();

  // Re-lock when returning from background after 60s.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 60000 && lockEnabled() && getPin()) {
      if (!$('#lock')) { await showLock(); }
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}
boot();
