import type { PlanTextKind, RoomType, SourceUnit } from '@roomie/schema';

// Plan text to meaning: room names, dimensions and areas, in English and French (Quebec
// listings use French). Pure, so the API and the editor read text the same way.

export const FOOT = 0.3048;
export const INCH = 0.0254;
export const SQUARE_FOOT = FOOT * FOOT;

/**
 * Words and abbreviations for each room type, after normalizing (upper case, no accents),
 * separated by `|`.
 */
const ROOM_WORDS: [RoomType, string][] = [
  ['dining_area', 'SALLE A MANGER|DINING ROOM|DINING|DINETTE|REPAS|DIN|DR|SAM|NOOK'],
  [
    'bathroom',
    "SALLE DE BAINS|SALLE DE BAIN|SALLE D'EAU|SALLE D EAU|SALLE DE DOUCHE|POWDER ROOM|" +
      'MASTER BATH|PRIMARY BATH|MASTER ENSUITE|PRIMARY ENSUITE|EN SUITE|BATHROOM|WASHROOM|' +
      'ENSUITE|POWDER|TOILET|DOUCHE|BAINS|BATH|ENS|PDR|SDB|SDE|BA|WC',
  ],
  [
    'living_room',
    'PIECE A VIVRE|LIVING ROOM|FAMILY ROOM|GREAT ROOM|GREAT RM|SEJOUR|LIVING|FAMILY|LOUNGE|' +
      'SALON|LIV|LR',
  ],
  ['bedroom', 'PRIMARY BEDROOM|MASTER BEDROOM|BEDROOM|CHAMBRE|BDRM|MBR|BR|CH'],
  ['studio', 'STUDIO'],
  ['den_office', 'OFFICE|BUREAU|STUDY|FLEX|DEN|DN'],
  ['kitchen', 'KITCHENETTE|CUISINETTE|KITCHEN|CUISINE|KITCH|CUIS|KIT'],
  [
    'hallway',
    'DEGAGEMENT|CIRCULATION|VESTIBULE|CORRIDOR|ENTRANCE|COULOIR|HALLWAY|PALIER|ENTREE|FOYER|' +
      'ENTRY|HALL|DEGT|DGT|FOY|ENT',
  ],
  [
    'closet',
    'WALK IN|RANGEMENT|VESTIAIRE|PLACARD|DRESSING|CELLIER|STORAGE|RESERVE|CLOSET|PANTRY|LINEN|' +
      'DRESS|STOR|WIC|CLO|CL|PL',
  ],
  ['laundry', 'BUANDERIE|LINGERIE|LAUNDRY|UTILITY|LAUN|W/D'],
  ['balcony', 'TERRASSE|BALCONY|TERRACE|BALCON|LOGGIA|PATIO|PORCH|DECK|BALC'],
  [
    'other',
    'LOCAL TECHNIQUE|ABRI VOITURE|MECHANICAL|CHAUFFERIE|GARAGES|CARPORT|ATELIER|GARAGE|CAVE|' +
      'MECH|ABRI',
  ],
];

/**
 * Words that name a room only on their own: "MASTER" is the master bedroom, but next to "BATH"
 * it says whose bathroom.
 */
const WEAK_WORDS: [RoomType, string][] = [['bedroom', 'MASTER|PRIMARY']];

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

/** The room word in normalized text that names it: the first one, the longer at a tie. */
function matchRoomWord(norm: string, dictionary: [RoomType, string][]) {
  let best: { type: RoomType; at: number; length: number } | undefined;
  for (const [type, words] of dictionary) {
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

/** A label's words and numbers, normalized: "C.H. 1" and "CH 1" are both CH and 1. */
export function labelTokens(text: string): string[] {
  return normalize(text)
    .split(/[^A-Z0-9]+/)
    .filter((t) => t !== '');
}

/**
 * The room type a label names, if any: "BR2", "Primary Bedroom", "Chambre 2", "W/D". Phrases
 * win over single words, and the first room word in the text wins ("LIVING/DINING" is a
 * living room). `weak` is a label that only says "MASTER" or "PRIMARY", which any other room
 * word in the same room overrules.
 */
export function readRoomLabel(text: string): { type: RoomType; weak: boolean } | undefined {
  const norm = normalize(text);
  const strong = matchRoomWord(norm, ROOM_WORDS);
  if (strong) return { type: strong, weak: false };
  const weak = matchRoomWord(norm, WEAK_WORDS);
  return weak && { type: weak, weak: true };
}

/** The room type a label names, if any (see `readRoomLabel`). */
export function roomTypeFromLabel(text: string): RoomType | undefined {
  return readRoomLabel(text)?.type;
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

/**
 * A dimension inside longer text, like "BEDROOM 11'6" x 11'6"": the first run from a number that
 * reads as one. Only one with its unit written, or a pair, counts, so "BEDROOM 2" isn't 2 m.
 */
export function dimensionsIn(text: string): DimensionReading[] {
  const whole = parseDimension(text);
  if (whole.length > 0) return whole;
  for (const match of text.matchAll(/(?<![\d.,])\d/g)) {
    const readings = parseDimension(text.slice(match.index));
    if (readings.length === 1 || readings.some((r) => r.meters.length === 2)) return readings;
  }
  return [];
}

/** Ceiling words: "9' CLG", "Ceiling 2.7 m", and French "HSP 2,50" (hauteur sous plafond). */
const CEILING = /\b(?:CLG|CEILING|CEIL|HAUTEUR SOUS PLAFOND|PLAFOND|H\.?\s?S\.?\s?P\b\.?)/i;
/** A length anywhere in text: feet and inches, or a number with or without a metric unit. */
const LENGTH = new RegExp(
  String.raw`${FEET}\s*-?\s*(?:${INCHES})?|\d+(?:[.,]\d+)?\s*(?:"|″|in\.?|mm|cm|m(?![a-z]))?`,
  'gi',
);
/** Ceilings are this high, which also tells a bare "2,50" is meters. */
const CEILING_RANGE: [number, number] = [2, 6];

/**
 * The ceiling height a label gives, and the label without it: the ceiling-like length nearest
 * the ceiling word, so "LIVING 12' x 10' 9' CLG" is a 9' ceiling over a 12' x 10' room.
 */
function findCeiling(text: string): { meters: number; rest: string } | undefined {
  const word = CEILING.exec(text);
  if (!word) return undefined;
  const [wordStart, wordEnd] = [word.index, word.index + word[0].length];
  let best: { meters: number; start: number; end: number; gap: number } | undefined;
  for (const match of text.matchAll(LENGTH)) {
    const heights = parseDimension(match[0].trim())
      .filter((r) => r.meters.length === 1)
      .map((r) => r.meters[0]!)
      .filter((m) => m >= CEILING_RANGE[0] && m <= CEILING_RANGE[1]);
    if (heights.length !== 1) continue;
    const [start, end] = [match.index, match.index + match[0].length];
    const gap = end <= wordStart ? wordStart - end : Math.max(0, start - wordEnd);
    if (!best || gap < best.gap) best = { meters: heights[0]!, start, end, gap };
  }
  if (!best) return undefined;
  // Cut out the height and the word, the later one first so the earlier one's place holds.
  const cuts = [
    [best.start, best.end],
    [wordStart, wordEnd],
  ].sort((a, b) => b[0]! - a[0]!);
  let rest = text;
  for (const [from, to] of cuts) rest = `${rest.slice(0, from)} ${rest.slice(to)}`;
  return { meters: best.meters, rest: rest.replace(/\s+/g, ' ').trim() };
}

/** The ceiling height a label gives, in meters: "9' CLG" is 2.74. */
export function parseCeiling(text: string): number | undefined {
  return findCeiling(text)?.meters;
}

export type PlanTextReading = {
  kind: PlanTextKind;
  roomType?: RoomType;
  /** The room type comes from a word like "MASTER" alone, which other room words overrule. */
  weakRoomType?: true;
  area?: { squareMeters: number; unit: 'imperial' | 'metric' };
  dimensions?: DimensionReading[];
  /** A ceiling height, in meters. */
  ceiling?: number;
};

/**
 * What a piece of plan text says. A room name wins the kind, so "CHAMBRE 2 10.20 m²" is a room
 * label that also carries its area, and "BEDROOM 11'6" x 11'6" 9' CLG" one with its size and
 * its ceiling.
 */
export function readPlanText(text: string): PlanTextReading {
  const room = readRoomLabel(text);
  const roomType = room?.type;
  const found = findCeiling(text);
  const ceiling = found?.meters;
  // Sizes and areas are read from what's left once a ceiling height is taken out.
  const rest = found?.rest ?? text;
  const area = parseArea(rest);
  const dimensions = area ? [] : roomType ? dimensionsIn(rest) : found ? [] : parseDimension(rest);
  const kind: PlanTextKind = roomType
    ? 'room_label'
    : ceiling
      ? 'ceiling'
      : area
        ? 'area'
        : dimensions.length > 0
          ? 'dimension'
          : 'other';
  return {
    kind,
    ...(roomType && { roomType }),
    ...(room?.weak && { weakRoomType: true }),
    ...(area && { area }),
    ...(dimensions.length > 0 && { dimensions }),
    ...(ceiling && { ceiling }),
  };
}

/** What a room of each type is called until the user names it. */
export const ROOM_NAMES: Record<RoomType, string> = {
  living_room: 'Living room',
  bedroom: 'Bedroom',
  studio: 'Studio',
  dining_area: 'Dining area',
  den_office: 'Den',
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  hallway: 'Hallway',
  closet: 'Closet',
  laundry: 'Laundry',
  balcony: 'Balcony',
  other: 'Room',
};

/** Where a label's size or area starts: "BEDROOM 2 11'6" x 11'6"" names "BEDROOM 2". */
const MEASURE_START = new RegExp(
  String.raw`\d+(?:[.,]\d+)?\s*(?:'|′|"|″|ft\b|x\s*\d|×|m²|m2|sq\b|sf\b|cm\b|mm\b|m\b)`,
  'i',
);

/**
 * A room's name from the label that named it: the label itself when it's written out ("Master
 * bedroom", "Chambre 2"), else the type's name with the label's number ("BR2" → "Bedroom 2").
 */
export function roomNameFromLabel(text: string, type: RoomType): string {
  const cut = text.search(MEASURE_START);
  const words = (cut >= 0 ? text.slice(0, cut) : text).replace(/[\s:,–-]+$/, '').trim();
  if (/\p{L}{5,}/u.test(words)) {
    const lower = words.toLocaleLowerCase('en-CA').replace(/\s+/g, ' ');
    return lower.charAt(0).toLocaleUpperCase('en-CA') + lower.slice(1);
  }
  const number = /\d+/.exec(words)?.[0];
  return number ? `${ROOM_NAMES[type]} ${number}` : ROOM_NAMES[type];
}

/** `name`, or with a number after it if a room already has it: "Bedroom", then "Bedroom 2". */
export function uniqueRoomName(taken: Iterable<string>, name: string): string {
  const names = new Set(taken);
  if (!names.has(name)) return name;
  for (let n = 2; ; n++) if (!names.has(`${name} ${n}`)) return `${name} ${n}`;
}
