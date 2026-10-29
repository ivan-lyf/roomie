import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { itemOutline, wallOutline } from '@roomie/geometry';
import type { Floorplan, Placement, Product, Vec2 } from '@roomie/schema';
import { type IntentRequest, type IntentResult, type IntentWriter, intentMessage } from './intent';

// pnpm layouts:eval's parts (PLAN.md M4): intents cached so reruns cost nothing, the furnished
// homes drawn from above for a person to judge, and the report.

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * Keeps each intent the LLM wrote, by what it was asked: the model, prompt version and the whole
 * message for a first answer; the conversation and the feedback for a repair.
 */
export class IntentCache {
  /** Answers that had to be asked for, and so were paid for, in this run. */
  readonly fresh: IntentResult[] = [];

  constructor(private readonly dir: string) {}

  firstKey(writer: Pick<IntentWriter, 'model' | 'promptVersion'>, request: IntentRequest) {
    return sha(`${writer.model}\n${writer.promptVersion}\n${intentMessage(request)}`);
  }

  async has(key: string): Promise<boolean> {
    return readFile(this.file(key)).then(
      () => true,
      () => false,
    );
  }

  private file(key: string) {
    return path.join(this.dir, `${key}.json`);
  }

  private async through(key: string, ask: () => Promise<IntentResult>): Promise<IntentResult> {
    const text = await readFile(this.file(key), 'utf8').catch(() => undefined);
    if (text) return JSON.parse(text) as IntentResult;
    const result = await ask();
    this.fresh.push(result);
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(key), JSON.stringify(result));
    return result;
  }

  /** The writer, answering from the cache where it can. */
  wrap(writer: IntentWriter): IntentWriter {
    return {
      model: writer.model,
      promptVersion: writer.promptVersion,
      write: (request, signal) =>
        this.through(this.firstKey(writer, request), () => writer.write(request, signal)),
      repair: (previous, request, feedback, signal) =>
        this.through(sha(`${JSON.stringify(previous.messages)}\n${feedback}`), () =>
          writer.repair(previous, request, feedback, signal),
        ),
    };
  }
}

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A furnished home from above, as SVG: rooms, walls, and each item with its front marked. */
export function homeSvg(
  plan: Floorplan,
  furniture: readonly Placement[],
  products: ReadonlyMap<string, Product>,
  size = 420,
): string {
  const points = [
    ...plan.walls.flatMap((w) => [w.a, w.b]),
    ...plan.rooms.flatMap((r) => r.boundary),
  ];
  const minX = Math.min(...points.map((p) => p.x)) - 0.3;
  const minY = Math.min(...points.map((p) => p.y)) - 0.3;
  const span = Math.max(
    Math.max(...points.map((p) => p.x)) - minX + 0.3,
    Math.max(...points.map((p) => p.y)) - minY + 0.3,
  );
  const k = size / span;
  const at = (p: Vec2) => `${((p.x - minX) * k).toFixed(1)},${((p.y - minY) * k).toFixed(1)}`;
  const poly = (ps: readonly Vec2[], style: string) =>
    `<polygon points="${ps.map(at).join(' ')}" ${style}/>`;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`];
  for (const r of plan.rooms) {
    parts.push(poly(r.boundary, `fill="${r.furnishable ? '#f6efe4' : '#efefed'}" stroke="#ddd"`));
  }
  for (const w of plan.walls) parts.push(poly(wallOutline(w), 'fill="#555"'));
  for (const f of furniture) {
    const p = products.get(f.articleNo);
    if (!p) continue;
    const rug = p.category === 'rug';
    parts.push(
      poly(
        itemOutline(f, p),
        `fill="${rug ? '#e3d3bb' : '#9db7d0'}" fill-opacity="${rug ? 0.7 : 0.9}" stroke="#2f4a63"`,
      ),
    );
    const front = {
      x: f.x + (Math.sin(f.rotation) * p.dims.d) / 2,
      y: f.y + (Math.cos(f.rotation) * p.dims.d) / 2,
    };
    const [x1, y1] = at(f).split(',');
    const [x2, y2] = at(front).split(',');
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#c0392b"/>`);
    parts.push(
      `<text x="${x1}" y="${y1}" font-size="8" text-anchor="middle">` +
        `${escape(p.category.replace('_', ' '))}</text>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

export type HomeResult = {
  name: string;
  rooms: number;
  items: number;
  /** Problems validateLayout finds in the winner: should always be none. */
  problems: number;
  score: number;
  repairs: number;
  /** Items left out, and why. */
  leftOut: string[];
  intentSeconds: number;
  solveSeconds: number;
  costUsd: number | undefined;
  cached: boolean;
  svg: string;
};

const pad = (s: string, n: number) => s.padEnd(n);

/** The results as a table, with totals against PLAN.md's goals. */
export function formatLayoutReport(results: readonly HomeResult[]): string {
  const columns = 'rooms  items  valid  score  repairs  left out  intent  solve  cost';
  const head = `${pad('home', 24)}${columns}`;
  const rows = results.map(
    (r) =>
      `${pad(r.name, 24)}${pad(String(r.rooms), 7)}${pad(String(r.items), 7)}` +
      `${pad(r.problems === 0 ? 'yes' : `NO (${r.problems})`, 7)}${pad(r.score.toFixed(2), 7)}` +
      `${pad(String(r.repairs), 9)}${pad(String(r.leftOut.length), 10)}` +
      `${pad(`${r.intentSeconds.toFixed(0)} s${r.cached ? '*' : ''}`, 8)}` +
      `${pad(`${r.solveSeconds.toFixed(1)} s`, 7)}` +
      `${r.costUsd === undefined ? '–' : `$${r.costUsd.toFixed(2)}`}`,
  );
  const valid = results.filter((r) => r.problems === 0).length;
  const mean = results.reduce((s, r) => s + r.score, 0) / Math.max(results.length, 1);
  const slowest = Math.max(0, ...results.map((r) => r.intentSeconds + r.solveSeconds));
  const spent = results.reduce((s, r) => s + (r.cached ? 0 : (r.costUsd ?? 0)), 0);
  return [
    head,
    ...rows,
    '',
    `Valid: ${valid}/${results.length} (goal 100%). Mean score ${mean.toFixed(2)}. ` +
      `Slowest home ${slowest.toFixed(0)} s (goal under 3 min). * = cached intent.`,
    `Spent on intents this run: $${spent.toFixed(2)}.`,
  ].join('\n');
}

/** The contact sheet: every home from above, with a yes/no for "I'd live with this". */
export function contactSheet(results: readonly HomeResult[], title: string): string {
  const cards = results
    .map(
      (r) => `<figure>
  <figcaption><b>${escape(r.name)}</b> · score ${r.score.toFixed(2)} · ${r.items} items
  ${r.leftOut.length > 0 ? `<br><small>Left out: ${r.leftOut.map(escape).join(' ')}</small>` : ''}
  <br><label><input type="checkbox" class="live"> I'd live with this</label></figcaption>
  ${r.svg}
</figure>`,
    )
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>body{font:13px system-ui,sans-serif;margin:16px}main{display:flex;flex-wrap:wrap;gap:16px}
figure{margin:0;border:1px solid #ddd;border-radius:8px;padding:8px;width:420px}</style></head>
<body><h1>${escape(title)}</h1><p id="tally"></p><main>${cards}</main>
<script>const boxes=[...document.querySelectorAll('.live')];
const t=()=>{const y=boxes.filter(b=>b.checked).length;
document.getElementById('tally').textContent=y+' of '+boxes.length+' rated "I\\'d live with this" ('
+Math.round(100*y/boxes.length)+'%, goal 60%)';};
boxes.forEach(b=>b.addEventListener('change',t));t();</script></body></html>`;
}
