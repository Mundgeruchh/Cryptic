const AUTH_KEY = 'cryptic_auth_token';
const EMAIL_KEY = 'cryptic_auth_email';
let cachedScripts = [];
let localStore = {};

document.addEventListener('DOMContentLoaded', () => {
  setupEditorListeners();
  initGoogleAuth();
});

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
    errBanner.innerText = 'Error: ' + err.message;
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
  document.getElementById('script-filename').value = '';
  const textarea = document.getElementById('script-content');
  textarea.value = '';
  document.getElementById('editor-title').innerText = 'Create new script';
  textarea.dispatchEvent(new Event('input'));
  showToast('Editor cleared', 'success');
}

const PROTECTION_SNIPPET = `-- Cryptic protection snippet (best-effort hurdle, no guaranteed protection)
-- Bails out if known executor dump/debug functions are detected.
local function crypticProtectionCheck()
    local suspicious = { "getgc", "getgenv", "hookfunction", "getrawmetatable", "getupvalue", "debug_getupvalue" }
    local hits = 0
    for _, name in ipairs(suspicious) do
        if type(_G[name]) == "function" or type(getfenv()[name]) == "function" then
            hits = hits + 1
        end
    end
    if hits >= 3 then
        pcall(function() game:Shutdown() end)
        while true do end
    end
end
crypticProtectionCheck()

`;

function insertProtectionSnippet() {
  const textarea = document.getElementById('script-content');
  if (textarea.value.includes('crypticProtectionCheck')) {
    showToast('Snippet is already present', 'info');
    return;
  }
  textarea.value = PROTECTION_SNIPPET + textarea.value;
  textarea.dispatchEvent(new Event('input'));
  showToast('Protection snippet inserted (not 100% foolproof!)', 'success');
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

  localStore[filename] = content;

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ filename, content })
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      showToast(`Script "${filename}" uploaded!`, 'success');
    } else if (res.status === 401) {
      showToast('Session expired, please sign in again', 'error');
      handleLogout();
      return;
    } else {
      showToast(`Failed to save "${filename}": ${data.error || res.statusText}`, 'error');
      return;
    }
  } catch (e) {
    showToast(`Failed to save "${filename}": ${e.message}`, 'error');
    return;
  }

  clearEditor();
  loadScriptList();
}

// library

async function loadScriptList() {
  const container = document.getElementById('script-list-container');

  try {
    const res = await fetch('/api/list', { headers: authHeaders() });
    if (res.status === 401) {
      handleLogout();
      return;
    }
    const data = await res.json().catch(() => ({}));
    let files = (res.ok && Array.isArray(data.files)) ? data.files : [];

    for (const key of Object.keys(localStore)) {
      if (!files.find(f => f.name === key)) {
        files.push({ name: key });
      }
    }

    cachedScripts = files;
    renderScriptList(cachedScripts);
  } catch (err) {
    const files = Object.keys(localStore).map(k => ({ name: k }));
    cachedScripts = files;
    renderScriptList(files);
  }
}

function renderScriptList(scripts) {
  const container = document.getElementById('script-list-container');
  const statScripts = document.getElementById('stat-scripts');
  if (statScripts) statScripts.innerText = scripts.length;

  if (scripts.length === 0) {
    container.innerHTML = '<div class="empty-state">No scripts yet. Create your first script above!</div>';
    return;
  }

  container.innerHTML = scripts.map((script, i) => {
    return `
    <div class="script-card fade-in" style="--delay:${(i * 0.04).toFixed(2)}s">
      <div class="script-card-header">
        <span class="script-card-title">${escapeHtml(script.name)}</span>
      </div>
      <div class="script-card-actions">
        <button class="btn btn-primary btn-sm" onclick="copyLoadstring('${script.name}')">⚡ Copy Loadstring</button>
        <button class="btn btn-secondary btn-sm" onclick="copyRawLink('${script.name}')">📋 Copy Link</button>
        <button class="btn btn-secondary btn-sm" onclick="editScript('${script.name}')">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteScript('${script.name}')">🗑️ Delete</button>
      </div>
    </div>
  `;
  }).join('');
}

function filterScripts() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const filtered = cachedScripts.filter(s => s.name.toLowerCase().includes(query));
  renderScriptList(filtered);
}

// actions

function getRawUrl(filename) {
  return `${window.location.origin}/api/raw?file=${encodeURIComponent(filename)}`;
}

function getLoadstring(rawUrl) {
  return `loadstring(game:HttpGet("${rawUrl}"))()`;
}

function copyRawLink(filename) {
  const rawUrl = getRawUrl(filename);
  navigator.clipboard.writeText(rawUrl);
  showToast('Raw link copied!', 'success');
}

function copyLoadstring(filename) {
  const rawUrl = getRawUrl(filename);
  const code = getLoadstring(rawUrl);
  navigator.clipboard.writeText(code);
  showToast('Loadstring copied! ⚡', 'success');
}

async function editScript(filename) {
  document.getElementById('script-filename').value = filename;
  document.getElementById('editor-title').innerText = `Editing script (${filename})`;

  if (localStore[filename]) {
    const textarea = document.getElementById('script-content');
    textarea.value = localStore[filename];
    textarea.dispatchEvent(new Event('input'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  try {
    const res = await fetch(getRawUrl(filename));
    if (res.ok) {
      const text = await res.text();
      localStore[filename] = text;
      const textarea = document.getElementById('script-content');
      textarea.value = text;
      textarea.dispatchEvent(new Event('input'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } catch (e) {}
}

async function deleteScript(filename) {
  delete localStore[filename];

  try {
    const res = await fetch(`/api/delete?file=${encodeURIComponent(filename)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (res.status === 401) {
      handleLogout();
      return;
    }
  } catch (e) {}

  showToast(`Script "${filename}" deleted`, 'success');
  loadScriptList();
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
