import { describe, expect, it } from 'vitest';
import demo from '../../../fixtures/plans/00-demo-1br/floorplan.json';
import { Floorplan, Layout, Opening, PlanReading, Product } from './index';

describe('Product', () => {
  const sofa = {
    articleNo: '123.456.78',
    familyId: '123.456.78',
    options: [],
    name: 'KIVIK 3-seat sofa',
    category: 'sofa',
    status: 'active',
    priceCad: 999,
    url: 'https://www.ikea.com/ca/en/p/kivik-sofa-12345678/',
    imageUrl: null,
    color: 'gray',
    material: 'Fabric',
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
      floorplanId: '00000000-0000-4000-8000-000000000002',
      generationId: '00000000-0000-4000-8000-000000000003',
      inputs: { roomIds: ['r1'], budgetCad: 2000, style: 'modern', mustHaves: { r1: ['bed'] } },
      placements: [{ id: 'f1', articleNo: '123.456.78', roomId: 'r1', x: 1, y: 2, rotation: 0 }],
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

describe('PlanReading', () => {
  it('keeps the tidied draft, with no units to ask about by default', () => {
    const reading = PlanReading.parse({
      provider: 'gemini',
      model: 'gemini-test',
      promptVersion: 'plan-read.v1',
      durationMs: 1200,
      raw: { walls: [] },
      draft: {
        walls: [{ id: 'w1', a: { x: 10, y: 10 }, b: { x: 400, y: 10 }, thickness: 20 }],
        openings: [{ id: 'o1', wallId: 'w1', kind: 'window', offset: 50, width: 120 }],
        rooms: [],
        obstacles: [],
        texts: [{ id: 't1', text: 'LIVING', bbox: { x: 100, y: 100, w: 60, h: 14 } }],
      },
    });
    expect(reading.scaleCandidates).toEqual([]);
    expect(reading.draft.openings[0]).not.toHaveProperty('height');
  });
});

describe('Floorplan', () => {
  it('reads a plan saved before it had furniture as an empty home', () => {
    const older: Record<string, unknown> = { ...demo };
    delete older.furniture;
    delete older.furnishedFrom;
    expect(Floorplan.parse(older)).toMatchObject({ furniture: [], furnishedFrom: null });
  });
});
