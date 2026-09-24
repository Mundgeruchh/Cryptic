const AUTH_KEY = 'cryptic_auth_token';
const EMAIL_KEY = 'cryptic_auth_email';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const PREVIEW_LINES = 20;
const MAX_HIGHLIGHT_CHARS = 100000;
const MAX_LINE_CHARS = 400;

const ICONS = {
  folder: '<svg class="icon-folder" viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/></svg>',
  file: '<svg class="icon-file" viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"/></svg>',
  chevron: '<svg class="chevron CLS" viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg>'
};

const state = {
  nodes: [],
  byId: {},
  expanded: new Set(),
  folderId: null,
  fileId: null,
  fileContent: '',
  mode: 'browse',
  newName: ''
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('file-input').addEventListener('change', handleFileInput);
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('hashchange', route);
  setupDragAndDrop();
  initAuth();
});

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message, 'success');
  } catch (e) {
    showToast('Could not access the clipboard', 'error');
  }
}

async function initAuth() {
  const token = localStorage.getItem(AUTH_KEY);
  if (token && await verifyToken(token)) {
    enterApp();
    return;
  }
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(EMAIL_KEY);
  showAuthView(true);
  renderGoogleButton();
}

async function verifyToken(token) {
  try {
    const res = await fetch('/api/check-auth', { headers: { authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.authenticated;
  } catch (e) {
    return false;
  }
}

async function renderGoogleButton() {
  const warning = document.getElementById('auth-config-warning');
  const container = document.getElementById('google-btn-container');

  let config = null;
  try {
    config = await (await fetch('/api/config')).json();
  } catch (e) {}

  if (!config || !config.googleClientId) {
    warning.classList.remove('hidden');
    container.classList.add('hidden');
    return;
  }

  warning.classList.add('hidden');
  container.classList.remove('hidden');

  const setup = () => {
    if (!window.google || !google.accounts || !google.accounts.id) {
      setTimeout(setup, 150);
      return;
    }
    google.accounts.id.initialize({ client_id: config.googleClientId, callback: handleGoogleCredential });
    google.accounts.id.renderButton(container, { theme: 'filled_black', size: 'large', shape: 'rectangular', width: 280 });
  };
  setup();
}

async function handleGoogleCredential(response) {
  const banner = document.getElementById('auth-error');
  banner.classList.add('hidden');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      localStorage.setItem(AUTH_KEY, data.token);
      localStorage.setItem(EMAIL_KEY, data.email || '');
      enterApp();
      return;
    }
    banner.textContent = data.error || 'Access denied';
  } catch (err) {
    banner.textContent = 'Error: ' + err.message;
  }
  banner.classList.remove('hidden');
}

function showAuthView(show) {
  document.getElementById('auth-view').classList.toggle('hidden', !show);
  document.getElementById('app').classList.toggle('hidden', show);
}

function authHeaders() {
  const token = localStorage.getItem(AUTH_KEY);
  return token ? { authorization: `Bearer ${token}` } : {};
}

function handleLogout() {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(EMAIL_KEY);
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  showAuthView(true);
  renderGoogleButton();
}

async function enterApp() {
  showAuthView(false);
  document.getElementById('nav-email').textContent = localStorage.getItem(EMAIL_KEY) || '';
  await loadTree(true);
  route();
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...authHeaders() }
  });
  if (res.status === 401) {
    handleLogout();
    throw new Error('Session expired, please sign in again');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || res.statusText);
  return data;
}

const post = (body) => api('/api/fs', { method: 'POST', body: JSON.stringify(body) });

async function loadTree(sync = false) {
  try {
    const data = await api('/api/fs' + (sync ? '?sync=1' : ''));
    setNodes(data.nodes);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function setNodes(nodes) {
  state.nodes = nodes;
  state.byId = Object.fromEntries(nodes.map(n => [n.id, n]));
}

function remember(node) {
  const index = state.nodes.findIndex(n => n.id === node.id);
  if (index === -1) state.nodes.push(node);
  else state.nodes[index] = node;
  state.byId[node.id] = node;
}

function childrenOf(parentId) {
  return state.nodes
    .filter(n => (n.parent || null) === (parentId || null))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'folder' ? -1 : 1));
}

function pathOf(id) {
  const chain = [];
  let node = state.byId[id];
  while (node) {
    chain.unshift(node);
    node = node.parent ? state.byId[node.parent] : null;
  }
  return chain;
}

function foldersWithPaths(excludeId) {
  const result = [{ id: '', label: '/ (root)' }];
  const walk = (parentId, prefix) => {
    for (const child of childrenOf(parentId)) {
      if (child.type !== 'folder' || child.id === excludeId) continue;
      const label = prefix + child.name + '/';
      result.push({ id: child.id, label: '/' + label });
      walk(child.id, label);
    }
  };
  walk(null, '');
  return result;
}

function rawUrl(node) {
  return `${window.location.origin}/api/raw?file=${encodeURIComponent(node.link)}`;
}

function loadstringFor(node) {
  return `loadstring(game:HttpGet("${rawUrl(node)}"))()`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatAge(timestamp) {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (value < size) return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
    value = Math.round(value / size);
  }
  return '';
}

function hashFor(node) {
  if (!node) return '#/';
  return '#/' + pathOf(node.id).map(n => encodeURIComponent(n.name)).join('/');
}

function go(node) {
  const hash = hashFor(node);
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  if (document.getElementById('app').classList.contains('hidden')) return;

  const segments = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  let parent = null;
  let target = null;

  for (const segment of segments) {
    target = childrenOf(parent).find(n => n.name === segment) || null;
    if (!target) break;
    parent = target.id;
  }

  state.mode = 'browse';
  state.fileId = null;
  state.folderId = null;

  if (!target && segments.length) {
    showToast('That path does not exist', 'error');
  } else if (target && target.type === 'file') {
    state.fileId = target.id;
    state.folderId = target.parent || null;
    await loadFileContent(target.id);
  } else if (target) {
    state.folderId = target.id;
  }

  for (const node of pathOf(state.folderId)) state.expanded.add(node.id);
  render();
}

async function loadFileContent(id) {
  try {
    const data = await api(`/api/fs?id=${encodeURIComponent(id)}`);
    state.fileContent = data.content;
    remember(data.node);
  } catch (err) {
    state.fileContent = '';
    showToast(err.message, 'error');
  }
}

function render() {
  renderTree();
  renderBreadcrumbs();
  renderActions();
  renderContent();
}

function renderTree() {
  const container = document.getElementById('tree');

  const rows = [];
  const walk = (parentId, depth) => {
    for (const node of childrenOf(parentId)) {
      const isFolder = node.type === 'folder';
      const open = state.expanded.has(node.id);
      const active = isFolder ? (node.id === state.folderId && !state.fileId) : node.id === state.fileId;
      const chevron = isFolder ? ICONS.chevron.replace('CLS', open ? 'open' : '') : ICONS.chevron.replace('CLS', 'blank');
      rows.push(`
        <div class="tree-row${active ? ' active' : ''}" style="padding-left:${8 + depth * 16}px"
             data-id="${node.id}" data-kind="${node.type}" draggable="true" ${isFolder ? 'data-folder-drop="' + node.id + '"' : ''}>
          <span class="tree-toggle" data-toggle="${node.id}">${chevron}</span>
          ${isFolder ? ICONS.folder : ICONS.file}
          <span class="tree-name">${escapeHtml(node.name)}</span>
        </div>`);
      if (isFolder && open) walk(node.id, depth + 1);
    }
  };
  walk(null, 0);

  container.innerHTML = `
    ${rows.join('')}`;

  container.querySelectorAll('.tree-row[data-kind]').forEach(row => {
    row.addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-toggle]');
      const node = state.byId[row.dataset.id] || null;
      if (toggle && node) {
        if (state.expanded.has(node.id)) state.expanded.delete(node.id);
        else state.expanded.add(node.id);
        renderTree();
        return;
      }
      go(node);
    });
    row.addEventListener('contextmenu', (e) => openNodeMenu(e, state.byId[row.dataset.id]));
    attachDragHandlers(row);
  });
}

function renderBreadcrumbs() {
  const nav = document.getElementById('breadcrumbs');
  const target = state.fileId || state.folderId;
  const chain = target ? pathOf(target) : [];
  const parts = [`<a data-crumb="">Cryptic</a>`];

  chain.forEach((node, i) => {
    const last = i === chain.length - 1;
    parts.push('<span class="sep">/</span>');
    parts.push(last && state.mode === 'browse' ? `<span class="current">${escapeHtml(node.name)}</span>` : `<a data-crumb="${node.id}">${escapeHtml(node.name)}</a>`);
  });

  if (state.mode === 'new') {
    parts.push('<span class="sep">/</span>');
    parts.push(`<input type="text" id="new-file-name" placeholder="Name your file..." value="${escapeHtml(state.newName)}" style="width:240px">`);
  }

  nav.innerHTML = parts.join('');
  nav.querySelectorAll('[data-crumb]').forEach(a => {
    a.addEventListener('click', () => {
      state.mode = 'browse';
      go(state.byId[a.dataset.crumb] || null);
    });
    a.dataset.folderDrop = a.dataset.crumb || 'root';
    attachDragHandlers(a);
  });

  const nameInput = document.getElementById('new-file-name');
  if (nameInput) {
    nameInput.addEventListener('input', () => { state.newName = nameInput.value; });
    if (!state.newName) nameInput.focus();
  }
}

function renderActions() {
  const bar = document.getElementById('pathbar-actions');
  bar.innerHTML = '';
  if (state.fileId || state.mode === 'new') return;

  bar.innerHTML = `
    <button class="btn btn-sm" id="act-folder">New folder</button>
    <button class="btn btn-sm" id="act-upload">Upload files</button>
    <button class="btn btn-sm btn-primary" id="act-new">Create new file</button>`;

  document.getElementById('act-folder').addEventListener('click', () => createFolder(state.folderId));
  document.getElementById('act-upload').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('act-new').addEventListener('click', startNewFile);
}

function renderContent() {
  const container = document.getElementById('content');

  if (state.mode === 'new') {
    renderEditor(container, null);
  } else if (state.fileId && state.mode === 'edit') {
    renderEditor(container, state.byId[state.fileId]);
  } else if (state.fileId) {
    renderFileView(container, state.byId[state.fileId]);
  } else {
    renderFolderView(container);
  }
}

function renderFolderView(container) {
  const children = childrenOf(state.folderId);
  const folder = state.byId[state.folderId];
  const rows = [];

  if (folder) {
    rows.push(`
      <div class="file-row" data-up="1" data-folder-drop="${folder.parent || 'root'}">
        <div class="file-name">${ICONS.folder}<span class="label">..</span></div><span></span><span></span><span></span>
      </div>`);
  }

  for (const node of children) {
    const isFolder = node.type === 'folder';
    const meta = isFolder ? `${childrenOf(node.id).length} items` : formatSize(node.size || 0);
    rows.push(`
      <div class="file-row" data-id="${node.id}" draggable="true" ${isFolder ? 'data-folder-drop="' + node.id + '"' : ''}>
        <div class="file-name">${isFolder ? ICONS.folder : ICONS.file}<span class="label">${escapeHtml(node.name)}</span></div>
        <span class="cell-muted">${meta}</span>
        <span class="cell-muted">${formatAge(node.updated || Date.now())}</span>
        <span class="cell-actions"><button class="row-menu" data-menu="${node.id}" title="Actions">⋯</button></span>
      </div>`);
  }

  const total = state.nodes.filter(n => n.type === 'file').length;
  const empty = !children.length ? `
    <div class="empty">
      <h3>${folder ? 'This folder is empty' : 'No files yet'}</h3>
      <p>Drag files or folders anywhere on this page, or use the buttons above.</p>
    </div>` : '';

  container.innerHTML = `
    <div class="box">
      <div class="box-header">
        <strong>${escapeHtml(folder ? folder.name : 'Cryptic')}</strong>
        <div class="meta"><span>${children.length} item${children.length === 1 ? '' : 's'}</span><span class="sep"></span><span>${total} file${total === 1 ? '' : 's'} total</span></div>
      </div>
      ${rows.join('')}${empty}
    </div>`;

  container.querySelectorAll('.file-row').forEach(row => {
    if (row.dataset.up) {
      row.addEventListener('click', () => go(state.byId[folder.parent] || null));
    } else {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-menu]')) return;
        go(state.byId[row.dataset.id]);
      });
      row.addEventListener('contextmenu', (e) => openNodeMenu(e, state.byId[row.dataset.id]));
    }
    attachDragHandlers(row);
  });

  container.querySelectorAll('[data-menu]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openNodeMenu(e, state.byId[btn.dataset.menu]);
    });
  });
}

function renderFileView(container, node) {
  if (!node) {
    container.innerHTML = '<div class="box"><div class="empty">File not found.</div></div>';
    return;
  }

  const isBinary = Boolean(node.binary);
  const content = state.fileContent;
  const lineCount = content.split('\n').length;
  const shownCount = Math.min(lineCount, PREVIEW_LINES);
  const previewLines = content.split('\n').slice(0, PREVIEW_LINES);
  const clipped = previewLines.some(line => line.length > MAX_LINE_CHARS);
  const preview = previewLines.map(line => (line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) + ' ...' : line)).join('\n');
  const highlighted = highlightLua(preview);
  const lines = Array.from({ length: shownCount }, (_, i) => `<div>${i + 1}</div>`).join('');
  const hiddenLines = lineCount - shownCount;
  const hiddenNote = hiddenLines > 0 || clipped
    ? `<div class="preview-more">${hiddenLines > 0 ? `${hiddenLines} more line${hiddenLines === 1 ? '' : 's'} hidden. ` : ''}${clipped ? 'Very long lines were shortened. ' : ''}Click Edit to see the full file.</div>`
    : '';

  container.innerHTML = `
    <div class="box">
      <div class="box-header">
        <div class="meta"><span>${lineCount} line${lineCount === 1 ? '' : 's'}</span><span class="sep"></span><span>${formatSize(node.size || content.length)}</span><span class="sep"></span><span>updated ${formatAge(node.updated || Date.now())}</span></div>
        <div class="btn-group">
          <button class="btn btn-sm" id="fv-loadstring">Copy loadstring</button>
          <button class="btn btn-sm" id="fv-copy">Copy code</button>
          <a class="btn btn-sm" href="${escapeHtml(rawUrl(node))}" target="_blank" rel="noopener">Raw</a>
          <button class="btn btn-sm" id="fv-edit">Edit</button>
          <button class="btn btn-sm btn-danger" id="fv-delete">Delete</button>
        </div>
      </div>
      ${isBinary
        ? '<div class="empty"><p>This file is not valid UTF-8 text, so no preview is shown. It is stored and served byte for byte, and the loadstring works as usual.</p></div>'
        : `<div class="code-view"><div class="code-lines">${lines}</div><pre class="code-body">${highlighted}</pre></div>`}
      ${hiddenNote}
      <div class="link-panel">
        <h4>Loadstring link</h4>
        <div class="link-row">
          <input type="text" readonly id="lp-raw" value="${escapeHtml(rawUrl(node))}">
          <button class="btn btn-sm" id="lp-copy-raw">Copy link</button>
        </div>
        <div class="link-row">
          <input type="text" readonly id="lp-load" value="${escapeHtml(loadstringFor(node))}">
          <button class="btn btn-sm" id="lp-copy-load">Copy loadstring</button>
        </div>
        <h4 style="margin-top:16px">Link settings</h4>
        <div class="link-row">
          <button class="btn btn-sm" id="lp-random">Generate random link</button>
          <button class="btn btn-sm" id="lp-name">Remove random link &amp; restore original</button>
          <input type="text" id="lp-custom" placeholder="custom-link" value="${escapeHtml(node.link || '')}" style="max-width:260px;min-width:140px;flex:0 1 260px">
          <button class="btn btn-sm" id="lp-custom-save">Set custom link</button>
        </div>
        <p class="link-hint">Changing the link invalidates the old one immediately. Allowed characters: letters, numbers, _ - .</p>
      </div>
    </div>`;

  document.getElementById('fv-loadstring').addEventListener('click', () => copyText(loadstringFor(node), 'Loadstring copied'));
  document.getElementById('fv-copy').addEventListener('click', () => copyText(state.fileContent, 'Code copied'));
  if (isBinary) {
    document.getElementById('fv-edit').disabled = true;
    document.getElementById('fv-copy').disabled = true;
  }
  document.getElementById('fv-edit').addEventListener('click', () => { state.mode = 'edit'; render(); });
  document.getElementById('fv-delete').addEventListener('click', () => deleteNode(node));
  document.getElementById('lp-copy-raw').addEventListener('click', () => copyText(rawUrl(node), 'Link copied'));
  document.getElementById('lp-copy-load').addEventListener('click', () => copyText(loadstringFor(node), 'Loadstring copied'));
  document.getElementById('lp-name').addEventListener('click', () => changeLink(node, { mode: 'name' }));
  document.getElementById('lp-random').addEventListener('click', () => changeLink(node, { mode: 'random' }));
  document.getElementById('lp-custom-save').addEventListener('click', () => {
    changeLink(node, { mode: 'custom', link: document.getElementById('lp-custom').value.trim() });
  });
}

function renderEditor(container, node) {
  const isNew = !node;
  const initial = isNew ? '' : state.fileContent;

  container.innerHTML = `
    <div class="box">
      <div class="box-header">
        <strong>${isNew ? 'New file' : 'Editing ' + escapeHtml(node.name)}</strong>
        <div class="meta"><span id="ed-lines">1 line</span></div>
      </div>
      <div class="editor">
        <div id="ed-gutter" class="ed-gutter" aria-hidden="true"></div>
        <pre id="ed-highlight" aria-hidden="true"></pre>
        <textarea id="ed-text" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="-- Write or paste your Lua code here"></textarea>
      </div>
      <div class="commit-bar">
        <button class="btn" id="ed-cancel">Cancel</button>
        <button class="btn btn-primary" id="ed-save">${isNew ? 'Create file' : 'Commit changes'}</button>
      </div>
    </div>`;

  const text = document.getElementById('ed-text');
  const pre = document.getElementById('ed-highlight');
  const lineLabel = document.getElementById('ed-lines');
  const gutter = document.getElementById('ed-gutter');
  let renderedLines = 0;
  text.value = initial;

  const refresh = () => {
    const value = text.value;
    pre.innerHTML = (value.length > MAX_HIGHLIGHT_CHARS ? escapeHtml(value) : highlightLua(value)) + '\n';
    const count = value.split('\n').length;
    lineLabel.textContent = `${count} line${count === 1 ? '' : 's'}`;
    if (count !== renderedLines) {
      renderedLines = count;
      gutter.innerHTML = Array.from({ length: count }, (_, i) => `<div>${i + 1}</div>`).join('');
    }
  };
  const syncScroll = () => {
    gutter.scrollTop = text.scrollTop;
    pre.scrollTop = text.scrollTop;
    pre.scrollLeft = text.scrollLeft;
  };

  text.addEventListener('input', refresh);
  text.addEventListener('scroll', syncScroll);
  text.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const { selectionStart: start, selectionEnd: end } = text;
    text.setRangeText('    ', start, end, 'end');
    refresh();
  });
  refresh();
  if (!isNew || state.newName) text.focus();

  document.getElementById('ed-cancel').addEventListener('click', () => {
    state.mode = 'browse';
    state.newName = '';
    render();
  });
  document.getElementById('ed-save').addEventListener('click', () => (isNew ? submitNewFile(text.value) : submitEdit(node, text.value)));
}

function startNewFile() {
  state.mode = 'new';
  state.newName = '';
  render();
}

async function submitNewFile(content) {
  const name = state.newName.trim();
  if (!name) {
    showToast('Name your file first', 'error');
    document.getElementById('new-file-name').focus();
    return;
  }
  try {
    const data = await post({ action: 'save', parent: state.folderId, name, content });
    remember(data.node);
    state.newName = '';
    showToast(`Created ${name}`, 'success');
    go(data.node);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function submitEdit(node, content) {
  try {
    const data = await post({ action: 'save', id: node.id, content });
    remember(data.node);
    state.fileContent = content;
    state.mode = 'browse';
    showToast('Changes saved', 'success');
    render();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function changeLink(node, payload) {
  try {
    const data = await post({ action: 'setlink', id: node.id, ...payload });
    remember(data.node);
    showToast('Link updated', 'success');
    render();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function createFolder(parentId) {
  const name = await promptModal({ title: 'New folder', label: 'Folder name', confirmText: 'Create folder' });
  if (!name) return;
  try {
    const data = await post({ action: 'mkdir', parent: parentId, name });
    remember(data.node);
    if (parentId) state.expanded.add(parentId);
    render();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function renameNode(node) {
  const name = await promptModal({ title: `Rename ${node.type}`, label: 'New name', value: node.name, confirmText: 'Rename' });
  if (!name || name === node.name) return;
  try {
    const data = await post({ action: 'rename', id: node.id, name });
    remember(data.node);
    if (state.fileId === node.id || pathOf(state.fileId || state.folderId).some(n => n.id === node.id)) {
      go(state.byId[state.fileId || state.folderId]);
    } else {
      render();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function moveNode(node, targetId) {
  if ((node.parent || null) === (targetId || null)) return;
  try {
    const data = await post({ action: 'move', id: node.id, parent: targetId });
    remember(data.node);
    if (targetId) state.expanded.add(targetId);
    showToast(`Moved ${node.name}`, 'success');
    const current = state.byId[state.fileId || state.folderId] || null;
    go(current);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function chooseMoveTarget(node) {
  const options = foldersWithPaths(node.type === 'folder' ? node.id : null);
  const chosen = await selectModal({ title: `Move ${node.name}`, label: 'Destination folder', options, confirmText: 'Move' });
  if (chosen === null) return;
  moveNode(node, chosen || null);
}

async function deleteNode(node) {
  const detail = node.type === 'folder' ? 'This deletes the folder and everything inside it.' : 'Its raw link will stop working.';
  const ok = await confirmModal({ title: `Delete ${node.name}?`, message: detail, confirmText: 'Delete', danger: true });
  if (!ok) return;
  try {
    await post({ action: 'remove', id: node.id });
    await loadTree();
    showToast(`Deleted ${node.name}`, 'success');
    const viewing = state.byId[state.fileId || state.folderId];
    go(viewing ? viewing : (node.parent && state.byId[node.parent]) || null);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openNodeMenu(event, node) {
  if (!node) return;
  event.preventDefault();
  event.stopPropagation();

  const items = [];
  if (node.type === 'file') {
    items.push({ label: 'Copy loadstring', run: () => copyText(loadstringFor(node), 'Loadstring copied') });
    items.push({ label: 'Copy raw link', run: () => copyText(rawUrl(node), 'Link copied') });
    items.push({ label: 'Link settings', run: () => go(node) });
    items.push('-');
  } else {
    items.push({ label: 'New folder inside', run: () => createFolder(node.id) });
    items.push('-');
  }
  items.push({ label: 'Rename', run: () => renameNode(node) });
  items.push({ label: 'Move to...', run: () => chooseMoveTarget(node) });
  items.push('-');
  items.push({ label: 'Delete', danger: true, run: () => deleteNode(node) });

  showMenu(event.clientX, event.clientY, items);
}

function showMenu(x, y, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.id = 'ctx-menu';

  for (const item of items) {
    if (item === '-') {
      menu.appendChild(document.createElement('hr'));
      continue;
    }
    const button = document.createElement('button');
    button.textContent = item.label;
    if (item.danger) button.className = 'danger';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      item.run();
    });
    menu.appendChild(button);
  }

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
}

function closeMenu() {
  const menu = document.getElementById('ctx-menu');
  if (menu) menu.remove();
}

function openModal({ title, bodyHtml, confirmText, danger, onMount, collect }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-backdrop">
        <form class="modal">
          <div class="modal-head">${escapeHtml(title)}</div>
          <div class="modal-body">${bodyHtml}</div>
          <div class="modal-foot">
            <button type="button" class="btn" data-cancel>Cancel</button>
            <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${escapeHtml(confirmText)}</button>
          </div>
        </form>
      </div>`;

    const form = root.querySelector('form');
    const close = (value) => {
      root.innerHTML = '';
      resolve(value);
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      close(collect ? collect(form) : true);
    });
    form.querySelector('[data-cancel]').addEventListener('click', () => close(collect ? null : false));
    root.querySelector('.modal-backdrop').addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('modal-backdrop')) close(collect ? null : false);
    });
    if (onMount) onMount(form);
  });
}

function promptModal({ title, label, value = '', confirmText }) {
  return openModal({
    title,
    confirmText,
    bodyHtml: `<div class="field-group"><label for="m-input">${escapeHtml(label)}</label><input type="text" id="m-input" value="${escapeHtml(value)}" autocomplete="off"></div>`,
    onMount: (form) => {
      const input = form.querySelector('#m-input');
      input.focus();
      input.select();
    },
    collect: (form) => form.querySelector('#m-input').value.trim() || null
  });
}

function selectModal({ title, label, options, confirmText }) {
  const optionsHtml = options.map(o => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('');
  return openModal({
    title,
    confirmText,
    bodyHtml: `<div class="field-group"><label for="m-select">${escapeHtml(label)}</label><select id="m-select">${optionsHtml}</select></div>`,
    collect: (form) => form.querySelector('#m-select').value
  });
}

function confirmModal({ title, message, confirmText, danger }) {
  return openModal({ title, confirmText, danger, bodyHtml: `<p>${escapeHtml(message)}</p>` });
}

let dragNodeId = null;

function attachDragHandlers(element) {
  element.addEventListener('dragstart', (e) => {
    const id = element.dataset.id;
    if (!id) return;
    dragNodeId = id;
    e.dataTransfer.setData('application/x-cryptic-node', id);
    e.dataTransfer.effectAllowed = 'move';
  });
  element.addEventListener('dragend', () => { dragNodeId = null; });

  const targetId = element.dataset.folderDrop;
  if (!targetId) return;

  element.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    element.classList.add('drop-target');
    e.dataTransfer.dropEffect = dragNodeId ? 'move' : 'copy';
  });
  element.addEventListener('dragleave', () => element.classList.remove('drop-target'));
  element.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    element.classList.remove('drop-target');
    hideDropOverlay();
    handleDropOn(e, targetId === 'root' ? null : targetId);
  });
}

async function handleDropOn(event, folderId) {
  if (dragNodeId) {
    const node = state.byId[dragNodeId];
    dragNodeId = null;
    if (node && node.id !== folderId) moveNode(node, folderId);
    return;
  }
  if (!event.dataTransfer || !event.dataTransfer.types.includes('Files')) return;
  const items = await collectDropped(event.dataTransfer);
  uploadItems(items, folderId);
}

function hideDropOverlay() {
  document.getElementById('drop-overlay').classList.add('hidden');
}

function setupDragAndDrop() {
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || dragNodeId) return;
    depth++;
    document.getElementById('drop-overlay').classList.remove('hidden');
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e) || dragNodeId) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) hideDropOverlay();
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', async (e) => {
    depth = 0;
    hideDropOverlay();
    if (!hasFiles(e) || dragNodeId) return;
    e.preventDefault();
    if (document.getElementById('app').classList.contains('hidden')) return;
    const items = await collectDropped(e.dataTransfer);
    uploadItems(items, state.folderId);
  });
}

async function collectDropped(dataTransfer) {
  const found = [];
  const entries = Array.from(dataTransfer.items || [])
    .map(item => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (!entries.length) {
    return Array.from(dataTransfer.files).map(file => ({ segments: [], file }));
  }

  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      found.push({ segments: prefix, file });
      return;
    }
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      for (const child of batch) await walk(child, [...prefix, entry.name]);
    } while (batch.length);
  };

  for (const entry of entries) await walk(entry, []);
  return found;
}

function handleFileInput(event) {
  const files = Array.from(event.target.files);
  event.target.value = '';
  uploadItems(files.map(file => ({ segments: [], file })), state.folderId);
}

async function readUpload(file) {
  const buffer = await file.arrayBuffer();
  try {
    return { content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer) };
  } catch (e) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return { contentBase64: btoa(binary) };
  }
}

async function uploadItems(items, rootFolderId) {
  if (!items.length) return;
  const folderCache = new Map();
  let saved = 0;
  let failed = 0;

  const ensureFolder = async (segments) => {
    let parent = rootFolderId || null;
    for (const segment of segments) {
      const key = `${parent}/${segment}`;
      if (!folderCache.has(key)) {
        let folder = childrenOf(parent).find(n => n.type === 'folder' && n.name.toLowerCase() === segment.toLowerCase());
        if (!folder) {
          const data = await post({ action: 'mkdir', parent, name: segment });
          folder = data.node;
          remember(folder);
        }
        folderCache.set(key, folder.id);
      }
      parent = folderCache.get(key);
    }
    return parent;
  };

  showToast(`Uploading ${items.length} file${items.length === 1 ? '' : 's'}...`, 'info');

  for (const { segments, file } of items) {
    try {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is larger than 10 MB`);
      const payload = await readUpload(file);
      const parent = await ensureFolder(segments);
      const existing = childrenOf(parent).find(n => n.type === 'file' && n.name.toLowerCase() === file.name.toLowerCase());
      const body = existing
        ? { action: 'save', id: existing.id, ...payload }
        : { action: 'save', parent, name: file.name, ...payload };
      const data = await post(body);
      remember(data.node);
      saved++;
    } catch (err) {
      failed++;
      showToast(err.message, 'error');
    }
  }

  await loadTree();
  if (rootFolderId) state.expanded.add(rootFolderId);
  if (saved) showToast(`Uploaded ${saved} file${saved === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`, failed ? 'error' : 'success');

  if (state.fileId) await loadFileContent(state.fileId);
  render();
}
