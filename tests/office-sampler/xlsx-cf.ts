/**
 * Excel sampler: conditional formatting (X-CF) and sparklines (X-SPK). One row per item: the id in
 * column A, values in B:D that the rule covers (B{n}:D{n}); a sparkline item draws B:D in E.
 * ECMA-376 Part 1 §18.3.1.10 conditionalFormatting, §18.3.1.10 cfRule (§18.18.12 ST_CfType),
 * §18.3.1.16 colorScale, §18.3.1.28 dataBar, §18.3.1.49 iconSet (§18.18.42 ST_IconSetType),
 * §18.8.17 dxf; MS-XLSX 2.6 (x14:conditionalFormatting, x14:dataBar, x14:iconSet, x14:sparklineGroup);
 * Excel's Home ▸ Conditional Formatting and Insert ▸ Sparklines.
 *
 * Tags from src/io/xlsx-format.ts readCondFormats (:196) and condFormatsXml (:32): 3-icon sets map
 * onto five here (BACK_ICONS :167, ICON_NAMES :23), so 3ArrowsGray, 3TrafficLights2, 3Signs and
 * 3Symbols2 come back as another set; 4- and 5-icon sets, timePeriod, containsErrors and x14 rules
 * are not read; a cellIs rule comparing with a cell becomes an expression rule (:236); dxfs keep
 * font b/i/u/color and fill (readDxfs :138). Sparklines: src/io/xlsx-view.ts readSparklines (:113),
 * sparklinesExt (:98).
 */
import { type Item, type Sampler, type View, itemList, kid, esc } from './kit';
import { Book, rowOf, xKids, covers, colorHex, isOn, stylesRoot } from './xlsx';

const items: Item[] = [];
const book = new Book();
const sh = book.sheet('Conditional formats');
sh.set('cols', '<cols><col min="1" max="1" width="50" customWidth="1"/></cols>');
type Tag = 'supported' | 'kept' | 'loss';
const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const XM = 'http://schemas.microsoft.com/office/excel/2006/main';

// ---------------------------------------------------------------------------------------------
// Conditional formatting (X-CF)

const cf = itemList('X-CF', items);
const blocks: string[] = [];
const x14blocks: string[] = [];
let priority = 0;
let guid = 0;

/** The rules (main namespace) covering B of the item's row. */
function rulesOf(v: View, id: string): Element[] {
  const f = rowOf(v, id);
  if (!f) return [];
  return xKids(f.sheet.root, 'conditionalFormatting').filter((c) => covers(c.getAttribute('sqref'), `B${f.r + 1}`)).flatMap((c) => xKids(c, 'cfRule'));
}
/** The x14 rules covering B of the item's row. */
function x14RulesOf(v: View, id: string): Element[] {
  const f = rowOf(v, id);
  if (!f?.sheet.root) return [];
  return Array.from(f.sheet.root.getElementsByTagNameNS(X14, 'conditionalFormatting'))
    .filter((c) => covers(c.getElementsByTagNameNS(XM, 'sqref')[0]?.textContent, `B${f.r + 1}`))
    .flatMap((c) => Array.from(c.getElementsByTagNameNS(X14, 'cfRule')));
}
const dxfOf = (v: View, rule: Element | undefined) => xKids(kid(stylesRoot(v), 'x:dxfs'), 'dxf')[Number(rule?.getAttribute('dxfId') ?? -1)];
const formulas = (r: Element | undefined) => xKids(r, 'formula').map((f) => (f.textContent ?? '').replace(/\s/g, ''));

/**
 * An item: a cfRule (its attributes and contents; {dxf} is replaced by a highlight look's number,
 * {B} by the first cell) over B:D of its row, with `values` in B, C and D.
 */
function rule(feature: string, tag: Tag, spec: string, attrs: string, inner: string, check: (rules: Element[], v: View) => boolean, values: (number | string)[] = [10, 50, 90], o: { basis?: string; x14?: string; sqrefExtra?: string; second?: string } = {}): string {
  const id = cf(feature, tag, spec, (v) => check(rulesOf(v, id), v), o.basis ?? 'xlsx-format.ts:196 readCondFormats, :32 condFormatsXml');
  const r = sh.item(id, feature);
  values.forEach((x, k) => (typeof x === 'number' ? sh.num(`${'BCD'[k]}${r + 1}`, x) : sh.text(`${'BCD'[k]}${r + 1}`, x)));
  const sq = `B${r + 1}:D${r + 1}${o.sqrefExtra ? ' ' + o.sqrefExtra : ''}`;
  const fill = (s: string) => s.replace(/\{dxf\}/g, () => String(book.styles.dxf('<font><b/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill>'))).replace(/\{B\}/g, `B${r + 1}`);
  let ext = '';
  if (o.x14) {
    const g = `{00000000-000E-0000-0000-${String(++guid).padStart(12, '0')}}`;
    ext = `<extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}" xmlns:x14="${X14}"><x14:id>${g}</x14:id></ext></extLst>`;
    x14blocks.push(`<x14:conditionalFormatting xmlns:xm="${XM}">${fill(o.x14).replace('{id}', g)}<xm:sqref>${sq}</xm:sqref></x14:conditionalFormatting>`);
  }
  const main = attrs ? `<cfRule ${fill(attrs)} priority="${++priority}">${fill(inner)}${ext}</cfRule>` : '';
  const second = o.second ? `<cfRule ${fill(o.second)} priority="${++priority}"/>` : '';
  if (main || second) blocks.push(`<conditionalFormatting sqref="${sq}">${main}${second}</conditionalFormatting>`);
  return id;
}
const C = '§18.3.1.10 cfRule; Home ▸ Conditional Formatting';
const has = (rs: Element[], type: string, extra: (r: Element) => boolean = () => true) => rs.some((r) => r.getAttribute('type') === type && extra(r));
const at = (r: Element, a: string) => r.getAttribute(a);

// Highlight Cells Rules
rule('Cell value greater than 50 (red fill, dark red text)', 'supported', `${C}, cellIs greaterThan; Highlight Cells Rules ▸ Greater Than`, 'type="cellIs" dxfId="{dxf}" operator="greaterThan"', '<formula>50</formula>',
  (rs, v) => has(rs, 'cellIs', (r) => at(r, 'operator') === 'greaterThan' && formulas(r)[0] === '50' && colorHex(kid(kid(kid(dxfOf(v, r), 'x:fill'), 'x:patternFill'), 'x:bgColor')) === 'FFC7CE'));
rule('Cell value between 20 and 80', 'supported', `${C}, cellIs between`, 'type="cellIs" dxfId="{dxf}" operator="between"', '<formula>20</formula><formula>80</formula>',
  (rs) => has(rs, 'cellIs', (r) => at(r, 'operator') === 'between' && formulas(r).join() === '20,80'));
rule('Cell value not between 20 and 80', 'supported', `${C}, cellIs notBetween`, 'type="cellIs" dxfId="{dxf}" operator="notBetween"', '<formula>20</formula><formula>80</formula>',
  (rs) => has(rs, 'cellIs', (r) => at(r, 'operator') === 'notBetween'));
rule('Cell value equal to text "beta"', 'supported', `${C}, cellIs equal`, 'type="cellIs" dxfId="{dxf}" operator="equal"', '<formula>"beta"</formula>',
  (rs) => has(rs, 'cellIs', (r) => at(r, 'operator') === 'equal' && formulas(r)[0] === '"beta"'), ['alpha', 'beta', 'gamma']);
rule('Cell value less than or equal to 10', 'supported', `${C}, cellIs lessThanOrEqual`, 'type="cellIs" dxfId="{dxf}" operator="lessThanOrEqual"', '<formula>10</formula>',
  (rs) => has(rs, 'cellIs', (r) => at(r, 'operator') === 'lessThanOrEqual'));
rule('Cell value not equal to 50', 'supported', `${C}, cellIs notEqual`, 'type="cellIs" dxfId="{dxf}" operator="notEqual"', '<formula>50</formula>',
  (rs) => has(rs, 'cellIs', (r) => at(r, 'operator') === 'notEqual'));
rule('Cell value greater than a cell ($B$1)', 'loss', `${C}, cellIs with a reference operand`, 'type="cellIs" dxfId="{dxf}" operator="greaterThan"', '<formula>$C$1</formula>',
  (rs) => has(rs, 'cellIs', (r) => formulas(r)[0] === '$C$1'), undefined, { basis: 'xlsx-format.ts:236 (becomes an expression rule)' });
rule('Cell value greater than a cell still highlights (any form)', 'supported', `${C}, cellIs with a reference operand`, 'type="cellIs" dxfId="{dxf}" operator="greaterThan"', '<formula>$C$1</formula>',
  (rs) => has(rs, 'cellIs') || has(rs, 'expression', (r) => formulas(r)[0]?.includes('$C$1')), undefined, { basis: 'xlsx-format.ts:236' });
rule('Text that contains "lph"', 'supported', `${C}, containsText; Highlight Cells Rules ▸ Text that Contains`, 'type="containsText" dxfId="{dxf}" operator="containsText" text="lph"', '<formula>NOT(ISERROR(SEARCH("lph",{B})))</formula>',
  (rs) => has(rs, 'containsText', (r) => at(r, 'text') === 'lph'), ['alpha', 'beta', 'gamma']);
rule('Text that does not contain "lph"', 'supported', `${C}, notContainsText`, 'type="notContainsText" dxfId="{dxf}" operator="notContains" text="lph"', '<formula>ISERROR(SEARCH("lph",{B}))</formula>',
  (rs) => has(rs, 'notContainsText', (r) => at(r, 'text') === 'lph'), ['alpha', 'beta', 'gamma']);
rule('Text that begins with "be"', 'supported', `${C}, beginsWith`, 'type="beginsWith" dxfId="{dxf}" operator="beginsWith" text="be"', '<formula>LEFT({B},LEN("be"))="be"</formula>',
  (rs) => has(rs, 'beginsWith', (r) => at(r, 'text') === 'be'), ['alpha', 'beta', 'gamma']);
rule('Text that ends with "ma"', 'supported', `${C}, endsWith`, 'type="endsWith" dxfId="{dxf}" operator="endsWith" text="ma"', '<formula>RIGHT({B},LEN("ma"))="ma"</formula>',
  (rs) => has(rs, 'endsWith', (r) => at(r, 'text') === 'ma'), ['alpha', 'beta', 'gamma']);
rule('Blank cells', 'supported', `${C}, containsBlanks`, 'type="containsBlanks" dxfId="{dxf}"', '<formula>LEN(TRIM({B}))=0</formula>', (rs) => has(rs, 'containsBlanks'), [1, '', 3]);
rule('No blank cells', 'supported', `${C}, notContainsBlanks`, 'type="notContainsBlanks" dxfId="{dxf}"', '<formula>LEN(TRIM({B}))&gt;0</formula>', (rs) => has(rs, 'notContainsBlanks'), [1, '', 3]);
rule('Errors', 'loss', `${C}, containsErrors`, 'type="containsErrors" dxfId="{dxf}"', '<formula>ISERROR({B})</formula>', (rs) => has(rs, 'containsErrors'), undefined, { basis: 'xlsx-format.ts:270 (not read; warning)' });
rule('No errors', 'loss', `${C}, notContainsErrors`, 'type="notContainsErrors" dxfId="{dxf}"', '<formula>NOT(ISERROR({B}))</formula>', (rs) => has(rs, 'notContainsErrors'), undefined, { basis: 'xlsx-format.ts:270' });
rule('A date occurring last week', 'loss', `${C}, timePeriod lastWeek; Highlight Cells Rules ▸ A Date Occurring`, 'type="timePeriod" dxfId="{dxf}" timePeriod="lastWeek"', '<formula>AND(TODAY()-ROUNDDOWN({B},0)&gt;=(WEEKDAY(TODAY())),TODAY()-ROUNDDOWN({B},0)&lt;(WEEKDAY(TODAY())+7))</formula>',
  (rs) => has(rs, 'timePeriod', (r) => at(r, 'timePeriod') === 'lastWeek'), [45600, 45650, 45700], { basis: 'xlsx-format.ts:270' });
rule('Duplicate values', 'supported', `${C}, duplicateValues`, 'type="duplicateValues" dxfId="{dxf}"', '', (rs) => has(rs, 'duplicateValues'), [5, 5, 7]);
rule('Unique values', 'supported', `${C}, uniqueValues`, 'type="uniqueValues" dxfId="{dxf}"', '', (rs) => has(rs, 'uniqueValues'), [5, 5, 7]);
// Top/Bottom Rules
rule('Top 2 items', 'supported', `${C}, top10 rank; Top/Bottom Rules ▸ Top 10 Items`, 'type="top10" dxfId="{dxf}" rank="2"', '', (rs) => has(rs, 'top10', (r) => at(r, 'rank') === '2' && !isOn(at(r, 'bottom'))));
rule('Bottom 10 %', 'supported', `${C}, top10 percent bottom`, 'type="top10" dxfId="{dxf}" percent="1" bottom="1" rank="10"', '', (rs) => has(rs, 'top10', (r) => isOn(at(r, 'percent')) && isOn(at(r, 'bottom')) && at(r, 'rank') === '10'));
rule('Above average', 'supported', `${C}, aboveAverage`, 'type="aboveAverage" dxfId="{dxf}"', '', (rs) => has(rs, 'aboveAverage', (r) => at(r, 'aboveAverage') !== '0'));
rule('Below average', 'supported', `${C}, aboveAverage@aboveAverage 0`, 'type="aboveAverage" dxfId="{dxf}" aboveAverage="0"', '', (rs) => has(rs, 'aboveAverage', (r) => at(r, 'aboveAverage') === '0'));
rule('Equal to or above average', 'loss', `${C}, aboveAverage@equalAverage`, 'type="aboveAverage" dxfId="{dxf}" equalAverage="1"', '', (rs) => has(rs, 'aboveAverage', (r) => isOn(at(r, 'equalAverage'))), undefined, { basis: 'xlsx-format.ts:262 (equalAverage not read)' });
rule('One standard deviation above average', 'loss', `${C}, aboveAverage@stdDev`, 'type="aboveAverage" dxfId="{dxf}" stdDev="1"', '', (rs) => has(rs, 'aboveAverage', (r) => at(r, 'stdDev') === '1'), undefined, { basis: 'xlsx-format.ts:262' });
// formulas, stop, several ranges, priority
rule('Formula rule (=$B…>$C…)', 'supported', `${C}, expression; New Rule ▸ Use a formula`, 'type="expression" dxfId="{dxf}"', '<formula>$B{n}&gt;$C{n}</formula>',
  (rs) => has(rs, 'expression', (r) => /^\$B\d+>\$C\d+$/.test(formulas(r)[0] ?? '')), [90, 50, 10]);
rule('Stop If True', 'supported', `${C}@stopIfTrue; Manage Rules ▸ Stop If True`, 'type="cellIs" dxfId="{dxf}" operator="greaterThan" stopIfTrue="1"', '<formula>0</formula>', (rs) => rs.some((r) => isOn(at(r, 'stopIfTrue'))));
rule('One rule over several ranges', 'supported', '§18.3.1.10 conditionalFormatting@sqref', 'type="cellIs" dxfId="{dxf}" operator="greaterThan"', '<formula>40</formula>',
  (rs) => rs.some((r) => covers(r.parentElement?.getAttribute('sqref'), 'F2')), undefined, { sqrefExtra: 'F1:F3' });
rule('Two rules on the same cells, in priority order', 'supported', `${C}@priority; Manage Rules ▸ order`, 'type="cellIs" dxfId="{dxf}" operator="greaterThan"', '<formula>80</formula>',
  (rs) => {
    const sorted = [...rs].sort((a, b) => Number(at(a, 'priority')) - Number(at(b, 'priority')));
    return sorted.length === 2 && sorted[0].getAttribute('type') === 'cellIs' && sorted[1].getAttribute('type') === 'aboveAverage';
  }, undefined, { second: 'type="aboveAverage" dxfId="{dxf}"' });
rule('Highlight look: italic, underline, font color', 'supported', '§18.8.17 dxf font', `type="cellIs" dxfId="${book.styles.dxf('<font><i/><u/><color rgb="FF1B7F79"/></font>')}" operator="greaterThan"`, '<formula>0</formula>',
  (rs, v) => { const d = dxfOf(v, rs[0]); const f = kid(d, 'x:font'); return !!kid(f, 'x:i') && !!kid(f, 'x:u') && colorHex(kid(f, 'x:color')) === '1B7F79'; });
rule('Highlight look: number format', 'loss', '§18.8.17 dxf numFmt', `type="cellIs" dxfId="${book.styles.dxf('<numFmt numFmtId="165" formatCode="0.000"/>')}" operator="greaterThan"`, '<formula>0</formula>',
  (rs, v) => kid(dxfOf(v, rs[0]), 'x:numFmt')?.getAttribute('formatCode') === '0.000', undefined, { basis: 'xlsx-format.ts:16 dxfXml (font and fill only)' });
rule('Highlight look: border', 'loss', '§18.8.17 dxf border', `type="cellIs" dxfId="${book.styles.dxf('<border><left style="thin"><color rgb="FFC8553D"/></left><right style="thin"><color rgb="FFC8553D"/></right><top style="thin"><color rgb="FFC8553D"/></top><bottom style="thin"><color rgb="FFC8553D"/></bottom></border>')}" operator="greaterThan"`, '<formula>0</formula>',
  (rs, v) => kid(kid(dxfOf(v, rs[0]), 'x:border'), 'x:left')?.getAttribute('style') === 'thin', undefined, { basis: 'xlsx-format.ts:16' });
rule('Highlight look: strikethrough', 'loss', '§18.8.17 dxf font strike', `type="cellIs" dxfId="${book.styles.dxf('<font><strike/></font>')}" operator="greaterThan"`, '<formula>0</formula>',
  (rs, v) => !!kid(kid(dxfOf(v, rs[0]), 'x:font'), 'x:strike'), undefined, { basis: 'xlsx-format.ts:138 readDxfs (b, i, u, color)' });
// Color Scales
const cs = (rs: Element[]) => kid(rs.find((r) => r.getAttribute('type') === 'colorScale'), 'x:colorScale');
rule('2-color scale (white to green)', 'supported', `${C}, colorScale; Color Scales`, 'type="colorScale"', '<colorScale><cfvo type="min"/><cfvo type="max"/><color rgb="FFFFFFFF"/><color rgb="FF63BE7B"/></colorScale>',
  (rs) => xKids(cs(rs), 'cfvo').length === 2 && colorHex(xKids(cs(rs), 'color')[1]) === '63BE7B');
rule('3-color scale with 50th percentile', 'supported', `${C}, colorScale (3 stops)`, 'type="colorScale"', '<colorScale><cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/><color rgb="FFF8696B"/><color rgb="FFFFEB84"/><color rgb="FF63BE7B"/></colorScale>',
  (rs) => xKids(cs(rs), 'cfvo')[1]?.getAttribute('type') === 'percentile' && xKids(cs(rs), 'cfvo')[1]?.getAttribute('val') === '50' && xKids(cs(rs), 'color').length === 3);
rule('Color scale with number limits', 'supported', `${C}, colorScale cfvo num`, 'type="colorScale"', '<colorScale><cfvo type="num" val="0"/><cfvo type="num" val="100"/><color rgb="FFFFFFFF"/><color rgb="FF5A8AC6"/></colorScale>',
  (rs) => { const v = xKids(cs(rs), 'cfvo'); return v.length === 2 && v.every((c) => c.getAttribute('type') === 'num') && v[1].getAttribute('val') === '100'; });
rule('Color scale with a formula limit', 'loss', `${C}, colorScale cfvo formula`, 'type="colorScale"', '<colorScale><cfvo type="formula" val="$B$1"/><cfvo type="max"/><color rgb="FFFFFFFF"/><color rgb="FF5A8AC6"/></colorScale>',
  (rs) => xKids(cs(rs), 'cfvo')[0]?.getAttribute('type') === 'formula', undefined, { basis: 'xlsx-format.ts:158 readCfvo (formula as auto)' });
// Data Bars
const db = (rs: Element[]) => kid(rs.find((r) => r.getAttribute('type') === 'dataBar'), 'x:dataBar');
rule('Data bar (gradient, blue)', 'supported', `${C}, dataBar; Data Bars ▸ Gradient Fill`, 'type="dataBar"', '<dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar>',
  (rs) => colorHex(kid(db(rs), 'x:color')) === '638EC6');
rule('Data bar, bar only (no value)', 'supported', `${C}, dataBar@showValue`, 'type="dataBar"', '<dataBar showValue="0"><cfvo type="min"/><cfvo type="max"/><color rgb="FF63C384"/></dataBar>',
  (rs) => db(rs)?.getAttribute('showValue') === '0');
rule('Data bar with number limits', 'supported', `${C}, dataBar cfvo num`, 'type="dataBar"', '<dataBar><cfvo type="num" val="0"/><cfvo type="num" val="200"/><color rgb="FFFF555A"/></dataBar>',
  (rs) => xKids(db(rs), 'cfvo')[1]?.getAttribute('val') === '200');
rule('Data bar, solid fill with border (Excel 2010 x14:dataBar)', 'loss', `${C}; MS-XLSX 2.6.21 x14:dataBar; Data Bars ▸ Solid Fill`, 'type="dataBar"', '<dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar>',
  (_, v) => x14RulesOf(v, rowItemId('Data bar, solid fill')).some((r) => r.getElementsByTagNameNS(X14, 'dataBar')[0]?.getAttribute('gradient') === '0'), undefined,
  { x14: '<x14:cfRule type="dataBar" id="{id}"><x14:dataBar minLength="0" maxLength="100" gradient="0" border="1" negativeBarBorderColorSameAsPositive="0"><x14:cfvo type="autoMin"/><x14:cfvo type="autoMax"/><x14:borderColor rgb="FF638EC6"/><x14:negativeFillColor rgb="FFFF0000"/><x14:negativeBorderColor rgb="FFFF0000"/><x14:axisColor rgb="FF000000"/></x14:dataBar></x14:cfRule>', basis: 'xlsx.ts (worksheet extLst dropped but sparklines)' });
// Icon Sets
const icons = (rs: Element[]) => kid(rs.find((r) => r.getAttribute('type') === 'iconSet'), 'x:iconSet');
const iconCfvo = (n: number) => `<cfvo type="percent" val="0"/>${Array.from({ length: n - 1 }, (_, k) => `<cfvo type="percent" val="${Math.round(((k + 1) * 100) / n)}"/>`).join('')}`;
for (const [set, tag] of [['3Arrows', 'supported'], ['3TrafficLights1', 'supported'], ['3Flags', 'supported'], ['3Symbols', 'supported'],
  ['3ArrowsGray', 'loss'], ['3TrafficLights2', 'loss'], ['3Signs', 'loss'], ['3Symbols2', 'loss'],
  ['4Arrows', 'loss'], ['4Rating', 'loss'], ['4TrafficLights', 'loss'], ['5Arrows', 'loss'], ['5Quarters', 'loss'], ['5Rating', 'loss']] as [string, Tag][]) {
  const n = Number(set[0]);
  rule(`Icon set ${set}`, tag, `${C}, iconSet, §18.18.42 ST_IconSetType; Icon Sets`, 'type="iconSet"', `<iconSet iconSet="${set}">${iconCfvo(n)}</iconSet>`,
    (rs) => icons(rs)?.getAttribute('iconSet') === set || (set === '3TrafficLights1' && !!icons(rs) && !icons(rs)?.getAttribute('iconSet')), n === 5 ? [10, 30, 50] : [10, 50, 90],
    { basis: tag === 'loss' ? (n === 3 ? 'xlsx-format.ts:167 BACK_ICONS, :23 ICON_NAMES (comes back as another set)' : 'xlsx-format.ts:227 (only 3-icon sets read)') : 'xlsx-format.ts:222' });
}
rule('Icon set reversed', 'supported', `${C}, iconSet@reverse; Icon Sets ▸ Reverse Icon Order`, 'type="iconSet"', `<iconSet iconSet="3Arrows" reverse="1">${iconCfvo(3)}</iconSet>`,
  (rs) => isOn(icons(rs)?.getAttribute('reverse')));
rule('Icon set, icon only', 'supported', `${C}, iconSet@showValue`, 'type="iconSet"', `<iconSet iconSet="3Flags" showValue="0">${iconCfvo(3)}</iconSet>`,
  (rs) => icons(rs)?.getAttribute('showValue') === '0');
rule('Icon set with number limits', 'supported', `${C}, iconSet cfvo num`, 'type="iconSet"', '<iconSet iconSet="3Symbols"><cfvo type="percent" val="0"/><cfvo type="num" val="25"/><cfvo type="num" val="75"/></iconSet>',
  (rs) => xKids(icons(rs), 'cfvo')[1]?.getAttribute('type') === 'num' && xKids(icons(rs), 'cfvo')[2]?.getAttribute('val') === '75');
rule('Icon set 3 Stars (Excel 2010 x14:iconSet)', 'loss', `${C}; MS-XLSX 2.6.33 x14:iconSet`, '', '',
  (_, v) => x14RulesOf(v, rowItemId('Icon set 3 Stars')).some((r) => r.getElementsByTagNameNS(X14, 'iconSet')[0]?.getAttribute('iconSet') === '3Stars'), undefined,
  { x14: '<x14:cfRule type="iconSet" priority="900" id="{id}"><x14:iconSet iconSet="3Stars"><x14:cfvo type="percent"><xm:f>0</xm:f></x14:cfvo><x14:cfvo type="percent"><xm:f>33</xm:f></x14:cfvo><x14:cfvo type="percent"><xm:f>67</xm:f></x14:cfvo></x14:iconSet></x14:cfRule>', basis: 'xlsx.ts (worksheet extLst dropped but sparklines)' });
rule('Icon set with custom icons (x14 mixed icons)', 'loss', `${C}; MS-XLSX 2.6.33 x14:iconSet@custom, x14:cfIcon`, '', '',
  (_, v) => x14RulesOf(v, rowItemId('Icon set with custom icons')).some((r) => r.getElementsByTagNameNS(X14, 'cfIcon').length === 3), undefined,
  { x14: '<x14:cfRule type="iconSet" priority="901" id="{id}"><x14:iconSet iconSet="3Arrows" custom="1"><x14:cfvo type="percent"><xm:f>0</xm:f></x14:cfvo><x14:cfvo type="percent"><xm:f>33</xm:f></x14:cfvo><x14:cfvo type="percent"><xm:f>67</xm:f></x14:cfvo><x14:cfIcon iconSet="3Flags" iconId="0"/><x14:cfIcon iconSet="3Symbols" iconId="1"/><x14:cfIcon iconSet="3Arrows" iconId="2"/></x14:iconSet></x14:cfRule>' });

/** The id of the item whose feature starts with `start` (for checks that need it before it is known). */
function rowItemId(start: string): string { return items.find((i) => i.feature.startsWith(start))!.id; }

// ---------------------------------------------------------------------------------------------
// Sparklines (X-SPK): Insert ▸ Sparklines; drawn in E of the item's row from B:D

const spk = itemList('X-SPK', items);
const groups: string[] = [];
/** The sparkline group with a sparkline in E of the item's row. */
function groupOf(v: View, id: string): Element | undefined {
  const f = rowOf(v, id);
  if (!f?.sheet.root) return undefined;
  return Array.from(f.sheet.root.getElementsByTagNameNS(X14, 'sparklineGroup'))
    .find((g) => Array.from(g.getElementsByTagNameNS(XM, 'sqref')).some((s) => s.textContent?.trim() === `E${f.r + 1}`));
}
const x14kid = (el: Element | undefined, local: string) => (el ? Array.from(el.children).find((c) => c.namespaceURI === X14 && c.localName === local) : undefined);
const SP = 'MS-XLSX 2.6.92 x14:sparklineGroup; Insert ▸ Sparklines';
function spark(feature: string, tag: Tag, attrs: string, colors: string, check: (g: Element | undefined) => boolean, basis = 'xlsx-view.ts:113 readSparklines, :98 sparklinesExt', values: number[] = [3, -2, 5]): string {
  const id = spk(feature, tag, SP, (v) => check(groupOf(v, id)), basis);
  const r = sh.item(id, feature);
  values.forEach((x, k) => sh.num(`${'BCD'[k]}${r + 1}`, x));
  const sheetName = `'${sh.name}'`;
  groups.push(`<x14:sparklineGroup ${attrs}>${colors || '<x14:colorSeries rgb="FF376092"/><x14:colorNegative rgb="FFD00000"/><x14:colorAxis rgb="FF000000"/><x14:colorMarkers rgb="FFD00000"/><x14:colorFirst rgb="FFD00000"/><x14:colorLast rgb="FFD00000"/><x14:colorHigh rgb="FFD00000"/><x14:colorLow rgb="FFD00000"/>'}`
    + `<x14:sparklines><x14:sparkline><xm:f>${esc(sheetName)}!B${r + 1}:D${r + 1}</xm:f><xm:sqref>E${r + 1}</xm:sqref></x14:sparkline></x14:sparklines></x14:sparklineGroup>`);
  return id;
}
const ga = (g: Element | undefined, a: string) => g?.getAttribute(a) ?? null;
spark('Line sparkline', 'supported', 'displayEmptyCellsAs="gap"', '', (g) => !!g && !ga(g, 'type'));
spark('Column sparkline', 'supported', 'type="column" displayEmptyCellsAs="gap"', '', (g) => ga(g, 'type') === 'column');
spark('Win/Loss sparkline', 'supported', 'type="stacked" displayEmptyCellsAs="gap" negative="1"', '', (g) => ga(g, 'type') === 'stacked');
spark('Markers, high, low, first, last and negative points', 'supported', 'displayEmptyCellsAs="gap" markers="1" high="1" low="1" first="1" last="1" negative="1"', '',
  (g) => ['markers', 'high', 'low', 'first', 'last', 'negative'].every((a) => isOn(ga(g, a))));
spark('Sparkline colors (series and negative)', 'supported', 'type="column" displayEmptyCellsAs="gap" negative="1"', '<x14:colorSeries rgb="FF1B7F79"/><x14:colorNegative rgb="FFC8553D"/><x14:colorAxis rgb="FF000000"/><x14:colorMarkers rgb="FFD00000"/><x14:colorFirst rgb="FFD00000"/><x14:colorLast rgb="FFD00000"/><x14:colorHigh rgb="FFD00000"/><x14:colorLow rgb="FFD00000"/>',
  (g) => colorHex(x14kid(g, 'colorSeries')) === '1B7F79' && colorHex(x14kid(g, 'colorNegative')) === 'C8553D');
spark('Sparkline theme color (Accent 2)', 'loss', 'displayEmptyCellsAs="gap"', '<x14:colorSeries theme="5"/><x14:colorNegative theme="5"/><x14:colorAxis rgb="FF000000"/><x14:colorMarkers theme="5"/><x14:colorFirst theme="5"/><x14:colorLast theme="5"/><x14:colorHigh theme="5"/><x14:colorLow theme="5"/>',
  (g) => x14kid(g, 'colorSeries')?.getAttribute('theme') === '5', 'xlsx-view.ts:101 (written as rgb)');
spark('Axis limits set by hand (-5 to 10)', 'supported', 'displayEmptyCellsAs="gap" minAxisType="custom" maxAxisType="custom" manualMin="-5" manualMax="10"', '',
  (g) => ga(g, 'minAxisType') === 'custom' && ga(g, 'manualMin') === '-5' && ga(g, 'manualMax') === '10');
spark('Axis limits the same for all sparklines (group)', 'supported', 'displayEmptyCellsAs="gap" minAxisType="group" maxAxisType="group"', '',
  (g) => ga(g, 'minAxisType') === 'group' && ga(g, 'maxAxisType') === 'group');
spark('Empty cells as zero', 'supported', 'displayEmptyCellsAs="zero"', '', (g) => ga(g, 'displayEmptyCellsAs') === 'zero');
spark('Empty cells connected (span)', 'supported', 'displayEmptyCellsAs="span"', '', (g) => ga(g, 'displayEmptyCellsAs') === 'span');
spark('Show axis', 'supported', 'displayEmptyCellsAs="gap" displayXAxis="1"', '', (g) => isOn(ga(g, 'displayXAxis')));
spark('Show hidden rows and columns', 'supported', 'displayEmptyCellsAs="gap" displayHidden="1"', '', (g) => isOn(ga(g, 'displayHidden')));
spark('Right to left', 'supported', 'displayEmptyCellsAs="gap" rightToLeft="1"', '', (g) => isOn(ga(g, 'rightToLeft')));
spark('Line weight 2.25 pt', 'supported', 'lineWeight="2.25" displayEmptyCellsAs="gap"', '', (g) => ga(g, 'lineWeight') === '2.25');
spark('Date axis', 'loss', 'displayEmptyCellsAs="gap" dateAxis="1"', '<x14:colorSeries rgb="FF376092"/><x14:colorNegative rgb="FFD00000"/><x14:colorAxis rgb="FF000000"/><x14:colorMarkers rgb="FFD00000"/><x14:colorFirst rgb="FFD00000"/><x14:colorLast rgb="FFD00000"/><x14:colorHigh rgb="FFD00000"/><x14:colorLow rgb="FFD00000"/><xm:f>\'Conditional formats\'!$B$1:$D$1</xm:f>',
  (g) => isOn(ga(g, 'dateAxis')), 'xlsx-view.ts:113 (dateAxis not read)');

let bytes: Uint8Array | undefined;
export const xlsxCf: Sampler = {
  name: 'xlsx-cf.xlsx', area: 'Excel conditional formatting and sparklines', items,
  build: () => {
    if (bytes) return bytes;
    for (const b of blocks) sh.add('conditionalFormatting', b.replace(/\{n\}/g, (/sqref="B(\d+)/.exec(b) ?? ['', '1'])[1]));
    sh.set('extLst', '<extLst>'
      + `<ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:x14="${X14}"><x14:conditionalFormattings>${x14blocks.join('')}</x14:conditionalFormattings></ext>`
      + `<ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}" xmlns:x14="${X14}"><x14:sparklineGroups xmlns:xm="${XM}">${groups.join('')}</x14:sparklineGroups></ext></extLst>`);
    return (bytes = book.build('Excel sampler: conditional formatting and sparklines'));
  },
};
