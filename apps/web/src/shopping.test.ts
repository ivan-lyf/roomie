import type { Product } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import { shoppingList, toCsv, toText } from './shopping';

const product = (
  articleNo: string,
  name: string,
  priceCad: number,
  more: Partial<Product> = {},
): Product => ({
  articleNo,
  familyId: articleNo,
  options: [],
  name,
  category: 'nightstand',
  status: 'active',
  priceCad,
  url: `https://www.ikea.com/ca/en/p/test-${articleNo.replaceAll('.', '')}/`,
  imageUrl: null,
  color: null,
  material: null,
  dims: { w: 0.4, d: 0.4, h: 0.5 },
  shape: 'rect',
  extendedW: null,
  modelUrl: null,
  modelSource: 'procedural',
  styleTags: [],
  scrapedAt: new Date('2026-10-20T00:00:00Z'),
  ...more,
});

const nightstand = product('900.000.12', 'TEST Nightstand - white', 19.99);
const sofa = product('900.000.15', 'TEST Sofa, 3-seat - "Grann" beige', 899, {
  category: 'sofa',
  scrapedAt: new Date('2026-10-25T00:00:00Z'),
});
const lamp = product('900.000.20', 'TEST Floor lamp', 59, { status: 'discontinued' });
const products = new Map([nightstand, sofa, lamp].map((p) => [p.articleNo, p]));
const rooms = [
  { id: 'r1', name: 'Bedroom' },
  { id: 'r2', name: 'Living' },
];
const item = (id: string, articleNo: string, roomId: string) => ({
  id,
  articleNo,
  roomId,
  x: 0,
  y: 0,
  rotation: 0,
});
const plan = {
  rooms: rooms as never,
  furniture: [
    item('f1', '900.000.15', 'r2'),
    item('f2', '900.000.12', 'r1'),
    item('f3', '900.000.12', 'r1'),
    item('f4', '900.000.12', 'r2'),
    item('f5', '900.000.20', 'r2'),
    item('f6', '999.999.99', 'r2'),
  ],
};

describe('shoppingList', () => {
  const list = shoppingList(plan, products);

  it('has a line per product with its quantity and rooms, by room then category', () => {
    expect(list.lines.map((l) => [l.articleNo, l.quantity])).toEqual([
      ['900.000.12', 3],
      ['900.000.15', 1],
      ['900.000.20', 1],
      ['999.999.99', 1],
    ]);
    expect(list.lines[0]!.rooms).toEqual([
      { roomId: 'r1', name: 'Bedroom', quantity: 2 },
      { roomId: 'r2', name: 'Living', quantity: 1 },
    ]);
    expect(list.count).toBe(6);
  });

  it('adds up to the cent, and flags what IKEA no longer sells or the catalog lacks', () => {
    expect(list.lines[0]!.lineCad).toBe(59.97);
    expect(list.totalCad).toBe(59.97 + 899 + 59);
    expect(list.unavailableCad).toBe(59);
    expect(list.lines.map((l) => l.flag)).toEqual([
      undefined,
      undefined,
      'discontinued',
      'missing',
    ]);
    expect(list.lines[3]!.lineCad).toBeUndefined();
    expect(list.pricedAt).toEqual(new Date('2026-10-25T00:00:00Z'));
  });

  it('adds many small prices exactly', () => {
    const cheap = product('900.000.30', 'TEST Hook', 0.1);
    const hooks = ['a', 'b', 'c'].map((id) => item(id, '900.000.30', 'r1'));
    const total = shoppingList(
      { rooms: plan.rooms, furniture: hooks },
      new Map([[cheap.articleNo, cheap]]),
    );
    expect(total.totalCad).toBe(0.3);
  });
});

describe('toCsv', () => {
  it('quotes what needs it, ends with the total, and opens as UTF-8 in Excel', () => {
    const csv = toCsv(shoppingList(plan, products));
    expect(csv.startsWith('﻿Article number,Product,Quantity,')).toBe(true);
    const rows = csv.trimEnd().split('\r\n');
    expect(rows[1]).toBe(
      '900.000.12,TEST Nightstand - white,3,19.99,59.97,Bedroom ×2; Living,Sold at IKEA,' +
        'https://www.ikea.com/ca/en/p/test-90000012/',
    );
    expect(rows[2]).toContain(',"TEST Sofa, 3-seat - ""Grann"" beige",1,899.00,899.00,');
    expect(rows[3]).toContain(',No longer sold,');
    expect(rows[4]).toBe('999.999.99,Not in the catalog,1,,,Living,Not in the catalog,');
    expect(rows.at(-1)).toBe(',Total,6,,1017.97,,,');
  });
});

describe('toText', () => {
  it('lists article numbers with quantities, to paste', () => {
    expect(toText(shoppingList(plan, products)).split('\n')[0]).toBe(
      '900.000.12 × 3  TEST Nightstand - white',
    );
  });
});
