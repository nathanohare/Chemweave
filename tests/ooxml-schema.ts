/**
 * Checks the XML parts of a Word, PowerPoint or Excel file against the Office Open XML
 * Transitional schemas (ECMA-376 Part 4, 5th edition, 2016), with libxml2 (xmllint-wasm).
 *
 * The schemas are downloaded by `node scripts/fetch-ooxml-schemas.mjs` into .cache/ooxml-schemas
 * (see that script for why they aren't in the repository). `schemasReady()` says whether they are
 * there; the Checks workflow fetches them before the tests, and sets OOXML_SCHEMAS_REQUIRED so a
 * missing download fails there instead of skipping.
 *
 * Before checking, each part goes through Markup Compatibility processing (ECMA-376 Part 3) the
 * way an application that knows only the 2016 schemas would: an mc:AlternateContent keeps the
 * first mc:Choice whose namespaces it knows, else its mc:Fallback; elements and attributes in
 * namespaces named by mc:Ignorable that the schemas don't define (w14, a14, x14, p14…) are taken
 * out. Anything else the schemas don't allow is reported. Only parts whose root element is in a
 * namespace the schemas define are checked; the packaging parts ([Content_Types].xml, the .rels
 * files, docProps/core.xml) are defined in Part 2 and are left out, as are legacy VML drawing parts.
 *
 * Two consequences to keep in mind: a Choice that needs a Microsoft namespace (Word's wps text
 * boxes and shapes, wpg groups, a14 picture effects) gives way to its Fallback, so those are
 * checked only through their VML or plain fallback; and one difference between the schema and what
 * Excel writes is allowed (excelAllows below), so a check never fails on what Excel itself writes.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { validateXML } from 'xmllint-wasm';

export const SCHEMA_DIR = join(__dirname, '..', '.cache', 'ooxml-schemas', 'transitional');
const XMLNS = 'http://www.w3.org/XML/1998/namespace';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

export const schemasReady = () => existsSync(join(SCHEMA_DIR, 'wml.xsd'));

/** Fail (rather than skip) when the schemas are missing: set in the Checks workflow. */
export const schemasRequired = () => !!process.env.OOXML_SCHEMAS_REQUIRED;

type Loaded = { wrapper: string; preload: { fileName: string; contents: string }[]; namespaces: Set<string> };
let loaded: Loaded | undefined;

function load(): Loaded {
  if (loaded) return loaded;
  const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.xsd')).sort();
  const text = new Map(files.map((f) => [f, readFileSync(join(SCHEMA_DIR, f), 'utf8')]));
  const ns = (f: string) => /targetNamespace="([^"]+)"/.exec(text.get(f)!)![1];
  // The schemas import the xml: namespace without saying where its schema is; this one, written
  // here, declares the two attributes they use (xml:space and xml:lang), as in XML 1.0 §2.10, §2.12.
  const xmlXsd = `<?xml version="1.0"?><xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema" targetNamespace="${XMLNS}">`
    + '<xsd:attribute name="space"><xsd:simpleType><xsd:restriction base="xsd:NCName"><xsd:enumeration value="default"/><xsd:enumeration value="preserve"/></xsd:restriction></xsd:simpleType></xsd:attribute>'
    + '<xsd:attribute name="lang" type="xsd:language"/></xsd:schema>';
  const fix = (s: string) => s.replace(`<xsd:import namespace="${XMLNS}"/>`, `<xsd:import namespace="${XMLNS}" schemaLocation="xml.xsd"/>`);
  // one schema that imports them all, so every kind of part is checked in one call
  const wrapper = '<?xml version="1.0"?><xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:chemweave:wrap">'
    + `<xsd:import namespace="${XMLNS}" schemaLocation="xml.xsd"/>`
    + files.map((f) => `<xsd:import namespace="${ns(f)}" schemaLocation="${f}"/>`).join('') + '</xsd:schema>';
  loaded = {
    wrapper,
    preload: [{ fileName: 'xml.xsd', contents: xmlXsd }, ...files.map((f) => ({ fileName: f, contents: fix(text.get(f)!) }))],
    namespaces: new Set([...files.map(ns), XMLNS]),
  };
  return loaded;
}

/** Markup Compatibility processing (ECMA-376 Part 3 §10) for an application knowing `known`. */
export function processMce(doc: Document, known: Set<string>): void {
  const understood = (uri: string | null) => uri === null || known.has(uri);
  const ignorable = (el: Element, inherited: Set<string>) => {
    const v = el.getAttributeNS(MC, 'Ignorable');
    if (!v) return inherited;
    const out = new Set(inherited);
    for (const p of v.trim().split(/\s+/)) { const uri = el.lookupNamespaceURI(p); if (uri) out.add(uri); }
    return out;
  };
  const requires = (choice: Element) => (choice.getAttribute('Requires') ?? '').trim().split(/\s+/).filter(Boolean)
    .every((p) => understood(choice.lookupNamespaceURI(p)));
  const walk = (el: Element, inherited: Set<string>) => {
    const ign = ignorable(el, inherited);
    for (const a of Array.from(el.attributes)) {
      if (a.namespaceURI === MC || (a.namespaceURI && a.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && !understood(a.namespaceURI) && ign.has(a.namespaceURI))) el.removeAttributeNode(a);
    }
    for (const kid of Array.from(el.children)) {
      if (kid.namespaceURI === MC && kid.localName === 'AlternateContent') {
        const pick = Array.from(kid.children).find((c) => c.namespaceURI === MC && ((c.localName === 'Choice' && requires(c)) || c.localName === 'Fallback'));
        const moved = pick ? Array.from(pick.childNodes) : [];
        for (const m of moved) el.insertBefore(m, kid);
        el.removeChild(kid);
        for (const m of moved) if (m.nodeType === 1) walkOrDrop(el, m as Element, ign);
      } else {
        walkOrDrop(el, kid, ign);
      }
    }
  };
  const walkOrDrop = (parent: Element, kid: Element, ign: Set<string>) => {
    if (!understood(kid.namespaceURI) && kid.namespaceURI && ign.has(kid.namespaceURI)) parent.removeChild(kid);
    else walk(kid, ign);
  };
  walk(doc.documentElement, new Set());
}

export type SchemaProblem = { part: string; message: string };

/**
 * What Excel writes that the 2016 schema doesn't allow, taken out before checking: xml:space on a
 * SpreadsheetML text element (<t>, in shared strings, rich text runs and notes), which Excel writes
 * on text with leading or trailing spaces but which the schema types as plain ST_Xstring.
 */
function excelAllows(doc: Document): void {
  const SML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  for (const t of Array.from(doc.getElementsByTagNameNS(SML, 't'))) t.removeAttributeNS('http://www.w3.org/XML/1998/namespace', 'space');
}

/** Each schema problem in the package's XML parts, as "part: line: message". */
export async function validatePackage(bytes: Uint8Array): Promise<SchemaProblem[]> {
  const { wrapper, preload, namespaces } = load();
  const parts = unzipSync(bytes);
  const xml: { fileName: string; contents: string }[] = [];
  const names: string[] = [];
  for (const [name, data] of Object.entries(parts).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/\.xml$/i.test(name) || name === '[Content_Types].xml') continue;
    const doc = new DOMParser().parseFromString(strFromU8(data), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) { names.push(name); xml.push({ fileName: `p${names.length - 1}.xml`, contents: '<not-well-formed/>' }); continue; }
    if (!namespaces.has(doc.documentElement.namespaceURI ?? '')) continue;
    processMce(doc, namespaces);
    excelAllows(doc);
    names.push(name);
    xml.push({ fileName: `p${names.length - 1}.xml`, contents: new XMLSerializer().serializeToString(doc) });
  }
  if (!xml.length) return [];
  const r = await validateXML({ xml, schema: [{ fileName: 'wrap.xsd', contents: wrapper }], preload, maxMemoryPages: 16384 });
  const out: SchemaProblem[] = [];
  for (const line of r.rawOutput.split('\n')) {
    const m = /^p(\d+)\.xml:(\d+): (.*)$/.exec(line.trim());
    if (m) out.push({ part: names[Number(m[1])], message: `${m[2]}: ${m[3].replace(/^Schemas validity error : /, '')}` });
  }
  // a failure with no line read (a changed message format) must not pass as "no problems"
  if (!r.valid && !out.length) throw new Error(`the schema check failed without a problem it could read:\n${r.rawOutput.slice(0, 2000)}`);
  return out;
}
