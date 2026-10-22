import { describe, expect, it } from 'vitest';
import { Layout, Opening, Product } from './index';

describe('Product', () => {
  const sofa = {
    articleNo: '123.456.78',
    name: 'KIVIK 3-seat sofa',
    category: 'sofa',
    priceCad: 999,
    url: 'https://www.ikea.com/ca/en/p/kivik-sofa-12345678/',
    imageUrl: null,
    dims: { w: 2.28, d: 0.95, h: 0.83 },
    shape: 'rect',
    extendedW: null,
    modelUrl: null,
    modelSource: 'procedural',
    styleTags: [],
    scrapedAt: '2026-10-20T00:00:00Z',
  };

  it('parses a valid product and coerces scrapedAt', () => {
    const p = Product.parse(sofa);
    expect(p.scrapedAt).toBeInstanceOf(Date);
  });

  it('rejects malformed article numbers', () => {
    expect(Product.safeParse({ ...sofa, articleNo: '12345678' }).success).toBe(false);
  });

  it('rejects non-positive dimensions', () => {
    expect(Product.safeParse({ ...sofa, dims: { w: 0, d: 0.95, h: 0.83 } }).success).toBe(false);
  });
});

describe('Opening', () => {
  it('accepts a door with swing', () => {
    const door = {
      id: 'o1',
      wallId: 'w1',
      kind: 'door',
      offset: 0.3,
      width: 0.8,
      height: 2.0,
      swing: { hinge: 'start', side: 'left' },
    };
    expect(Opening.parse(door)).toEqual(door);
  });
});

describe('Layout', () => {
  it('rejects scores outside [0, 1]', () => {
    const layout = {
      id: '00000000-0000-4000-8000-000000000001',
      roomId: '00000000-0000-4000-8000-000000000002',
      generationId: '00000000-0000-4000-8000-000000000003',
      inputs: { roomType: 'studio', budgetCad: 2000, style: 'modern', mustHaves: ['bed'] },
      placements: [{ articleNo: '123.456.78', x: 1, y: 2, rotation: 0 }],
      score: 1.2,
      scoreBreakdown: {},
      llmIntent: null,
      promptVersion: 'intent-v1',
      status: 'candidate',
      screenshotUrls: [],
      createdAt: new Date(),
    };
    expect(Layout.safeParse(layout).success).toBe(false);
    expect(Layout.safeParse({ ...layout, score: 0.8 }).success).toBe(true);
  });
});
