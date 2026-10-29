import type { Product, StylePreset } from '@roomie/schema';

/**
 * What each style likes, in IKEA's own colour and material words (the catalog has no style tags
 * yet). One table, to tune by eye and later from ratings.
 */
export const STYLE_PALETTES: Record<StylePreset, { colors: string[]; materials: string[] }> = {
  scandinavian: {
    colors: ['white', 'beige', 'gray'],
    materials: [
      'Solid wood',
      'Wood veneer',
      'Wood (including board)',
      'Wool',
      'Cotton',
      'Fabric',
      'Natural fibers',
      'Bamboo',
    ],
  },
  modern: {
    colors: ['black', 'gray', 'white'],
    materials: ['Metal', 'Glass', 'Leather', 'Coated fabric', 'Melamine foil', 'Marble', 'Plastic'],
  },
  warm_minimal: {
    colors: ['brown', 'beige'],
    materials: [
      'Solid wood',
      'Wood veneer',
      'Rattan',
      'Natural fibers',
      'Wool',
      'Leather',
      'Bamboo',
      'Paper cord',
    ],
  },
};

/** IKEA's comma-separated words: "beige, brown" -> ["beige", "brown"]. */
export const words = (text: string | null): string[] =>
  (text ?? '')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);

/**
 * How well a product suits a style, in [0, 1]: the share of its colours, and of its materials,
 * the style likes, averaged; a half where IKEA lists neither.
 */
export function styleMatch(
  product: Pick<Product, 'color' | 'material'>,
  style: StylePreset,
): number {
  const palette = STYLE_PALETTES[style];
  const shares = [
    [words(product.color), palette.colors],
    [words(product.material), palette.materials],
  ]
    .filter(([have]) => have!.length > 0)
    .map(([have, like]) => have!.filter((w) => like!.includes(w)).length / have!.length);
  return shares.length === 0 ? 0.5 : shares.reduce((a, b) => a + b, 0) / shares.length;
}
