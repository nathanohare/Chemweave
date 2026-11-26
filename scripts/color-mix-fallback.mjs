// WebKit older than Safari 16.2 (every app on macOS 12) has no color-mix(): a property that uses
// it is dropped, so icons drawn in a mixed color vanish. This PostCSS plugin (vite.config.ts) adds,
// after each rule that uses it, the same properties with a plain color, for those engines only.

const TEST = 'not (color: color-mix(in srgb, red 50%, blue))';
/** A state that has to stay visible: its mixed background becomes a gray see-through one. */
const STATE = /:hover|:active|aria-(?:pressed|selected|checked|current)|\.(?:active|on|selected|sel|current|nav-here|kb-bound|kb-modkey|si-warnings)\b/;

/** Split at commas outside brackets. */
function parts(text) {
  const out = [];
  let depth = 0, last = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && !depth) { out.push(text.slice(last, i)); last = i + 1; }
  }
  out.push(text.slice(last));
  return out.map((p) => p.trim());
}

/** The plain color that stands in for color-mix(in …, a p%, b q%). */
function plain(inside, state) {
  const [, first, second] = parts(inside);
  const share = (c) => {
    const m = /^(.*?)\s+(\d+(?:\.\d+)?)%$/.exec(c);
    return m ? [m[1], Number(m[2])] : [c, null];
  };
  const [a, p] = share(first), [b, q] = share(second);
  const pa = p ?? (q === null ? 50 : 100 - q), pb = q ?? 100 - pa;
  // a see-through mix: gray at the same strength reads on light and dark themes alike
  if (a === 'transparent' || b === 'transparent') {
    const alpha = (a === 'transparent' ? pb : pa) / 100;
    const color = a === 'transparent' ? b : a;
    return alpha >= 0.7 ? replaceMixes(color, state) : `rgba(128, 128, 128, ${Math.max(0.14, alpha).toFixed(2)})`;
  }
  if (state && Math.min(pa, pb) < 30) return 'rgba(128, 128, 128, 0.22)';
  return replaceMixes(pa >= pb ? a : b, state);
}

/** `value` with every color-mix() in it replaced. */
export function replaceMixes(value, state = false) {
  let out = '', at = 0;
  for (;;) {
    const start = value.indexOf('color-mix(', at);
    if (start < 0) return out + value.slice(at);
    let depth = 0, end = start + 'color-mix'.length;
    for (; end < value.length; end++) {
      if (value[end] === '(') depth++;
      else if (value[end] === ')' && !--depth) break;
    }
    out += value.slice(at, start) + plain(value.slice(start + 'color-mix('.length, end), state);
    at = end + 1;
  }
}

export default function colorMixFallback() {
  return {
    postcssPlugin: 'color-mix-fallback',
    OnceExit(root, { AtRule }) {
      const rules = [];
      root.walkRules((rule) => {
        if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
        if (rule.nodes.some((n) => n.type === 'decl' && n.value.includes('color-mix('))) rules.push(rule);
      });
      for (const rule of rules) {
        if (rule.parent.type === 'atrule' && rule.parent.params === TEST) continue;
        const copy = rule.clone();
        copy.removeAll();
        for (const decl of rule.nodes) {
          if (decl.type !== 'decl' || !decl.value.includes('color-mix(')) continue;
          const state = decl.prop.startsWith('background') && STATE.test(rule.selector);
          copy.append(decl.clone({ value: replaceMixes(decl.value, state) }));
        }
        const only = new AtRule({ name: 'supports', params: TEST });
        only.append(copy);
        rule.after(only);
      }
    },
  };
}
colorMixFallback.postcss = true;
