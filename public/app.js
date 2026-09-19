const AUTH_KEY = 'cryptic_auth_token';
const EMAIL_KEY = 'cryptic_auth_email';
let cachedScripts = [];
let editingId = null;

document.addEventListener('DOMContentLoaded', () => {
  setupEditorListeners();
  setupStaticListeners();
  initGoogleAuth();
});

function setupStaticListeners() {
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('clear-btn').addEventListener('click', clearEditor);
  document.getElementById('refresh-btn').addEventListener('click', loadScriptList);
  document.getElementById('search-input').addEventListener('input', filterScripts);
  document.getElementById('upload-form').addEventListener('submit', handleUpload);

  document.getElementById('script-list-container').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'copy') copyLoadstring(id);
    else if (action === 'edit') editScript(id);
    else if (action === 'toggle') toggleScript(id);
    else if (action === 'rotate') rotateScript(id);
    else if (action === 'delete') deleteScript(id);
  });
}

// auth

async function initGoogleAuth() {
  const token = localStorage.getItem(AUTH_KEY);
  if (token) {
    const ok = await verifyToken(token);
    if (ok) {
      enterApp();
      return;
    }
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(EMAIL_KEY);
  }

  showAuthModal(true);
  await renderGoogleButton();
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

  let config;
  try {
    const res = await fetch('/api/config');
    config = await res.json();
  } catch (e) {
    config = null;
  }

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
    google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: handleGoogleCredential
    });
    google.accounts.id.renderButton(container, {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      width: 280
    });
  };
  setup();
}

async function handleGoogleCredential(response) {
  const errBanner = document.getElementById('auth-error');
  errBanner.classList.add('hidden');

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
      showToast('Signed in as ' + (data.email || 'Admin'), 'success');
    } else {
      errBanner.innerText = data.error || 'Access denied';
      errBanner.classList.remove('hidden');
    }
  } catch (err) {
    errBanner.innerText = 'Sign-in failed, please try again';
    errBanner.classList.remove('hidden');
  }
}

function enterApp() {
  showAuthModal(false);
  const email = localStorage.getItem(EMAIL_KEY);
  const navEmail = document.getElementById('nav-email');
  if (navEmail) navEmail.innerText = email || '';
  loadScriptList();
}

function showAuthModal(show) {
  const modal = document.getElementById('auth-modal');
  const app = document.getElementById('app');
  if (show) {
    modal.classList.remove('hidden');
    app.classList.add('hidden');
  } else {
    modal.classList.add('hidden');
    app.classList.remove('hidden');
  }
}

function authHeaders() {
  const token = localStorage.getItem(AUTH_KEY);
  return token ? { authorization: `Bearer ${token}` } : {};
}

function handleLogout() {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(EMAIL_KEY);
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }
  showAuthModal(true);
  renderGoogleButton();
  showToast('Signed out', 'success');
}

// editor

function setupEditorListeners() {
  const textarea = document.getElementById('script-content');
  const lineNumbers = document.getElementById('line-numbers');
  if (!textarea) return;

  const updateLineNumbers = () => {
    const lines = textarea.value.split('\n');
    lineNumbers.innerHTML = Array.from({ length: lines.length }, (_, i) => i + 1).join('<br>');
  };

  textarea.addEventListener('input', updateLineNumbers);
  textarea.addEventListener('scroll', () => {
    lineNumbers.scrollTop = textarea.scrollTop;
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '    ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 4;
      updateLineNumbers();
    }
  });

  updateLineNumbers();
}

function clearEditor() {
  editingId = null;
  document.getElementById('script-filename').value = '';
  const textarea = document.getElementById('script-content');
  textarea.value = '';
  document.getElementById('editor-title').innerText = 'Create new script';
  document.getElementById('upload-btn').innerText = 'Upload / Save Script';
  textarea.dispatchEvent(new Event('input'));
}

// upload & save

async function handleUpload(event) {
  event.preventDefault();

  let filename = document.getElementById('script-filename').value.trim();
  const content = document.getElementById('script-content').value;

  if (!filename || !content) {
    showToast('Filename and code are required', 'error');
    return;
  }

  if (!filename.endsWith('.lua') && !filename.endsWith('.txt')) {
    filename += '.lua';
  }

  const isEdit = Boolean(editingId);
  const url = isEdit ? `/api/scripts/${editingId}` : '/api/scripts';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ filename, content })
    });

    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      showToast('Session expired, please sign in again', 'error');
      handleLogout();
      return;
    }
    if (!res.ok || !data.success) {
      showToast(data.error || 'Could not save script', 'error');
      return;
    }

    showToast(`Script "${filename}" ${isEdit ? 'updated' : 'uploaded'}!`, 'success');
  } catch (e) {
    showToast('Network error while saving the script', 'error');
    return;
  }

  clearEditor();
  loadScriptList();
}

// library

async function loadScriptList() {
  const container = document.getElementById('script-list-container');

  try {
    const res = await fetch('/api/scripts', { headers: authHeaders() });
    if (res.status === 401) {
      handleLogout();
      return;
    }
    const data = await res.json().catch(() => ({}));
    cachedScripts = (res.ok && Array.isArray(data.scripts)) ? data.scripts : [];
    renderScriptList(cachedScripts);
    renderTopStats(cachedScripts);
  } catch (err) {
    container.innerHTML = '<div class="empty-state">Could not load scripts.</div>';
  }
}

function renderTopStats(scripts) {
  const totalRuns = scripts.reduce((sum, s) => sum + (s.runs || 0), 0);
  document.getElementById('stat-scripts').innerText = scripts.length;
  document.getElementById('stat-runs').innerText = totalRuns.toLocaleString('en-US');

  let top = scripts.reduce((best, s) => (!best || (s.runs || 0) > (best.runs || 0) ? s : best), null);
  document.getElementById('stat-top').innerText = top && top.runs > 0 ? top.filename : '–';
}

function renderScriptList(scripts) {
  const container = document.getElementById('script-list-container');

  if (scripts.length === 0) {
    container.innerHTML = '<div class="empty-state">No scripts yet. Create your first script above!</div>';
    return;
  }

  container.innerHTML = scripts.map((script, i) => {
    const runs = script.runs || 0;
    const disabled = !script.enabled;
    return `
    <div class="script-card fade-in ${disabled ? 'disabled' : ''}" style="--delay:${(i * 0.04).toFixed(2)}s">
      <div class="script-card-header">
        <span class="script-card-title">${escapeHtml(script.filename)}</span>
        <span class="run-badge" title="Executions">⚡ ${runs.toLocaleString('en-US')}</span>
      </div>
      <div class="script-card-status ${disabled ? 'status-off' : 'status-on'}">${disabled ? 'Disabled' : 'Active'}</div>
      <div class="script-card-actions">
        <button class="btn btn-primary btn-sm" data-action="copy" data-id="${script.scriptId}">⚡ Copy Loadstring</button>
        <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${script.scriptId}">✏️ Edit</button>
        <button class="btn btn-secondary btn-sm" data-action="toggle" data-id="${script.scriptId}">${disabled ? '▶️ Enable' : '⏸️ Disable'}</button>
        <button class="btn btn-secondary btn-sm" data-action="rotate" data-id="${script.scriptId}">🔄 Rotate link</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${script.scriptId}">🗑️ Delete</button>
      </div>
    </div>
  `;
  }).join('');
}

function filterScripts() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const filtered = cachedScripts.filter(s => s.filename.toLowerCase().includes(query));
  renderScriptList(filtered);
}

// actions

function getLoaderUrl(publicId) {
  return `${window.location.origin}/api/loader/${publicId}`;
}

function getLoadstring(publicId) {
  return `loadstring(game:HttpGet("${getLoaderUrl(publicId)}"))()`;
}

function copyLoadstring(scriptId) {
  const script = cachedScripts.find(s => s.scriptId === scriptId);
  if (!script) return;
  navigator.clipboard.writeText(getLoadstring(script.publicId));
  showToast('Loadstring copied! ⚡', 'success');
}

async function editScript(scriptId) {
  try {
    const res = await fetch(`/api/scripts/${scriptId}`, { headers: authHeaders() });
    if (res.status === 401) {
      handleLogout();
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      showToast(data.error || 'Could not load script', 'error');
      return;
    }

    editingId = scriptId;
    document.getElementById('script-filename').value = data.script.filename;
    document.getElementById('editor-title').innerText = `Editing script (${data.script.filename})`;
    document.getElementById('upload-btn').innerText = 'Save changes';

    const textarea = document.getElementById('script-content');
    textarea.value = data.script.content;
    textarea.dispatchEvent(new Event('input'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    showToast('Network error while loading the script', 'error');
  }
}

async function toggleScript(scriptId) {
  try {
    const res = await fetch(`/api/scripts/${scriptId}/toggle`, { method: 'POST', headers: authHeaders() });
    if (res.status === 401) {
      handleLogout();
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      showToast(data.error || 'Could not update script', 'error');
      return;
    }
    showToast(`Script ${data.script.enabled ? 'enabled' : 'disabled'}`, 'success');
    loadScriptList();
  } catch (e) {
    showToast('Network error while updating the script', 'error');
  }
}

async function rotateScript(scriptId) {
  try {
    const res = await fetch(`/api/scripts/${scriptId}/rotate`, { method: 'POST', headers: authHeaders() });
    if (res.status === 401) {
      handleLogout();
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      showToast(data.error || 'Could not rotate link', 'error');
      return;
    }
    showToast('Loadstring link rotated — old links stop working immediately', 'success');
    loadScriptList();
  } catch (e) {
    showToast('Network error while rotating the link', 'error');
  }
}

async function deleteScript(scriptId) {
  try {
    const res = await fetch(`/api/scripts/${scriptId}`, { method: 'DELETE', headers: authHeaders() });
    if (res.status === 401) {
      handleLogout();
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      showToast(data.error || 'Could not delete script', 'error');
      return;
    }
    showToast('Script deleted', 'success');
    loadScriptList();
  } catch (e) {
    showToast('Network error while deleting the script', 'error');
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}
