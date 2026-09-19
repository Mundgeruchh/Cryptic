// cryptographically random identifiers — never derived from filenames or user input

export function newScriptId() {
  return crypto.randomUUID();
}

export function newPublicId() {
  return crypto.randomUUID().replace(/-/g, '');
}
