// @vitest-environment jsdom
//
// A Word or PowerPoint chart is shown in its file's theme and with its title's own size
// (office sampler F-V-05): series without a colour of their own take the theme's accents, as
// Office gives them; a series in a theme colour (accent2 made darker) shows that colour; a
// 14 pt title on 14 pt text stays 14 pt. The file keeps its theme colours when saved. The
// fixture XML below is written by hand from the standard's element names.

import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { chartFromRange, chartData, chartPalette, type Chart } from '../src/sheet/chart';
import { readChartXml, chartXml } from '../src/io/xlsx-chart';
import { themeLook } from '../src/io/office-chart';
import { applyColorMods } from '../src/io/dml-color';

const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml');

/** A column chart of two series, read back from its own XML with `edit` applied to that XML. */
function chartOf(edit: (xml: string) => string): Chart {
  const wb = new Workbook();
  const rows = [['', 'A', 'B'], ['x', 1, 2], ['y', 3, 4]];
  wb.edit('fill', () => rows.forEach((row, i) => row.forEach((v, j) => wb.sheet.setInput(i, j, String(v)))));
  const c = { ...chartFromRange(wb.sheet, { r1: 0, c1: 0, r2: 2, c2: 2 }, 'column'), title: 'Yields' };
  const x = edit(chartXml(c, chartData(wb, wb.sheet, c)));
  return readChartXml(parse(x), c.at, c.w, c.h, 1)!.chart;
}

/** The theme of a file whose accents aren't Office's. */
const THEME = { dk1: '000000', lt1: 'FFFFFF', accent1: '1B7F79', accent2: 'C8553D', accent3: '3A86FF', accent4: '8AB17D', accent5: '6A4C93', accent6: 'F2A541' };

describe('a chart in its file\'s theme', () => {
  it('gives series without a colour the theme\'s accents, and a theme colour its look in the theme', () => {
    // the second series in accent2 made darker, the first with no colour of its own
    const c = chartOf((x) => {
      let n = 0;
      return x.replace(/<c:ser>([\s\S]*?)<c:spPr>[\s\S]*?<\/c:spPr>/g, (_m, head: string) => (n++ === 0 ? `<c:ser>${head}` : `<c:ser>${head}<c:spPr><a:solidFill><a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr></a:solidFill></c:spPr>`));
    });
    expect(c.series[0].color).toBeUndefined();
    expect(c.series[1].scheme).toContain('accent2');
    themeLook(c, THEME);
    expect(c.themePalette?.[0]).toBe('#1b7f79');
    const dark = applyColorMods('C8553D', [{ localName: 'lumMod', getAttribute: () => '75000' }]).toLowerCase();
    expect(c.series[1].themeColor).toBe(dark);
    // (shown so; saved as the theme's colour, not as that colour)
    const wb = new Workbook();
    const data = chartData(wb, wb.sheet, c);
    expect(data[0].color).toBe('#1b7f79');
    expect(data[1].color).toBe(dark);
    const again = chartXml(c, data);
    expect(again).toContain('<a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr>');
  });

  it('keeps a palette picked here over the theme\'s', () => {
    expect(chartPalette({ themePalette: ['#111111'] })).toEqual(['#111111']);
    expect(chartPalette({ themePalette: ['#111111'], palette: 'office' })[0]).toBe('#4472c4');
    expect(chartPalette({})[0]).toBe('#4472c4');
  });

  it('leaves a chart without a complete theme as it was', () => {
    const c = chartOf((x) => x);
    themeLook(c, { accent1: '1B7F79' });
    expect(c.themePalette).toBeUndefined();
  });
});

describe('a chart title\'s own size', () => {
  const sized = (sz: string) => (x: string) => x.replace(/(<c:title><c:tx><c:rich>[\s\S]*?<a:r>)<a:rPr[^>]*\/>/, `$1<a:rPr lang="en-US" sz="${sz}"/>`);

  it('is read, drawn and written back where it isn\'t the usual 1.4 times the text', () => {
    const c = chartOf(sized('1400'));
    expect(c.title).toBe('Yields');
    expect(c.titleSize).toBeCloseTo(18.7, 1);
    expect(chartXml(c, chartData(new Workbook(), new Workbook().sheet, c))).toMatch(/<c:title>[\s\S]*?sz="1400"/);
  });

  it('is left unset where it is the usual size', () => {
    // (the chart's 12 px text, 9 pt: its usual title 16.8 px, 12.6 pt)
    expect(chartOf(sized('1260')).titleSize).toBeUndefined();
  });
});
