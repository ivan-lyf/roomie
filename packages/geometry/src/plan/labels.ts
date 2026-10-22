import type { PlanTextKind, RoomType, SourceUnit } from '@roomie/schema';

// Plan text to meaning: room names, dimensions and areas, in English and French (Quebec
// listings use French). Pure, so the API and the editor read text the same way.

const FOOT = 0.3048;
const INCH = 0.0254;
const SQUARE_FOOT = FOOT * FOOT;

/**
 * Words and abbreviations for each room type, after normalizing (upper case, no accents),
 * separated by `|`.
 */
const ROOM_WORDS: [RoomType, string][] = [
  ['dining_area', 'SALLE A MANGER|DINING ROOM|DINING|DINETTE|DIN|DR|SAM|NOOK'],
  [
    'bathroom',
    "SALLE DE BAINS|SALLE DE BAIN|SALLE D'EAU|SALLE D EAU|POWDER ROOM|EN SUITE|BATHROOM|" +
      'WASHROOM|ENSUITE|POWDER|TOILET|BAINS|BATH|ENS|PDR|SDB|SDE|BA|WC',
  ],
  [
    'living_room',
    'PIECE A VIVRE|LIVING ROOM|FAMILY ROOM|GREAT ROOM|GREAT RM|SEJOUR|LIVING|FAMILY|LOUNGE|' +
      'SALON|LIV|LR',
  ],
  ['bedroom', 'PRIMARY BEDROOM|MASTER BEDROOM|BEDROOM|CHAMBRE|PRIMARY|MASTER|BDRM|MBR|BR|CH'],
  ['studio', 'STUDIO'],
  ['den_office', 'OFFICE|BUREAU|STUDY|FLEX|DEN|DN'],
  ['kitchen', 'KITCHEN|CUISINE|KITCH|CUIS|KIT'],
  [
    'hallway',
    'DEGAGEMENT|CIRCULATION|VESTIBULE|CORRIDOR|ENTRANCE|COULOIR|HALLWAY|ENTREE|FOYER|ENTRY|' +
      'HALL|DEGT|DGT|FOY|ENT',
  ],
  [
    'closet',
    'WALK IN|RANGEMENT|PLACARD|DRESSING|STORAGE|CLOSET|PANTRY|LINEN|STOR|WIC|CLO|CL|PL',
  ],
  ['laundry', 'BUANDERIE|LINGERIE|LAUNDRY|UTILITY|LAUN|W/D'],
  ['balcony', 'TERRASSE|BALCONY|TERRACE|BALCON|LOGGIA|PATIO|PORCH|DECK|BALC'],
  ['other', 'ABRI VOITURE|MECHANICAL|GARAGE|CARPORT|MECH'],
];

/** Upper case, no accents, dotted abbreviations closed up ("W.C." → "WC", "S.D.B." → "SDB"). */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[’`]/g, "'")
    .replace(/\b([A-Z])\.\s*(?=[A-Z]\b)/g, '$1')
    .replace(/\b([A-Z]{1,3})\./g, '$1')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The room type a label names, if any: "BR2", "Primary Bedroom", "Chambre 2", "W/D". Phrases
 * win over single words, and the first room word in the text wins ("LIVING/DINING" is a
 * living room).
 */
export function roomTypeFromLabel(text: string): RoomType | undefined {
  const norm = normalize(text);
  let best: { type: RoomType; at: number; length: number } | undefined;
  for (const [type, words] of ROOM_WORDS) {
    for (const word of words.split('|')) {
      // A word on its own, or followed by a room number ("BR2", "CHAMBRE 2").
      const escaped = word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      const match = new RegExp(`(?<![A-Z])${escaped}(?![A-Z])`).exec(norm);
      if (!match) continue;
      const better =
        !best || match.index < best.at || (match.index === best.at && word.length > best.length);
      if (better) best = { type, at: match.index, length: word.length };
    }
  }
  return best?.type;
}

/** A dimension read in one unit: one length, or two for "12' x 10'", in meters. */
export type DimensionReading = { unit: SourceUnit; meters: number[] };

const PAIR = /\s*[x×*]\s*|\s+by\s+/i;
const FEET = String.raw`(\d+(?:[.,]\d+)?)\s*(?:'|′|ft\.?|feet)`;
const INCHES = String.raw`(\d+(?:[.,]\d+)?)\s*(?:"|″|''|in\.?|inches)`;
const IMPERIAL = new RegExp(String.raw`^(?:${FEET})?\s*-?\s*(?:${INCHES})?$`, 'i');
const METRIC_UNIT = /(\d)\s*(mm|cm|m)$/i;
const NUMBER = /^\d+(?:[.,]\d+)?$/;

const toNumber = (s: string) => Number(s.replace(',', '.'));

/**
 * Every unit a dimension label could be in. "12'4" x 10'" can only be imperial and "3.6 m" only
 * meters, but a bare "3600 x 3000" could be millimeters, centimeters or meters; `detectScale`
 * decides between them. Empty when the text isn't a dimension.
 */
export function parseDimension(text: string): DimensionReading[] {
  const norm = text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .trim();
  const parts = norm.split(PAIR).map((p) => p.trim());
  if (parts.length > 2 || parts.some((p) => p === '')) return [];

  const imperial = parts.map((p) => {
    const m = IMPERIAL.exec(p.replace(/\s+/g, ' '));
    if (!m || (m[1] === undefined && m[2] === undefined)) return undefined;
    return toNumber(m[1] ?? '0') * FOOT + toNumber(m[2] ?? '0') * INCH;
  });
  if (imperial.every((v) => v !== undefined)) return [{ unit: 'imperial', meters: imperial }];

  // A unit written once, at the end, covers both values: "3.60 x 3.00 m".
  const unit = METRIC_UNIT.exec(parts.at(-1)!)?.[2]?.toLowerCase();
  const numbers = parts.map((p) => p.replace(/\s*(mm|cm|m)$/i, ''));
  if (!numbers.every((n) => NUMBER.test(n))) return [];
  const values = numbers.map(toNumber);
  if (values.some((v) => v <= 0)) return [];
  const read = (u: SourceUnit, factor: number): DimensionReading => ({
    unit: u,
    meters: values.map((v) => v * factor),
  });
  if (unit === 'mm') return [read('metric_mm', 0.001)];
  if (unit === 'cm') return [read('metric_cm', 0.01)];
  if (unit === 'm') return [read('metric_m', 1)];
  return [read('metric_mm', 0.001), read('metric_cm', 0.01), read('metric_m', 1)];
}

const AREA = String.raw`(\d+(?:[.,]\d+)?)\s*`;
const SQUARE_FEET = new RegExp(
  `${AREA}(?:sq\\.?\\s*ft\\.?|sqft|s\\.?f\\.?|ft²|ft2|pi²|pc)(?![a-z])`,
  'i',
);
const SQUARE_METERS = new RegExp(
  `${AREA}(?:m²|m2|sq\\.?\\s*m(?![a-z])|sqm|m\\.?c\\.?)(?![a-z])`,
  'i',
);

/** An area label in square meters: "450 sq ft", "450 SF", "42 m²", "10,20 m2". */
export function parseArea(
  text: string,
): { squareMeters: number; unit: 'imperial' | 'metric' } | undefined {
  const feet = SQUARE_FEET.exec(text);
  if (feet) return { squareMeters: toNumber(feet[1]!) * SQUARE_FOOT, unit: 'imperial' };
  const meters = SQUARE_METERS.exec(text);
  if (meters) return { squareMeters: toNumber(meters[1]!), unit: 'metric' };
  return undefined;
}

export type PlanTextReading = {
  kind: PlanTextKind;
  roomType?: RoomType;
  area?: { squareMeters: number; unit: 'imperial' | 'metric' };
  dimensions?: DimensionReading[];
};

/**
 * What a piece of plan text says. A room name wins the kind, so "CHAMBRE 2 10.20 m²" is a room
 * label that also carries its area.
 */
export function readPlanText(text: string): PlanTextReading {
  const roomType = roomTypeFromLabel(text);
  const area = parseArea(text);
  const dimensions = area ? [] : parseDimension(text);
  const kind: PlanTextKind = roomType
    ? 'room_label'
    : area
      ? 'area'
      : dimensions.length > 0
        ? 'dimension'
        : 'other';
  return {
    kind,
    ...(roomType && { roomType }),
    ...(area && { area }),
    ...(dimensions.length > 0 && { dimensions }),
  };
}
