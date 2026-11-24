/**
 * A DrawingML theme (ECMA-376 Part 1 §20.1.6) for the samplers: twelve scheme colors, major and
 * minor fonts, and the three of each fill, line, effect and background style a format scheme must
 * have. The colors and fonts are chosen here (not Office's own theme), so a file that falls back to
 * a different theme shows it.
 */
import { NS, XML_HEAD } from './kit';

export const THEME_COLORS = {
  dk1: '000000', lt1: 'FFFFFF', dk2: '1F3A4D', lt2: 'EEF2E6', accent1: '1B7F79', accent2: 'C8553D', accent3: '6A4C93',
  accent4: 'F2A541', accent5: '3A86FF', accent6: '8AB17D', hlink: '0B5FA5', folHlink: '7A4E9C',
} as const;

export const THEME_FONTS = { major: 'Georgia', minor: 'Calibri' } as const;

export function themeXml(name = 'Sampler'): string {
  const c = THEME_COLORS;
  const clr = (k: keyof typeof THEME_COLORS) => k === 'dk1' ? `<a:dk1><a:sysClr val="windowText" lastClr="${c.dk1}"/></a:dk1>`
    : k === 'lt1' ? `<a:lt1><a:sysClr val="window" lastClr="${c.lt1}"/></a:lt1>` : `<a:${k}><a:srgbClr val="${c[k]}"/></a:${k}>`;
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const grad = '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>';
  const ln = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  return `${XML_HEAD}<a:theme xmlns:a="${NS.a}" name="${name}"><a:themeElements>`
    + `<a:clrScheme name="${name}">${(Object.keys(c) as (keyof typeof THEME_COLORS)[]).map(clr).join('')}</a:clrScheme>`
    + `<a:fontScheme name="${name}"><a:majorFont><a:latin typeface="${THEME_FONTS.major}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>`
    + `<a:minorFont><a:latin typeface="${THEME_FONTS.minor}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="${name}"><a:fillStyleLst>${solid}${grad}${grad}</a:fillStyleLst>`
    + `<a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>`
    + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>'
    + '<a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst>'
    + `<a:bgFillStyleLst>${solid}${solid}${grad}</a:bgFillStyleLst></a:fmtScheme>`
    + '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
}
