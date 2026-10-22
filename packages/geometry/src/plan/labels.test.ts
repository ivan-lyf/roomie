import { describe, expect, it } from 'vitest';
import {
  dimensionsIn,
  labelTokens,
  parseArea,
  parseCeiling,
  parseDimension,
  readPlanText,
  readRoomLabel,
  roomNameFromLabel,
  roomTypeFromLabel,
  uniqueRoomName,
} from './labels';

const FT = 0.3048;
const IN = 0.0254;

describe('roomTypeFromLabel', () => {
  it.each([
    ['BEDROOM', 'bedroom'],
    ['Bedroom 2', 'bedroom'],
    ['BR2', 'bedroom'],
    ['MBR', 'bedroom'],
    ['Primary Bedroom', 'bedroom'],
    ['LIVING', 'living_room'],
    ['Living/Dining', 'living_room'],
    ['GREAT RM', 'living_room'],
    ['DINING', 'dining_area'],
    ['DR', 'dining_area'],
    ['KIT', 'kitchen'],
    ['Kitchen', 'kitchen'],
    ['BATH', 'bathroom'],
    ['ENS', 'bathroom'],
    ['Ensuite', 'bathroom'],
    ['PDR', 'bathroom'],
    ['W.C.', 'bathroom'],
    ['W/D', 'laundry'],
    ['Laundry', 'laundry'],
    ['WIC', 'closet'],
    ['W.I.C.', 'closet'],
    ['CL', 'closet'],
    ['DEN', 'den_office'],
    ['DN', 'den_office'],
    ['Office', 'den_office'],
    ['FOYER', 'hallway'],
    ['Entry', 'hallway'],
    ['BALCONY', 'balcony'],
    ['Patio', 'balcony'],
    ['STUDIO', 'studio'],
    // French, as on Quebec listings and the floor_plan_dataset.
    ['CHAMBRE 2', 'bedroom'],
    ['Chambre 1 10.95 m²', 'bedroom'],
    ['SALON', 'living_room'],
    ['SÉJOUR', 'living_room'],
    ['SALLE À MANGER', 'dining_area'],
    ['CUISINE', 'kitchen'],
    ['SALLE DE BAINS', 'bathroom'],
    ['S.D.B.', 'bathroom'],
    ['BAINS 6.31 m²', 'bathroom'],
    ["SALLE D'EAU", 'bathroom'],
    ['DÉGT 4.82 m²', 'hallway'],
    ['ENTRÉE', 'hallway'],
    ['BUREAU', 'den_office'],
    ['DRESSING', 'closet'],
    ['PL', 'closet'],
    ['BUANDERIE', 'laundry'],
    ['TERRASSE', 'balcony'],
    ['GARAGE', 'other'],
    ['GARAGES', 'other'],
    ['REPAS', 'dining_area'],
    ['DOUCHE 5,88 m²', 'bathroom'],
    ['CELLIER', 'closet'],
    ['DRESS.', 'closet'],
    ['C.H. 1', 'bedroom'],
    ['CH.3', 'bedroom'],
    ['HALL + DEGT.', 'hallway'],
    ['PALIER', 'hallway'],
    ['ATELIER', 'other'],
    ['MASTER BEDROOM', 'bedroom'],
    ['MASTER BATH', 'bathroom'],
    ['MASTER', 'bedroom'],
  ])('reads %j as %s', (text, type) => {
    expect(roomTypeFromLabel(text)).toBe(type);
  });

  it('knows "MASTER" alone is only a weak hint', () => {
    expect(readRoomLabel('MASTER')).toEqual({ type: 'bedroom', weak: true });
    expect(readRoomLabel('MASTER BEDROOM')).toEqual({ type: 'bedroom', weak: false });
    expect(readPlanText('MASTER')).toMatchObject({ roomType: 'bedroom', weakRoomType: true });
    expect(readPlanText('BATH')).not.toHaveProperty('weakRoomType');
  });

  it.each(["12'4\" x 10'", 'N', 'UP', 'DW', 'REF', 'VUE EN PLAN', '7.70'])(
    'finds no room in %j',
    (text) => {
      expect(roomTypeFromLabel(text)).toBeUndefined();
    },
  );
});

describe('parseDimension', () => {
  const close = (actual: number[] | undefined, expected: number[]) => {
    expect(actual?.length).toBe(expected.length);
    expected.forEach((v, i) => expect(actual?.[i]).toBeCloseTo(v, 6));
  };

  it.each([
    ["12'4\" x 10'", [12 * FT + 4 * IN, 10 * FT]],
    ['12\'-4" × 10\'-0"', [12 * FT + 4 * IN, 10 * FT]],
    ['12 ft 4 in x 10 ft', [12 * FT + 4 * IN, 10 * FT]],
    ['12’4” x 10’', [12 * FT + 4 * IN, 10 * FT]],
    ["11'6'' x 9'", [11 * FT + 6 * IN, 9 * FT]],
    ['11\'6"', [11 * FT + 6 * IN]],
    ["12'x10'", [12 * FT, 10 * FT]],
  ])('reads %j as feet and inches', (text, meters) => {
    const readings = parseDimension(text);
    expect(readings.map((r) => r.unit)).toEqual(['imperial']);
    close(readings[0]?.meters, meters);
  });

  it.each([
    ['3.60 x 3.00 m', 'metric_m'],
    ['360 x 300 cm', 'metric_cm'],
    ['3600 x 3000 mm', 'metric_mm'],
  ] as const)('reads %j in its stated unit', (text, unit) => {
    const readings = parseDimension(text);
    expect(readings.map((r) => r.unit)).toEqual([unit]);
    close(readings[0]?.meters, [3.6, 3.0]);
  });

  it('reads thousands grouped by a space', () => {
    const readings = parseDimension('1 370').map((r) => r.meters[0]!);
    expect(readings.map((m) => +m.toFixed(6))).toEqual([1.37, 13.7, 1370]);
    expect(parseDimension('12 6')).toEqual([]);
  });

  it('reads bare numbers in every metric unit, for detectScale to choose', () => {
    const readings = parseDimension('3600x3000');
    expect(readings.map((r) => r.unit)).toEqual(['metric_mm', 'metric_cm', 'metric_m']);
    close(readings[0]?.meters, [3.6, 3.0]);
    close(parseDimension('3,60 x 3,00').at(-1)?.meters, [3.6, 3.0]);
    close(parseDimension('7.70').at(-1)?.meters, [7.7]);
  });

  it.each(['BEDROOM', 'MAX', 'UP', "12' x", '1 x 2 x 3', '42 m²'])(
    'finds no dimension in %j',
    (text) => {
      expect(parseDimension(text)).toEqual([]);
    },
  );
});

describe('parseArea', () => {
  it.each([
    ['450 sq ft', 450 * FT * FT, 'imperial'],
    ['450 SF', 450 * FT * FT, 'imperial'],
    ['450 sq. ft.', 450 * FT * FT, 'imperial'],
    ['42 m²', 42, 'metric'],
    ['10,20 m2', 10.2, 'metric'],
    ['CHAMBRE 2 10.20 m²', 10.2, 'metric'],
  ] as const)('reads %j', (text, squareMeters, unit) => {
    const area = parseArea(text);
    expect(area?.unit).toBe(unit);
    expect(area?.squareMeters).toBeCloseTo(squareMeters, 6);
  });

  it.each(["12'4\" x 10'", 'BEDROOM', '3600 x 3000'])('finds no area in %j', (text) => {
    expect(parseArea(text)).toBeUndefined();
  });
});

describe('readPlanText', () => {
  it('lets a room name win the kind, keeping its area', () => {
    expect(readPlanText('CHAMBRE 2 10.20 m²')).toMatchObject({
      kind: 'room_label',
      roomType: 'bedroom',
      area: { unit: 'metric' },
    });
  });

  it('tells dimensions, areas, ceilings and other text apart', () => {
    expect(readPlanText("12'4\" x 10'").kind).toBe('dimension');
    expect(readPlanText('450 sq ft').kind).toBe('area');
    expect(readPlanText("9' CLG")).toMatchObject({ kind: 'ceiling', ceiling: 9 * 0.3048 });
    expect(readPlanText('N').kind).toBe('other');
  });

  it("reads a room's size from the same line as its name", () => {
    const bedroom = readPlanText('BEDROOM 11\'6" x 11\'6"');
    expect(bedroom).toMatchObject({ kind: 'room_label', roomType: 'bedroom' });
    expect(bedroom.dimensions?.map((d) => d.unit)).toEqual(['imperial']);
    expect(bedroom.dimensions?.[0]?.meters[0]).toBeCloseTo(3.5052, 9);
    expect(readPlanText("BR2 12'x10'").dimensions?.[0]?.meters).toEqual([12 * 0.3048, 10 * 0.3048]);
    expect(readPlanText('BEDROOM 2')).not.toHaveProperty('dimensions');
  });
});

describe('dimensionsIn', () => {
  it('needs a unit or a pair inside longer text', () => {
    expect(dimensionsIn('LIVING 3600 x 4200').map((r) => r.unit)).toEqual([
      'metric_mm',
      'metric_cm',
      'metric_m',
    ]);
    expect(dimensionsIn('KITCHEN 3.6 m')).toEqual([{ unit: 'metric_m', meters: [3.6] }]);
    expect(dimensionsIn('CHAMBRE 2')).toEqual([]);
  });
});

describe('parseCeiling', () => {
  it.each([
    ["9' CLG", 2.7432],
    ['CEILING 2.7 m', 2.7],
    ['HSP 2,50', 2.5],
    ['H.S.P. 2,50 m', 2.5],
    ['CLG HT 96"', 2.4384],
  ])('reads %j as %f m', (text, meters) => {
    expect(parseCeiling(text)).toBeCloseTo(meters, 6);
  });

  it('takes the height next to the ceiling word, leaving the room its size', () => {
    expect(parseCeiling("LIVING 12' x 10' 9' CLG")).toBeCloseTo(9 * 0.3048, 9);
    const living = readPlanText("LIVING 12' x 10' 9' CLG");
    expect(living).toMatchObject({ kind: 'room_label', roomType: 'living_room' });
    expect(living.ceiling).toBeCloseTo(9 * 0.3048, 9);
    expect(living.dimensions?.[0]?.meters).toEqual([12 * 0.3048, 10 * 0.3048]);
    expect(parseCeiling('Ceiling height 2.6 m')).toBe(2.6);
  });

  it('needs a ceiling word and a ceiling-like height', () => {
    expect(parseCeiling("9' x 10'")).toBeUndefined();
    expect(parseCeiling('CLG 30 m')).toBeUndefined();
  });
});

describe('labelTokens', () => {
  it('splits a label into normalized words and numbers', () => {
    expect(labelTokens('C.H. 1')).toEqual(['CH', '1']);
    expect(labelTokens('Hall + Dégt.')).toEqual(['HALL', 'DEGT']);
    expect(labelTokens('CHAMBRE 1 12,56 m²')).toEqual(['CHAMBRE', '1', '12', '56', 'M']);
  });
});

describe('room names', () => {
  it.each([
    ['MASTER BEDROOM', 'bedroom', 'Master bedroom'],
    ['BEDROOM 2 11\'6" x 11\'6"', 'bedroom', 'Bedroom 2'],
    ['BR2', 'bedroom', 'Bedroom 2'],
    ['CHAMBRE 1 10.5 m²', 'bedroom', 'Chambre 1'],
    ['W.I.C.', 'closet', 'Closet'],
    ['DEN', 'den_office', 'Den'],
    ['LIVING/DINING', 'living_room', 'Living/dining'],
  ] as const)('names %j', (text, type, name) => {
    expect(roomNameFromLabel(text, type)).toBe(name);
  });

  it('numbers a name already taken', () => {
    expect(uniqueRoomName(['Bedroom'], 'Kitchen')).toBe('Kitchen');
    expect(uniqueRoomName(['Bedroom', 'Bedroom 2'], 'Bedroom')).toBe('Bedroom 3');
  });
});
