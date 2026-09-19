// small KV helpers shared by the script-storage endpoints

export const KEY = {
  meta: (scriptId) => `script:${scriptId}`,
  code: (scriptId) => `scriptcode:${scriptId}`,
  publicId: (publicId) => `publicid:${publicId}`,
  count: (scriptId) => `count:${scriptId}`,
  countTotal: 'count:__total__'
};

export async function getJSON(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export async function putJSON(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}
