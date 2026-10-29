import { FOOT, INCH, parseArea, parseDimension, SQUARE_FOOT } from '@roomie/geometry';
import type { Category, RoomType, SourceUnit, StylePreset } from '@roomie/schema';

// Lengths are meters everywhere else; this is where they meet the user's units.

export const ROOM_TYPES: Record<RoomType, string> = {
  living_room: 'Living room',
  bedroom: 'Bedroom',
  studio: 'Studio',
  dining_area: 'Dining area',
  den_office: 'Den or office',
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  hallway: 'Hallway',
  closet: 'Closet',
  laundry: 'Laundry',
  balcony: 'Balcony',
  other: 'Other',
};

/** Each category's name, as a heading or a filter. */
export const CATEGORIES: Record<Category, string> = {
  bed: 'Beds',
  sofa: 'Sofas',
  armchair: 'Armchairs',
  coffee_table: 'Coffee tables',
  dining_table: 'Dining tables',
  dining_chair: 'Dining chairs',
  desk: 'Desks',
  desk_chair: 'Desk chairs',
  shelving: 'Shelving',
  wardrobe: 'Wardrobes',
  dresser: 'Dressers',
  nightstand: 'Nightstands',
  tv_unit: 'TV units',
  rug: 'Rugs',
  floor_lamp: 'Floor lamps',
};

/** Each style, in the words a person picks it by. */
export const STYLES: Record<StylePreset, string> = {
  scandinavian: 'Light & natural',
  modern: 'Clean & modern',
  warm_minimal: 'Warm & simple',
};

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

/** A price in Canadian dollars: `$1,249.00`. */
export const formatPrice = (cadAmount: number) => cad.format(cadAmount);

export const squareMeters = (m2: number) =>
  `${m2.toFixed(1)} m² · ${Math.round(m2 / SQUARE_FOOT)} sq ft`;

/** Whether to show feet and inches: the plan's own unit, metric when it has none. */
export const isImperial = (unit: SourceUnit | undefined) => unit === 'imperial';

/** A length for display: `12′ 4″` on imperial plans, `3.60 m` otherwise. */
export function formatLength(meters: number, imperial: boolean): string {
  if (!imperial) return `${meters.toFixed(2)} m`;
  let inches = Math.round(meters / INCH);
  const feet = Math.floor(inches / 12);
  inches -= feet * 12;
  return inches === 0 ? `${feet}′` : `${feet}′ ${inches}″`;
}

/**
 * A length the user typed, in meters: `12'4"`, `12 ft`, `3.6 m`, `360 cm`. A bare number is in
 * the plan's unit: feet on imperial plans, else meters.
 */
export function parseLength(text: string, imperial: boolean): number | undefined {
  const trimmed = text.trim();
  if (/^\d+(?:[.,]\d+)?$/.test(trimmed)) {
    const value = Number(trimmed.replace(',', '.'));
    return value > 0 ? value * (imperial ? FOOT : 1) : undefined;
  }
  const readings = parseDimension(trimmed).filter((r) => r.meters.length === 1);
  return readings.length === 1 ? readings[0]!.meters[0] : undefined;
}

/** An area the user typed, in m²: `450 sq ft`, `42 m²`; a bare number is in the plan's unit. */
export function parseSquareMeters(text: string, imperial: boolean): number | undefined {
  const trimmed = text.trim();
  if (/^\d+(?:[.,]\d+)?$/.test(trimmed)) {
    const value = Number(trimmed.replace(',', '.'));
    return value > 0 ? value * (imperial ? SQUARE_FOOT : 1) : undefined;
  }
  return parseArea(trimmed)?.squareMeters;
}
