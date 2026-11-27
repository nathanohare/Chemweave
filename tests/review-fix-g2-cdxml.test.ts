// @vitest-environment jsdom
//
// Review fixes (group g2), CDXML side: the ChemDraw objects kept for writing back travel with
// their drawing when documents are swapped (a tab switch, a slide change), and a ChemDraw curve
// that was only moved is saved where it was moved to. Every file is built here.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { Deck } from '../src/deck/deck';

const parse = (t: string) => new DOMParser().parseFromString(t.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml').documentElement;
const all = (e: Element, name: string) => Array.from(e.getElementsByTagName(name));
const file = (body: string) => `<?xml version="1.0" encoding="UTF-8" ?><CDXML CreationProgram="ChemDraw 25.0.2.14" BondLength="14.40"><page id="1" BoundingBox="0 0 540 720" HeightPages="1" WidthPages="1">${body}</page></CDXML>`;

// a structure with a plain bracketed group round it (kept for writing back, not shown)
const BRACKETED = file('<fragment id="2"><n id="10" p="0 0"/><n id="11" p="30 0"/><b id="20" B="10" E="11"/></fragment>'
  + '<bracketedgroup id="40" BracketedObjectIDs="10 11" RepeatCount="2"/>');
const PLAIN = file('<fragment id="2"><n id="10" p="0 0"/><n id="11" p="30 0"/><b id="20" B="10" E="11"/></fragment>');

describe('F010: kept ChemDraw objects travel with their drawing on swap', () => {
  it('saves a file opened by swapping it into the host with its bracketed group', () => {
    const opened = readCdxml(BRACKETED).doc;
    expect(opened.kept).toHaveLength(1);
    // as the workspace opens a file: the read document is the tab's stash, swapped into the host
    const host = new Doc();
    host.swap(opened);
    expect(host.kept).toHaveLength(1);
    expect(opened.kept).toHaveLength(0);
    const x = parse(writeCdxml(host));
    expect(all(x, 'bracketedgroup')).toHaveLength(1);
    expect(all(x, 'bracketedgroup')[0].getAttribute('RepeatCount')).toBe('2');
  });

  it("does not write one tab's kept objects into another tab's file", () => {
    const a = readCdxml(BRACKETED).doc, b = readCdxml(PLAIN).doc;
    const host = new Doc();
    host.swap(a); // tab A shown
    host.swap(a); // back to A's stash
    host.swap(b); // tab B shown
    expect(all(parse(writeCdxml(host)), 'bracketedgroup')).toHaveLength(0);
    host.swap(b);
    host.swap(a); // tab A again
    expect(all(parse(writeCdxml(host)), 'bracketedgroup')).toHaveLength(1);
  });

  it("keeps each slide's kept objects with that slide through the deck's swaps", () => {
    const host = new Doc();
    const own = { xml: '<bracketedgroup id="1"/>', refs: {} };
    host.kept = [own];
    const deck = new Deck(host);
    const s0 = deck.makeSlide('title-content'), s1 = deck.makeSlide('title-content');
    const k0 = { xml: '<chemicalproperty id="7"/>', refs: {} }, k1 = { xml: '<bracketedgroup id="9"/>', refs: {} };
    s0.doc.kept = [k0];
    s1.doc.kept = [k1];
    deck.load([s0, s1], deck.size, deck.master);
    deck.attach();
    expect(host.kept).toEqual([k0]);
    deck.go(1);
    expect(host.kept).toEqual([k1]);
    expect(deck.slides[0].doc.kept).toEqual([k0]);
    deck.detach();
    expect(host.kept).toEqual([own]);
    expect(deck.docOf(1).kept).toEqual([k1]);
  });
});

describe('F011: a ChemDraw curve that was only moved is saved where it was moved to', () => {
  const nums = (s: string | null) => s!.split(' ').map(Number);
  const reopened = (xml: string) => [...readCdxml(xml).doc.shapes.values()][0];

  it('moves the CurvePoints of a closed curve', () => {
    const pts = '10 10 0 10 0 20 0 30 10 30 20 30 20 20 20 10 10 10';
    const doc = readCdxml(file(`<curve id="30" CurveType="1" Closed="yes" CurvePoints="${pts}"/>`)).doc;
    const s = doc.shapes.get(30)!;
    doc.edit('Move', () => doc.updateShape(30, { x1: s.x1 + 50, x2: s.x2 + 50 }));
    const xml = writeCdxml(doc);
    const c = all(parse(xml), 'curve');
    expect(c).toHaveLength(1);
    expect(nums(c[0].getAttribute('CurvePoints'))).toEqual(nums(pts).map((v, i) => (i % 2 === 0 ? v + 50 : v)));
    const back = reopened(xml);
    expect(back.x1).toBeCloseTo(s.x1 + 50, 2);
    expect(back.x2).toBeCloseTo(s.x2 + 50, 2);
    expect(back.y1).toBeCloseTo(s.y1, 2);
  });

  it("moves the CurvePoints of an open (Freeform pen) curve", () => {
    const pts = '0 0 0 0 10 -10 20 -10 30 0 30 0';
    const doc = readCdxml(file(`<curve id="30" CurveType="0" CurvePoints="${pts}"/>`)).doc;
    const s = doc.shapes.get(30)!;
    doc.edit('Move', () => doc.updateShape(30, { x1: s.x1 + 20, x2: s.x2 + 20, y1: s.y1 + 5, y2: s.y2 + 5 }));
    const xml = writeCdxml(doc);
    expect(nums(all(parse(xml), 'curve')[0].getAttribute('CurvePoints'))).toEqual(nums(pts).map((v, i) => (i % 2 === 0 ? v + 20 : v + 5)));
    const back = reopened(xml);
    expect(back.x1).toBeCloseTo(s.x1 + 20, 2);
    expect(back.y1).toBeCloseTo(s.y1 + 5, 2);
  });
});
