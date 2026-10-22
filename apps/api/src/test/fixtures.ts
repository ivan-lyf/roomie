import { doorSwing, pointAlong } from '@roomie/geometry';
import { Floorplan, type Product, type RawPlan, type Vec2 } from '@roomie/schema';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';

/** A valid catalog product, with any fields overridden. */
export const product = (articleNo: string, extra: Partial<Product> = {}): Product => ({
  articleNo,
  familyId: articleNo,
  options: [],
  name: `TESTA ${articleNo}`,
  category: 'sofa',
  status: 'active',
  priceCad: 499,
  url: `https://www.ikea.com/ca/en/p/testa-${articleNo.replaceAll('.', '')}/`,
  imageUrl: null,
  color: null,
  material: null,
  dims: { w: 2, d: 0.9, h: 0.8 },
  shape: 'rect',
  extendedW: null,
  modelUrl: `/api/models/${articleNo.replaceAll('.', '')}.glb`,
  modelSource: 'ikea',
  styleTags: [],
  scrapedAt: new Date('2026-10-21T00:00:00.000Z'),
  ...extra,
});

/** A minimal PNG header: signature, then the IHDR chunk with the size. */
export function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** The demo plan, its image 900 x 750 px at 1 px = 1 cm. */
export const demoPlan = Floorplan.parse(demo);

/** The demo plan as a reader would return it off its image: exactly, in pixels. */
export function demoRawPlan(): RawPlan {
  const mpp = demoPlan.scale!.metersPerPixel;
  const px = (p: Vec2) => ({ x: p.x / mpp, y: p.y / mpp });
  return {
    walls: demoPlan.walls.map((w) => ({ a: px(w.a), b: px(w.b), thickness: w.thickness / mpp })),
    openings: demoPlan.openings.map((o) => {
      const wall = demoPlan.walls.find((w) => w.id === o.wallId)!;
      const swing = doorSwing(wall, o);
      return {
        kind: o.kind,
        a: px(pointAlong(wall, o.offset)),
        b: px(pointAlong(wall, o.offset + o.width)),
        ...(swing && {
          swing: {
            hinge: px(swing.hinge),
            toward: px({
              x: swing.hinge.x + swing.open.x * swing.radius,
              y: swing.hinge.y + swing.open.y * swing.radius,
            }),
          },
        }),
      };
    }),
    rooms: demoPlan.rooms.map((r) => ({ polygon: r.boundary.map(px), label: r.name })),
    obstacles: demoPlan.obstacles.map((o) => ({ kind: o.kind, polygon: o.polygon.map(px) })),
    texts: demoPlan.labels.map((l) => ({ text: l.text, bbox: l.bbox })),
  };
}
