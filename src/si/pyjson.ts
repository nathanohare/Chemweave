// JSON written exactly as Chem SI Assistant writes it (Python's json.dumps(obj, indent=2,
// ensure_ascii=False) plus a newline), so a project saved here and there gives the same
// files and a sync program or git sees only what really changed.
//
// The one thing JavaScript loses on reading is a whole number written as a decimal ("5.0",
// which Python keeps as a float): reading remembers where those were, and writing puts the
// ".0" back, also when the value there has been changed since.

/** Values read as decimals: the objects and arrays they are in, and their keys. */
const floats = new WeakMap<object, Set<string>>();

/** Mark `key` of `holder` as a decimal (written with ".0" when whole). */
export function markFloat(holder: object, key: string | number): void {
  let set = floats.get(holder);
  if (!set) floats.set(holder, (set = new Set()));
  set.add(String(key));
}

/** Copy the decimal marks of `from`'s own keys to `to` (after copying an object with {...from}). */
export function copyFloats(from: object, to: object): void {
  const set = floats.get(from);
  if (set) for (const k of set) markFloat(to, k);
}

const isFloat = (holder: object, key: string | number): boolean => floats.get(holder)?.has(String(key)) ?? false;

/** Read JSON text (a byte-order mark at the start is skipped, as Python's utf-8-sig does). */
export function parsePyJson(text: string): unknown {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let i = 0;
  const n = text.length;
  const fail = (what: string): never => { throw new SyntaxError(`${what} at character ${i}`); };
  const ws = (): void => { while (i < n && (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t')) i++; };
  const str = (): string => {
    // the quote is at i
    const start = ++i;
    let simple = true;
    while (i < n && text[i] !== '"') {
      if (text[i] === '\\') { simple = false; i += 2; } else i++;
    }
    if (i >= n) fail('Unterminated string');
    const raw = text.slice(start, i++);
    return simple ? raw : (JSON.parse(`"${raw}"`) as string);
  };
  // returns [value, written as a decimal]
  const val = (): [unknown, boolean] => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const o: Record<string, unknown> = {};
      ws();
      if (text[i] === '}') { i++; return [o, false]; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('Expected a key');
        const k = str();
        ws();
        if (text[i++] !== ':') fail('Expected ":"');
        const [v, f] = val();
        // (a key read twice: the last wins, as in Python; "__proto__" stays an ordinary key)
        Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
        if (f) markFloat(o, k);
        ws();
        const d = text[i++];
        if (d === '}') return [o, false];
        if (d !== ',') fail('Expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const a: unknown[] = [];
      ws();
      if (text[i] === ']') { i++; return [a, false]; }
      for (;;) {
        const [v, f] = val();
        if (f) markFloat(a, a.length);
        a.push(v);
        ws();
        const d = text[i++];
        if (d === ']') return [a, false];
        if (d !== ',') fail('Expected "," or "]"');
      }
    }
    if (c === '"') return [str(), false];
    if (text.startsWith('true', i)) { i += 4; return [true, false]; }
    if (text.startsWith('false', i)) { i += 5; return [false, false]; }
    if (text.startsWith('null', i)) { i += 4; return [null, false]; }
    // Python writes NaN and Infinity too (json.dumps allows them by default)
    if (text.startsWith('NaN', i)) { i += 3; return [NaN, true]; }
    if (text.startsWith('Infinity', i)) { i += 8; return [Infinity, true]; }
    if (text.startsWith('-Infinity', i)) { i += 9; return [-Infinity, true]; }
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (!m) fail('Unexpected character');
    i += m![0].length;
    return [Number(m![0]), !!(m![1] || m![2])];
  };
  const [v] = val();
  ws();
  if (i < n) fail('Unexpected text after the JSON');
  return v;
}

/** A decimal as Python's repr writes it: "5.0", "0.1", "1e-05", "1.5e+16". */
export function pyFloat(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  // the shortest digits that read back as x, and the exponent
  const [mant, expText] = x.toExponential().split('e');
  const exp = Number(expText);
  const neg = mant.startsWith('-');
  const digits = mant.replace('-', '').replace('.', '');
  let out: string;
  if (exp >= -4 && exp < 16) {
    if (exp >= 0) {
      const whole = digits.length > exp + 1 ? digits.slice(0, exp + 1) : digits.padEnd(exp + 1, '0');
      const frac = digits.slice(exp + 1);
      out = `${whole}.${frac || '0'}`;
    } else out = `0.${'0'.repeat(-exp - 1)}${digits}`;
  } else {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    out = `${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return (neg ? '-' : '') + out;
}

/** A string as Python writes it with ensure_ascii=False. */
function pyString(s: string): string {
  // JSON.stringify escapes the same characters (", \, control characters) the same way, but
  // writes a lone surrogate as \udxxx where Python keeps it; Python can't then save it as UTF-8 either
  return JSON.stringify(s);
}

function write(v: unknown, indent: string, out: string[], holder: object | null, key: string | number): void {
  if (v === null || v === undefined) { out.push('null'); return; }
  if (typeof v === 'boolean') { out.push(v ? 'true' : 'false'); return; }
  if (typeof v === 'number') {
    if (holder && isFloat(holder, key)) out.push(pyFloat(v));
    else if (Number.isInteger(v)) out.push(String(v));
    else out.push(pyFloat(v));
    return;
  }
  if (typeof v === 'string') { out.push(pyString(v)); return; }
  const inner = indent + '  ';
  if (Array.isArray(v)) {
    if (!v.length) { out.push('[]'); return; }
    out.push('[\n');
    v.forEach((x, k) => {
      if (k) out.push(',\n');
      out.push(inner);
      write(x, inner, out, v, k);
    });
    out.push('\n', indent, ']');
    return;
  }
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined);
  if (!keys.length) { out.push('{}'); return; }
  out.push('{\n');
  keys.forEach((k, j) => {
    if (j) out.push(',\n');
    out.push(inner, pyString(k), ': ');
    write(o[k], inner, out, o, k);
  });
  out.push('\n', indent, '}');
}

/** JSON text as Chem SI Assistant writes it, with the newline at the end. */
export function dumpPyJson(v: unknown): string {
  const out: string[] = [];
  write(v, '', out, null, '');
  return out.join('') + '\n';
}
