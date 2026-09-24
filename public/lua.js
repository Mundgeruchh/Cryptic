const LUA_KEYWORDS = new Set([
  'and', 'break', 'continue', 'do', 'else', 'elseif', 'end', 'for', 'function', 'if', 'in',
  'local', 'not', 'or', 'repeat', 'return', 'then', 'until', 'while', 'export', 'type'
]);

const LUA_CONSTANTS = new Set(['true', 'false', 'nil']);

const LUA_BUILTINS = new Set([
  'print', 'warn', 'error', 'assert', 'pcall', 'xpcall', 'pairs', 'ipairs', 'next', 'select',
  'tostring', 'tonumber', 'type', 'typeof', 'rawget', 'rawset', 'rawequal', 'rawlen',
  'setmetatable', 'getmetatable', 'require', 'unpack', 'loadstring', 'tick', 'time', 'wait',
  'spawn', 'delay', 'task', 'string', 'table', 'math', 'os', 'coroutine', 'debug', 'utf8',
  'bit32', 'buffer', 'Instance', 'Vector2', 'Vector3', 'CFrame', 'Color3', 'UDim2', 'UDim',
  'Enum', 'Ray', 'Rect', 'TweenInfo', 'BrickColor', 'NumberRange', 'NumberSequence',
  'ColorSequence', 'Random', 'game', 'workspace', 'script', 'shared', '_G', '_VERSION',
  'getgenv', 'getrenv', 'getgc', 'getupvalues', 'getupvalue', 'setupvalue', 'getconstants',
  'hookfunction', 'hookmetamethod', 'getrawmetatable', 'setreadonly', 'newcclosure',
  'checkcaller', 'getnamecallmethod', 'request', 'http_request', 'Drawing', 'syn', 'fireclickdetector',
  'firetouchinterest', 'fireproximityprompt', 'firesignal', 'getconnections', 'setclipboard',
  'writefile', 'readfile', 'isfile', 'isfolder', 'makefolder', 'listfiles', 'delfile',
  'identifyexecutor', 'queue_on_teleport', 'cloneref', 'gethui', 'getinstances', 'getnilinstances'
]);

const LUA_OPERATORS = '+-*/%^#=~<>.:;,(){}[]&|';

function escapeCodeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function readLongBracket(src, start) {
  const match = /^\[(=*)\[/.exec(src.slice(start, start + 40));
  if (!match) return -1;
  const close = ']' + match[1] + ']';
  const end = src.indexOf(close, start + match[0].length);
  return end === -1 ? src.length : end + close.length;
}

function highlightLua(src) {
  let out = '';
  let i = 0;
  let prevWord = '';

  const push = (cls, text) => {
    const safe = escapeCodeHtml(text);
    out += cls ? `<span class="tok-${cls}">${safe}</span>` : safe;
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === '-' && src[i + 1] === '-') {
      const long = src[i + 2] === '[' ? readLongBracket(src, i + 2) : -1;
      let end;
      if (long !== -1) {
        end = long;
      } else {
        end = src.indexOf('\n', i);
        if (end === -1) end = src.length;
      }
      push('comment', src.slice(i, end));
      i = end;
      continue;
    }

    if (ch === '[' && (src[i + 1] === '[' || src[i + 1] === '=')) {
      const end = readLongBracket(src, i);
      if (end !== -1) {
        push('string', src.slice(i, end));
        i = end;
        continue;
      }
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        j++;
      }
      j = Math.min(j + 1, src.length);
      push('string', src.slice(i, j));
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const match = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|[0-9][0-9_]*\.?[0-9_]*(?:[eE][+-]?[0-9]+)?|\.[0-9_]+(?:[eE][+-]?[0-9]+)?)/.exec(src.slice(i, i + 64));
      const text = match ? match[0] : ch;
      push('number', text);
      i += text.length;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      let k = j;
      while (src[k] === ' ' || src[k] === '\t') k++;
      const isCall = src[k] === '(' || src[k] === '"' || src[k] === "'" || src[k] === '{';

      if (LUA_CONSTANTS.has(word)) push('constant', word);
      else if (LUA_KEYWORDS.has(word) && !(word === 'type' && isCall) && !(word === 'continue' && isCall)) push('keyword', word);
      else if (prevWord === 'function') push('function', word);
      else if (LUA_BUILTINS.has(word)) push('builtin', word);
      else if (isCall) push('function', word);
      else push('', word);

      prevWord = word;
      i = j;
      continue;
    }

    if (LUA_OPERATORS.includes(ch)) {
      push('operator', ch);
      i++;
      continue;
    }

    push('', ch);
    i++;
  }

  return out;
}
