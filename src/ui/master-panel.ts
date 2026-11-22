// Slide Master view's side panel (review round 2, finding 15). With a placeholder picked on the
// master's or a layout's page: its font, size, color, bold and italic, alignment, bullets, line
// spacing, space before and after, and its box. On a layout's page, values it takes from the
// master are gray and italic; ones it sets itself have a ↺ to give them back to the master. With
// nothing picked: the master's settings beside its page (background, template shapes, title
// slides' colors, logo, slide numbers, footer, structures), or the layout's name and colors.

import { addInfo } from './info-tip';
import type { Caption, Doc, Placeholder } from '../model';
import { type Deck, type Master, type Corner, type Image, type PlaceholderFmt, DECORS, type Decor, frameFields, masterFmt, placeholderRect } from '../deck/deck';
import { MASTER_PAGE, captionLook, withLayout } from '../deck/master-view';
import { scaleStyle } from '../drawing-styles';

export interface MasterPanelHooks {
  deck(): Deck | null;
  /** The app's document (the page being edited). */
  doc(): Doc;
  /** The placeholders picked on the page. */
  picked(): Caption[];
  /** Stop typing in a text box first. */
  finishTyping(): void;
  pickPicture(): Promise<Image | null>;
}

const PH_NAME: Record<Placeholder, string> = { title: 'Title', subtitle: 'Subtitle', body: 'Text' };
const CORNERS: [Corner, string][] = [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']];
const pct = (v: number) => String(Math.round(v * 1000) / 10);

export class MasterPanel {
  /** What the panel shows now (its controls are made again only when this changes). */
  private shown = '';
  /** Each control's way of showing the current value. */
  private fills: (() => void)[] = [];

  constructor(private el: HTMLElement, private hooks: MasterPanelHooks) {}

  /** Show what is picked on the page being edited (hidden outside Slide Master view). */
  refresh(): void {
    const deck = this.hooks.deck();
    const on = !!deck?.inMasterView;
    this.el.hidden = !on;
    if (!deck || !on) { this.shown = ''; return; }
    const caps = this.hooks.picked();
    const page = deck.current?.layout ?? '';
    const key = caps.length ? `ph:${page}:${caps.map((c) => c.id).join(',')}` : page === MASTER_PAGE ? 'master' : `layout:${page}`;
    if (key !== this.shown) {
      this.shown = key;
      this.fills = [];
      this.el.replaceChildren();
      if (caps.length) this.placeholder(deck, caps);
      else if (page === MASTER_PAGE) this.master(deck);
      else this.layout(deck);
    }
    // (not while a value is being typed into the panel)
    if (!this.el.contains(document.activeElement) || document.activeElement === document.body) for (const f of this.fills) f();
  }

  // ---------------------------------------------------------------- building blocks

  private head(text: string, info: string): void {
    const h = document.createElement('h2');
    h.textContent = text;
    addInfo(h, info);
    this.el.append(h);
  }

  private sub(text: string): void {
    const h = document.createElement('h3');
    h.textContent = text;
    this.el.append(h);
  }

  /** A row: its label, its controls, and a ↺ to give it back to the master (shown by `own`). */
  private row(label: string, els: HTMLElement[], reset?: { own: () => boolean; run: () => void }): HTMLElement {
    const r = document.createElement('div');
    r.className = 'mp-row';
    const l = document.createElement('span');
    l.className = 'mp-label';
    l.textContent = label;
    const box = document.createElement('span');
    box.className = 'mp-controls';
    box.append(...els);
    r.append(l, box);
    if (reset) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mp-reset';
      b.textContent = '↺';
      b.title = `Use the master's ${label.toLowerCase()}`;
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => reset.run());
      r.append(b);
      this.fills.push(() => { b.hidden = !reset.own(); });
    }
    this.el.append(r);
    return r;
  }

  private input(type: string, cls: string, onChange: (v: string) => void, attrs: Record<string, string> = {}): HTMLInputElement {
    const i = document.createElement('input');
    i.type = type;
    i.className = cls;
    for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
    i.addEventListener('change', () => onChange(i.value));
    return i;
  }

  private toggle(text: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mp-toggle';
    b.textContent = text;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  private check(label: string, onChange: (on: boolean) => void): { box: HTMLInputElement; label: HTMLLabelElement } {
    const l = document.createElement('label');
    l.className = 'mp-check';
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.addEventListener('change', () => onChange(i.checked));
    l.append(i, label);
    return { box: i, label: l };
  }

  private unit(t: string): HTMLElement {
    const u = document.createElement('span');
    u.className = 'mp-unit';
    u.textContent = t;
    return u;
  }

  // ---------------------------------------------------------------- a placeholder

  private placeholder(deck: Deck, picked: Caption[]): void {
    const doc = this.hooks.doc();
    const ids = picked.map((c) => c.id);
    const caps = () => ids.map((id) => doc.captions.get(id)).filter((c): c is Caption => !!c);
    const first = () => caps()[0];
    const isLayout = deck.current?.layout !== MASTER_PAGE;
    const def = deck.pageLayout();
    const kind = picked[0].ph!;
    const base = () => doc.textStyles?.[first()?.ph ?? kind];
    // the master's look for this kind of placeholder (what a layout's own values take the place of)
    const master = (): PlaceholderFmt => masterFmt(def ? withLayout(deck.master, def) : deck.master, first()?.ph ?? kind, def?.id);
    const edit = (label: string, fn: (c: Caption) => Partial<Caption>) => {
      this.hooks.finishTyping();
      doc.edit(label, () => { for (const c of caps()) doc.updateCaption(c.id, fn(c)); });
    };
    const setRuns = (label: string, k: 'font' | 'size' | 'color' | 'bold' | 'italic', v: unknown) => edit(label, (c) => ({
      runs: c.runs.map((r) => { const o = { ...r } as Record<string, unknown>; if (v === undefined) delete o[k]; else o[k] = v; return o as unknown as Caption['runs'][number]; }),
    }));
    const setPara = (label: string, patch: (p: NonNullable<Caption['paras']>[number]) => void) => edit(label, (c) => {
      const n = Math.max(1, ...[c.paras?.length ?? 0], 1 + c.runs.reduce((k, r) => k + (r.text.match(/\n/g)?.length ?? 0), 0));
      return { paras: Array.from({ length: n }, (_, i) => { const p = { ...(c.paras?.[i] ?? {}) }; patch(p); return p; }) };
    });
    const text = (k: 'font' | 'size' | 'color' | 'bold' | 'italic') => { const c = first(); return c?.runs[0]?.[k] ?? base()?.[k]; };
    const ownText = (k: 'font' | 'size' | 'color' | 'bold' | 'italic') => { const c = first(); return !!c && c.runs.some((r) => r[k] !== undefined); };
    const para = () => (first() ? captionLook(first()!).para : {});
    const ownPara = (k: 'lineSpacing' | 'spaceBefore' | 'spaceAfter' | 'bullet') => isLayout && para()[k] !== master()[k];
    const looks = (el: HTMLElement, inherited: () => boolean) => this.fills.push(() => el.classList.toggle('mp-inherited', isLayout && inherited()));

    this.head(picked.length > 1 ? 'Placeholders' : `${PH_NAME[kind]} Placeholder`, isLayout
      ? 'How this layout\'s placeholder looks on its slides. Gray values come from the slide master and follow it; ↺ gives a value of this layout\'s own back to the master. Text you format on a slide keeps its own look.'
      : 'How this kind of placeholder looks on every layout that doesn\'t set its own. Text you format on a slide keeps its own look.');

    this.sub('Font');
    const font = this.input('text', 'mp-text', (v) => setRuns('Font', 'font', v.trim() || undefined), { list: 'ci-fonts', 'aria-label': 'Font', spellcheck: 'false' });
    this.fills.push(() => { font.value = String(text('font') ?? ''); });
    looks(font, () => !ownText('font'));
    this.row('Font', [font], isLayout ? { own: () => ownText('font'), run: () => setRuns('Font', 'font', undefined) } : undefined);
    const size = this.input('number', 'mp-num', (v) => { const n = parseFloat(v); if (n > 0) setRuns('Font Size', 'size', n); }, { min: '4', max: '400', step: '1', 'aria-label': 'Size' });
    this.fills.push(() => { size.value = String(+(Number(text('size') ?? 18)).toFixed(1)); });
    looks(size, () => !ownText('size'));
    this.row('Size', [size, this.unit('pt')], isLayout ? { own: () => ownText('size'), run: () => setRuns('Font Size', 'size', undefined) } : undefined);
    const color = this.input('color', 'mp-color', (v) => setRuns('Font Color', 'color', v), { 'aria-label': 'Color' });
    this.fills.push(() => { const v = String(text('color') ?? '#000000'); color.value = /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'; });
    this.row('Color', [color], isLayout ? { own: () => ownText('color'), run: () => setRuns('Font Color', 'color', undefined) } : undefined);
    const bold = this.toggle('B', 'Bold', () => setRuns('Bold', 'bold', !text('bold')));
    const italic = this.toggle('I', 'Italic', () => setRuns('Italic', 'italic', !text('italic')));
    italic.classList.add('mp-italic');
    this.fills.push(() => { bold.setAttribute('aria-pressed', String(!!text('bold'))); italic.setAttribute('aria-pressed', String(!!text('italic'))); });
    this.row('Style', [bold, italic], isLayout ? { own: () => ownText('bold') || ownText('italic'), run: () => { setRuns('Bold', 'bold', undefined); setRuns('Italic', 'italic', undefined); } } : undefined);

    this.sub('Paragraph');
    const aligns = (['left', 'center', 'right'] as const).map((j) => this.toggle(j === 'left' ? '⇤' : j === 'center' ? '↔' : '⇥', `Align ${j[0].toUpperCase()}${j.slice(1)}`, () => edit('Align', () => ({ justify: j }))));
    this.fills.push(() => aligns.forEach((b, i) => b.setAttribute('aria-pressed', String(first()?.justify === ['left', 'center', 'right'][i]))));
    this.row('Align', aligns);
    const bullets = document.createElement('select');
    bullets.className = 'mp-select';
    bullets.setAttribute('aria-label', 'Bullets');
    for (const [v, l] of [['none', 'None'], ['bullet', 'Bullets'], ['number', 'Numbers']]) bullets.add(new Option(l, v));
    bullets.addEventListener('change', () => setPara('Bullets', (p) => { if (bullets.value === 'none') delete p.list; else p.list = bullets.value as 'bullet' | 'number'; }));
    this.fills.push(() => { bullets.value = String(para().bullet ?? 'none'); });
    looks(bullets, () => !ownPara('bullet'));
    this.row('Bullets', [bullets], isLayout ? { own: () => ownPara('bullet'), run: () => setPara('Bullets', (p) => { const m = master().bullet; if (!m || m === 'none') delete p.list; else p.list = m; }) } : undefined);
    const ls = this.input('number', 'mp-num', (v) => { const n = parseFloat(v); if (n > 0) edit('Line Spacing', () => ({ lineSpacing: n === 1 ? undefined : n })); }, { min: '0.5', max: '5', step: '0.1', 'aria-label': 'Line spacing' });
    this.fills.push(() => { ls.value = String(para().lineSpacing ?? 1); });
    looks(ls, () => !ownPara('lineSpacing'));
    this.row('Line spacing', [ls], isLayout ? { own: () => ownPara('lineSpacing'), run: () => edit('Line Spacing', () => ({ lineSpacing: master().lineSpacing === 1 ? undefined : master().lineSpacing })) } : undefined);
    for (const k of ['spaceBefore', 'spaceAfter'] as const) {
      const label = k === 'spaceBefore' ? 'Before' : 'After';
      const i = this.input('number', 'mp-num', (v) => { const n = Math.max(0, parseFloat(v) || 0); setPara(`Space ${label}`, (p) => { if (n) p[k] = n; else delete p[k]; }); }, { min: '0', max: '200', step: '1', 'aria-label': `Space ${label.toLowerCase()}` });
      this.fills.push(() => { i.value = String(para()[k] ?? 0); });
      looks(i, () => !ownPara(k));
      this.row(label, [i, this.unit('pt')], isLayout ? { own: () => ownPara(k), run: () => setPara(`Space ${label}`, (p) => { const m = master()[k]; if (m) p[k] = m; else delete p[k]; }) } : undefined);
    }

    if (picked.length === 1) {
      this.sub('Box');
      const { w: sw, h: sh } = deck.size;
      const rect = () => placeholderRect(first()!, base());
      const place = (patch: { x?: number; y?: number; w?: number; h?: number }) => {
        const c = first();
        if (!c) return;
        const r = rect();
        const f = { x: patch.x ?? r.x1, y: patch.y ?? r.y1, w: patch.w ?? r.x2 - r.x1, h: patch.h ?? r.y2 - r.y1 };
        const fields = frameFields({ ph: c.ph!, ...f, justify: c.justify }, { title: base() ?? {}, subtitle: base() ?? {}, body: base() ?? {} });
        edit('Move Placeholder', () => ({ x: fields.x, y: fields.y, wrap: fields.wrap, boxH: fields.boxH }));
      };
      const num = (label: string, get: () => number, set: (v: number) => void) => {
        const i = this.input('number', 'mp-num mp-pct', (v) => { const n = parseFloat(v); if (Number.isFinite(n)) set(n / 100); }, { step: '0.5', 'aria-label': label });
        this.fills.push(() => { if (first()) i.value = pct(get()); });
        return i;
      };
      const tag = (t: string) => this.unit(t);
      this.row('Position', [tag('X'), num('Left, % of the slide width', () => rect().x1 / sw, (v) => place({ x: v * sw })), tag('Y'), num('Top, % of the slide height', () => rect().y1 / sh, (v) => place({ y: v * sh })), this.unit('%')]);
      this.row('Size', [tag('W'), num('Width, % of the slide width', () => (rect().x2 - rect().x1) / sw, (v) => place({ w: v * sw })), tag('H'), num('Height, % of the slide height', () => (rect().y2 - rect().y1) / sh, (v) => place({ h: v * sh })), this.unit('%')]);
    }

    if (isLayout) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'mp-wide';
      reset.textContent = 'Reset Placeholder to Master';
      reset.title = 'Its font, size, color, bold, italic, bullets and spacing come from the slide master again';
      reset.addEventListener('click', () => {
        const m = master();
        edit('Reset Placeholder', (c) => ({
          runs: c.runs.map((r) => { const { font: _f, size: _s, color: _c, bold: _b, italic: _i, ...rest } = r; void _f; void _s; void _c; void _b; void _i; return rest; }),
          lineSpacing: m.lineSpacing === 1 ? undefined : m.lineSpacing,
          paras: (c.paras ?? [{}]).map((p) => {
            const o = { ...p };
            if (m.bullet && m.bullet !== 'none') o.list = m.bullet; else delete o.list;
            if (m.spaceBefore) o.spaceBefore = m.spaceBefore; else delete o.spaceBefore;
            if (m.spaceAfter) o.spaceAfter = m.spaceAfter; else delete o.spaceAfter;
            return o;
          }),
        }));
      });
      this.el.append(reset);
    }
  }

  // ---------------------------------------------------------------- the master

  private master(deck: Deck): void {
    const m = () => deck.master;
    const set = (patch: Partial<Master>) => { this.hooks.finishTyping(); deck.setMaster({ ...m(), ...patch }); };
    this.head('Slide Master', 'Every slide\'s background, shapes, logo, numbers and footer. Select the title or text box on the page to set the text styles every layout starts from.');

    this.sub('Text styles');
    const summary = (ph: Placeholder) => {
      const f = masterFmt(m(), ph);
      return `${f.font}, ${+(f.size ?? 0).toFixed(1)} pt${f.bold ? ', bold' : ''}${f.italic ? ', italic' : ''}${f.bullet && f.bullet !== 'none' ? (f.bullet === 'number' ? ', numbered' : ', •') : ''}`;
    };
    for (const ph of ['title', 'body'] as const) {
      const s = document.createElement('span');
      s.className = 'mp-value';
      this.fills.push(() => { s.textContent = summary(ph); });
      this.row(PH_NAME[ph], [s]);
    }
    const sub = this.input('number', 'mp-num', (v) => { const n = parseFloat(v); if (n > 0) set({ subtitleSize: n }); }, { min: '4', max: '200', 'aria-label': 'Subtitle size' });
    this.fills.push(() => { sub.value = String(m().subtitleSize); });
    this.row('Subtitle', [sub, this.unit('pt')]);

    this.sub('Background and shapes');
    const bg = this.input('color', 'mp-color', (v) => set({ background: v, fill: undefined }), { 'aria-label': 'Background color' });
    this.fills.push(() => { bg.value = m().background; });
    this.row('Background', [bg]);
    const decor = document.createElement('select');
    decor.className = 'mp-select';
    decor.setAttribute('aria-label', 'Template shapes');
    for (const x of DECORS) decor.add(new Option(x.name, x.id));
    decor.addEventListener('change', () => set({ decor: decor.value as Decor }));
    this.fills.push(() => { decor.value = m().decor; });
    this.row('Shapes', [decor]);
    const a1 = this.input('color', 'mp-color', (v) => set({ accent: v }), { 'aria-label': 'Accent color' });
    const a2 = this.input('color', 'mp-color', (v) => set({ accent2: v }), { 'aria-label': 'Second accent color' });
    this.fills.push(() => { a1.value = m().accent; a2.value = m().accent2; });
    this.row('Accents', [a1, a2]);
    const ts = this.check('Own colors', (on) => set({ titleSlide: on ? { background: '#1d3557', titleColor: '#ffffff', textColor: '#d9e2ec' } : undefined }));
    const tsBg = this.input('color', 'mp-color', (v) => set({ titleSlide: { ...m().titleSlide!, background: v, fill: undefined } }), { 'aria-label': 'Title slide background' });
    const tsTitle = this.input('color', 'mp-color', (v) => set({ titleSlide: { ...m().titleSlide!, titleColor: v } }), { 'aria-label': 'Title slide title color' });
    const tsText = this.input('color', 'mp-color', (v) => set({ titleSlide: { ...m().titleSlide!, textColor: v } }), { 'aria-label': 'Title slide text color' });
    this.fills.push(() => {
      const t = m().titleSlide;
      ts.box.checked = !!t;
      for (const [i, v] of [[tsBg, t?.background], [tsTitle, t?.titleColor], [tsText, t?.textColor]] as const) { i.hidden = !t; if (v) i.value = v; }
    });
    this.row('Title slides', [ts.label, tsBg, tsTitle, tsText]);

    this.sub('Logo, numbers and footer');
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.textContent = 'Choose…';
    choose.title = 'A picture in a corner of every slide';
    choose.addEventListener('click', async () => { const p = await this.hooks.pickPicture(); if (p) set({ logo: p }); });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => set({ logo: null }));
    const corner = document.createElement('select');
    corner.className = 'mp-select';
    corner.setAttribute('aria-label', 'Logo corner');
    for (const [v, l] of CORNERS) corner.add(new Option(l, v));
    corner.addEventListener('change', () => set({ logoCorner: corner.value as Corner }));
    this.fills.push(() => { remove.hidden = corner.hidden = !m().logo; corner.value = m().logoCorner; });
    this.row('Logo', [choose, remove, corner]);
    const nums = this.check('', (on) => set({ slideNumbers: on }));
    nums.box.setAttribute('aria-label', 'Slide numbers');
    const numsTitle = this.check('on title slides', (on) => set({ numberTitleSlides: on }));
    this.fills.push(() => { nums.box.checked = m().slideNumbers; numsTitle.box.checked = m().numberTitleSlides; });
    this.row('Slide numbers', [nums.label, numsTitle.label]);
    const footer = this.input('text', 'mp-text', (v) => set({ footer: v }), { 'aria-label': 'Footer', placeholder: 'e.g. Group meeting' });
    this.fills.push(() => { footer.value = m().footer; });
    this.row('Footer', [footer]);

    this.sub('Structures');
    const bond = this.input('number', 'mp-num', (v) => {
      const n = parseFloat(v);
      const d = m().drawing;
      if (n > 0 && Math.abs(n - d.bondLength) > 1e-6) set({ drawing: scaleStyle(d, n / d.bondLength) });
    }, { min: '2', max: '200', step: '0.1', 'aria-label': 'Bond length' });
    this.fills.push(() => { bond.value = String(+m().drawing.bondLength.toFixed(2)); });
    this.row('Bond length', [bond, this.unit('pt')]);
  }

  // ---------------------------------------------------------------- a layout

  private layout(deck: Deck): void {
    const def = () => deck.pageLayout();
    this.head('Layout', 'Select a placeholder to set how its text looks on this layout\'s slides; anything else drawn here is on every slide with this layout, behind the slide\'s own things.');
    const name = this.input('text', 'mp-text', (v) => { if (v.trim()) deck.setLayoutMeta({ name: v.trim() }, 'Rename Layout'); }, { 'aria-label': 'Layout name' });
    this.fills.push(() => { name.value = def()?.name ?? ''; });
    this.row('Name', [name]);
    const look = this.check('Title slide colors', (on) => deck.setLayoutMeta({ titleLook: on }, 'Title Slide Colors'));
    look.label.title = 'Slides with this layout have the title slides\' own background and text colors (Slide Master ▸ Title slides)';
    this.fills.push(() => { look.box.checked = !!def()?.titleLook; });
    this.row('Colors', [look.label]);
    const used = document.createElement('span');
    used.className = 'mp-value';
    this.fills.push(() => { const n = def() ? deck.layoutUses(def()!.id) : 0; used.textContent = n === 1 ? '1 slide' : `${n} slides`; });
    this.row('Used by', [used]);
  }
}
