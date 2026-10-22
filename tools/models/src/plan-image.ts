// Draws a floorplan as a plain architectural plan image: thick walls, windows, door swings,
// fixtures and the plan's own text, at its scale. The demo plan's image is drawn with it, so the
// public repo never needs a plan image someone else owns.
//
// Usage: tsx src/plan-image.ts fixtures/plans/00-demo-1br

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { doorSwing, pointAlong, wallLength } from '@roomie/geometry';
import { Floorplan, type Vec2 } from '@roomie/schema';
import sharp from 'sharp';

const INK = '#1f1f1f';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The plan as SVG, in image pixels: plan meters divided by its scale. */
export function planSvg(plan: Floorplan, size: { width: number; height: number }): string {
  const mpp = plan.scale?.metersPerPixel;
  if (!mpp) throw new Error('The plan needs a scale to be drawn.');
  const px = (p: Vec2) => `${(p.x / mpp).toFixed(1)},${(p.y / mpp).toFixed(1)}`;
  const out: string[] = [];
  const line = (a: Vec2, b: Vec2, width: number, color = INK, extra = '') =>
    out.push(
      `<line x1="${px(a).split(',')[0]}" y1="${px(a).split(',')[1]}" ` +
        `x2="${px(b).split(',')[0]}" y2="${px(b).split(',')[1]}" stroke="${color}" ` +
        `stroke-width="${(width / mpp).toFixed(1)}" ${extra}/>`,
    );

  for (const o of plan.obstacles) {
    out.push(
      `<polygon points="${o.polygon.map(px).join(' ')}" fill="none" stroke="${INK}" ` +
        `stroke-width="1.5"/>`,
    );
  }

  for (const wall of plan.walls) {
    const length = wallLength(wall);
    const openings = plan.openings
      .filter((o) => o.wallId === wall.id)
      .sort((a, b) => a.offset - b.offset);
    // Solid wall between openings, squared off past the ends so corners close.
    let cursor = -wall.thickness / 2;
    for (const o of openings) {
      if (o.offset > cursor)
        line(pointAlong(wall, cursor), pointAlong(wall, o.offset), wall.thickness);
      cursor = o.offset + o.width;
    }
    const end = length + wall.thickness / 2;
    if (end > cursor) line(pointAlong(wall, cursor), pointAlong(wall, end), wall.thickness);

    for (const o of openings) {
      const a = pointAlong(wall, o.offset);
      const b = pointAlong(wall, o.offset + o.width);
      if (o.kind === 'window') {
        // A thin frame across the wall's full thickness, with the glass down the middle.
        line(a, b, wall.thickness, INK);
        line(a, b, wall.thickness - 2 * mpp * 2, '#fff');
        line(a, b, 1.5 * mpp, INK);
      }
      const swing = doorSwing(wall, o);
      if (swing) {
        const { hinge, closed, open, radius } = swing;
        const leaf = { x: hinge.x + open.x * radius, y: hinge.y + open.y * radius };
        const shut = { x: hinge.x + closed.x * radius, y: hinge.y + closed.y * radius };
        const cross = closed.x * open.y - closed.y * open.x;
        line(hinge, leaf, 2 * mpp);
        const r = (radius / mpp).toFixed(1);
        out.push(
          `<path d="M ${px(shut)} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${px(leaf)}" ` +
            `fill="none" stroke="${INK}" stroke-width="1"/>`,
        );
      }
    }
  }

  for (const label of plan.labels) {
    const { x, y, w, h } = label.bbox;
    const bold = label.kind === 'room_label' ? ' font-weight="bold"' : '';
    out.push(
      `<text x="${(x + w / 2).toFixed(1)}" y="${(y + h * 0.78).toFixed(1)}" ` +
        `font-family="DejaVu Sans, Arial, sans-serif" font-size="${(h * 0.8).toFixed(1)}" ` +
        `text-anchor="middle" fill="${INK}"${bold}>${escape(label.text)}</text>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">` +
    `<rect width="100%" height="100%" fill="#fff"/>${out.join('')}</svg>`
  );
}

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: tsx src/plan-image.ts <plan folder>');
  const plan = Floorplan.parse(
    JSON.parse(await readFile(path.join(dir, 'floorplan.json'), 'utf8')),
  );
  const mpp = plan.scale!.metersPerPixel;
  const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = plan.walls.flatMap((w) => [w.a.y, w.b.y]);
  const size = {
    width: Math.round((Math.max(...xs) + Math.min(...xs)) / mpp),
    height: Math.round((Math.max(...ys) + Math.min(...ys)) / mpp),
  };
  const out = path.join(dir, 'plan.png');
  await sharp(Buffer.from(planSvg(plan, size)))
    .png()
    .toFile(out);
  console.log(`${out}: ${size.width} x ${size.height}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
