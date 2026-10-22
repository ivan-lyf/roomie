// Prepares a plan image for the reader's eval the way the upload page does
// (apps/web/src/upload.ts): on white, at most 3,000 px on its longer side. Prints how much it was scaled, to convert a
// known scale to the prepared image's pixels.
//
// Usage: pnpm --filter @roomie/models plan:prepare <image> <plan folder>

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const MAX_SIDE = 3000;

const [source, folder] = process.argv.slice(2);
if (!source || !folder) throw new Error('Usage: plan:prepare <image> <plan folder>');
// Relative to where pnpm was run, not to this package.
const cwd = process.env['INIT_CWD'] ?? process.cwd();
const dir = path.resolve(cwd, folder);
await mkdir(dir, { recursive: true });
const image = sharp(path.resolve(cwd, source));
const { width, height } = await image.metadata();
if (!width || !height) throw new Error(`${source} has no size`);
const factor = Math.min(1, MAX_SIDE / Math.max(width, height));
const size = { width: Math.round(width * factor), height: Math.round(height * factor) };
await image
  .resize(size.width, size.height)
  .flatten({ background: '#fff' })
  .png()
  .toFile(path.join(dir, 'plan.png'));
const plan = `${size.width}x${size.height}`;
console.log(JSON.stringify({ source: `${width}x${height}`, plan, factor }));
