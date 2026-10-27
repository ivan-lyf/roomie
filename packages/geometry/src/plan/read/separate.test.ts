import { describe, expect, it } from 'vitest';
import { area } from '../polygon';
import { separateRooms } from './separate';

const P = (x: number, y: number) => ({ x, y });
const box = (x0: number, y0: number, x1: number, y1: number) => [
  P(x0, y0),
  P(x1, y0),
  P(x1, y1),
  P(x0, y1),
];
const text = (t: string, x: number, y: number) => ({
  text: t,
  bbox: { x: x - 20, y: y - 5, w: 40, h: 10 },
});
const MIN = 100;

describe('separateRooms', () => {
  it('cuts a small room out of the box drawn over it', () => {
    const rooms = [
      { polygon: box(0, 0, 400, 300), label: 'HALL' },
      { polygon: box(300, 200, 400, 300), label: 'WC' },
    ];
    const [hall, wc] = separateRooms(rooms, [text('HALL', 150, 150), text('WC', 350, 250)], MIN);
    expect(wc!.polygon).toEqual(rooms[1]!.polygon);
    expect(area(hall!.polygon)).toBeCloseTo(400 * 300 - 100 * 100);
    expect(hall!.polygon).toHaveLength(6);
  });

  it('gives the overlap to the room whose label is in it, even the larger one', () => {
    const rooms = [
      { polygon: box(0, 0, 400, 400), label: 'CHAMBRE 1' },
      { polygon: box(0, 300, 400, 500), label: 'HALL' },
    ];
    const texts = [text('CHAMBRE 1', 200, 350), text('HALL', 200, 450)];
    const [bedroom, hall] = separateRooms(rooms, texts, MIN);
    expect(area(bedroom!.polygon)).toBeCloseTo(400 * 400);
    expect(area(hall!.polygon)).toBeCloseTo(400 * 100);
  });

  it('reads a label split into words, and ignores text outside the room', () => {
    const rooms = [
      { polygon: box(0, 0, 400, 400), label: 'TERRASSE\nCOUVERTE' },
      { polygon: box(0, 300, 400, 500), label: 'HALL' },
    ];
    // The hall's label is outside its outline, so neither label decides: the smaller room wins.
    const texts = [text('COUVERTE', 200, 350), text('HALL', 200, 600)];
    const [terrace, hall] = separateRooms(rooms, texts, MIN);
    expect(area(terrace!.polygon)).toBeCloseTo(400 * 400);
    expect(area(hall!.polygon)).toBeCloseTo(400 * 100);
  });

  it('drops a room the other covers completely', () => {
    const rooms = [
      { polygon: box(0, 0, 400, 300), label: 'CUISINE' },
      { polygon: box(0, 0, 200, 200), label: 'CELLIER' },
    ];
    const out = separateRooms(rooms, [text('CUISINE', 100, 100)], MIN);
    expect(out).toEqual([rooms[0]]);
  });

  it('keeps the piece with its label when a cut splits a room', () => {
    const rooms = [
      { polygon: box(0, 0, 600, 200), label: 'DEGAGEMENT' },
      { polygon: box(200, 0, 400, 200), label: 'BAINS' },
    ];
    const texts = [text('DEGAGEMENT', 500, 100), text('BAINS', 300, 100)];
    const [hall, bath] = separateRooms(rooms, texts, MIN);
    expect(bath!.polygon).toEqual(rooms[1]!.polygon);
    expect(area(hall!.polygon)).toBeCloseTo(200 * 200);
    expect(Math.min(...hall!.polygon.map((p) => p.x))).toBeCloseTo(400);
  });

  it('leaves a room wholly inside another, since the cut would leave a hole', () => {
    const rooms = [
      { polygon: box(0, 0, 400, 400), label: 'SEJOUR' },
      { polygon: box(100, 100, 200, 200), label: 'PLACARD' },
    ];
    expect(separateRooms(rooms, [], MIN)).toEqual(rooms);
  });

  it('leaves rooms that only share a wall, or barely overlap', () => {
    const rooms = [
      { polygon: box(0, 0, 200, 200) },
      { polygon: box(200, 0, 400, 200) },
      { polygon: box(395, 0, 600, 200) },
    ];
    expect(separateRooms(rooms, [], 5 * 200 + 1)).toEqual(rooms);
  });
});
