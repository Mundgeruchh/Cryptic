import { requireAuth, unauthorized } from './_lib/auth.js';

const TREE_KEY = '__tree__';
const FILE_PREFIX = '__f:';
const LINK_PREFIX = '__l:';
const SLUG_PATTERN = /^[a-zA-Z0-9_\-.]{1,120}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fail = (error, status = 400) => json({ success: false, error }, status);

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

const randomSlug = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

const sanitizeSlug = (name) => name.replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 120);

async function loadTree(env) {
  const tree = await env.SCRIPTS_KV.get(TREE_KEY, 'json');
  return tree && tree.nodes ? tree : { nodes: {} };
}

async function saveTree(env, tree) {
  await env.SCRIPTS_KV.put(TREE_KEY, JSON.stringify(tree));
}

async function importLegacyFiles(env, tree) {
  const known = new Set(Object.values(tree.nodes).map(n => n.link).filter(Boolean));
  let cursor;
  let changed = false;

  do {
    const page = await env.SCRIPTS_KV.list({ cursor });
    cursor = page.list_complete ? null : page.cursor;

    for (const { name } of page.keys) {
      if (name.startsWith('__') || known.has(name)) continue;
      const content = await env.SCRIPTS_KV.get(name);
      if (content === null) continue;

      const id = newId();
      await env.SCRIPTS_KV.put(FILE_PREFIX + id, content);
      await env.SCRIPTS_KV.put(LINK_PREFIX + name, id);
      await env.SCRIPTS_KV.delete(name);

      tree.nodes[id] = {
        id,
        type: 'file',
        name,
        parent: null,
        link: name,
        size: content.length,
        updated: Date.now()
      };
      known.add(name);
      changed = true;
    }
  } while (cursor);

  if (changed) await saveTree(env, tree);
}

function isDescendant(tree, nodeId, ancestorId) {
  let current = tree.nodes[nodeId];
  while (current) {
    if (current.id === ancestorId) return true;
    current = current.parent ? tree.nodes[current.parent] : null;
  }
  return false;
}

function nameTaken(tree, parent, name, exceptId) {
  const lower = name.toLowerCase();
  return Object.values(tree.nodes).some(
    n => n.parent === parent && n.id !== exceptId && n.name.toLowerCase() === lower
  );
}

function linkTaken(tree, link, exceptId) {
  return Object.values(tree.nodes).some(n => n.link === link && n.id !== exceptId);
}

function validName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 120 && !/[\/\\\0]/.test(name) && name !== '.' && name !== '..';
}

function validParent(tree, parent) {
  return !parent || (tree.nodes[parent] && tree.nodes[parent].type === 'folder');
}

function pickLink(tree, name, exceptId) {
  const slug = sanitizeSlug(name);
  if (SLUG_PATTERN.test(slug) && !slug.startsWith('__') && !linkTaken(tree, slug, exceptId)) return slug;
  return randomSlug();
}

const linkValue = (node) => (node.notify ? JSON.stringify({ id: node.id, name: node.name }) : node.id);

const writeLink = (env, node) => env.SCRIPTS_KV.put(LINK_PREFIX + node.link, linkValue(node));

async function applyLink(env, node, link) {
  if (node.link === link) return;
  if (node.link) await env.SCRIPTS_KV.delete(LINK_PREFIX + node.link);
  node.link = link;
  await writeLink(env, node);
}

async function removeNode(env, tree, id) {
  const node = tree.nodes[id];
  if (!node) return;
  if (node.type === 'folder') {
    const children = Object.values(tree.nodes).filter(n => n.parent === id);
    for (const child of children) await removeNode(env, tree, child.id);
  } else {
    await env.SCRIPTS_KV.delete(FILE_PREFIX + id);
    if (node.link) await env.SCRIPTS_KV.delete(LINK_PREFIX + node.link);
  }
  delete tree.nodes[id];
}

const actions = {
  async save(env, tree, body) {
    const { id, name } = body;
    const parent = body.parent || null;
    const binary = typeof body.contentBase64 === 'string';
    let content;
    let size;
    if (binary) {
      content = Uint8Array.from(atob(body.contentBase64), c => c.charCodeAt(0));
      size = content.length;
    } else if (typeof body.content === 'string') {
      content = body.content;
      size = new TextEncoder().encode(content).length;
    } else {
      return fail('Content is required');
    }

    if (id) {
      const node = tree.nodes[id];
      if (!node || node.type !== 'file') return fail('File not found', 404);
      await env.SCRIPTS_KV.put(FILE_PREFIX + id, content);
      node.size = size;
      node.binary = binary;
      node.updated = Date.now();
      await saveTree(env, tree);
      return json({ success: true, node });
    }

    if (!validName(name)) return fail('Invalid file name');
    if (!validParent(tree, parent)) return fail('Target folder not found', 404);
    if (nameTaken(tree, parent, name)) return fail(`"${name}" already exists in this folder`);

    const node = {
      id: newId(),
      type: 'file',
      name,
      parent,
      link: null,
      binary,
      size,
      updated: Date.now()
    };
    tree.nodes[node.id] = node;
    await env.SCRIPTS_KV.put(FILE_PREFIX + node.id, content);
    await applyLink(env, node, body.randomLink ? randomSlug() : pickLink(tree, name, node.id));
    await saveTree(env, tree);
    return json({ success: true, node });
  },

  async mkdir(env, tree, body) {
    const { name } = body;
    const parent = body.parent || null;
    if (!validName(name)) return fail('Invalid folder name');
    if (!validParent(tree, parent)) return fail('Target folder not found', 404);
    if (nameTaken(tree, parent, name)) return fail(`"${name}" already exists in this folder`);

    const node = { id: newId(), type: 'folder', name, parent, updated: Date.now() };
    tree.nodes[node.id] = node;
    await saveTree(env, tree);
    return json({ success: true, node });
  },

  async rename(env, tree, { id, name }) {
    const node = tree.nodes[id];
    if (!node) return fail('Not found', 404);
    if (!validName(name)) return fail('Invalid name');
    if (nameTaken(tree, node.parent, name, id)) return fail(`"${name}" already exists in this folder`);
    node.name = name;
    node.updated = Date.now();
    if (node.type === 'file' && node.notify && node.link) await writeLink(env, node);
    await saveTree(env, tree);
    return json({ success: true, node });
  },

  async move(env, tree, body) {
    const node = tree.nodes[body.id];
    const parent = body.parent || null;
    if (!node) return fail('Not found', 404);
    if (!validParent(tree, parent)) return fail('Target folder not found', 404);
    if (parent && isDescendant(tree, parent, node.id)) return fail('Cannot move a folder into itself');
    if (node.parent === parent) return json({ success: true, node });
    if (nameTaken(tree, parent, node.name, node.id)) return fail(`"${node.name}" already exists in the target folder`);
    node.parent = parent;
    await saveTree(env, tree);
    return json({ success: true, node });
  },

  async remove(env, tree, { id }) {
    if (!tree.nodes[id]) return fail('Not found', 404);
    await removeNode(env, tree, id);
    await saveTree(env, tree);
    return json({ success: true });
  },

  async setnotify(env, tree, { id, notify }) {
    const node = tree.nodes[id];
    if (!node || node.type !== 'file') return fail('File not found', 404);
    node.notify = Boolean(notify);
    if (node.link) await writeLink(env, node);
    await saveTree(env, tree);
    return json({ success: true, node });
  },

  async setlink(env, tree, { id, mode, link }) {
    const node = tree.nodes[id];
    if (!node || node.type !== 'file') return fail('File not found', 404);

    let next;
    if (mode === 'random') {
      next = randomSlug();
    } else if (mode === 'name') {
      next = sanitizeSlug(node.name);
      if (next.startsWith('__') || linkTaken(tree, next, id)) return fail(`Link "${next}" is already used by another file`);
    } else if (mode === 'custom') {
      if (typeof link !== 'string' || !SLUG_PATTERN.test(link) || link.startsWith('__')) {
        return fail('Custom link may only contain letters, numbers, "_", "-" and "."');
      }
      if (linkTaken(tree, link, id)) return fail(`Link "${link}" is already used by another file`);
      next = link;
    } else {
      return fail('Unknown link mode');
    }

    await applyLink(env, node, next);
    await saveTree(env, tree);
    return json({ success: true, node });
  }
};

export async function onRequestGet({ request, env }) {
  try {
    const email = await requireAuth(request, env);
    if (!email) return unauthorized();
    if (!env.SCRIPTS_KV) return fail('KV namespace SCRIPTS_KV is not bound', 500);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const tree = await loadTree(env);

    if (id) {
      const node = tree.nodes[id];
      if (!node || node.type !== 'file') return fail('File not found', 404);
      if (node.binary) return json({ success: true, node, content: '' });
      const content = await env.SCRIPTS_KV.get(FILE_PREFIX + id);
      return json({ success: true, node, content: content ?? '' });
    }

    if (url.searchParams.get('sync') === '1') await importLegacyFiles(env, tree);
    return json({ success: true, nodes: Object.values(tree.nodes) });
  } catch (err) {
    return fail(err.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const email = await requireAuth(request, env);
    if (!email) return unauthorized();
    if (!env.SCRIPTS_KV) return fail('KV namespace SCRIPTS_KV is not bound', 500);

    const body = await request.json();
    const handler = actions[body.action];
    if (!handler) return fail('Unknown action');

    const tree = await loadTree(env);
    return await handler(env, tree, body);
  } catch (err) {
    return fail(err.message, 500);
  }
}
