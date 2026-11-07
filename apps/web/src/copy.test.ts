import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANNED_WORDS, homeStatus, mustHavesFor, planProblemText, refusalText } from './copy';

// No internal words on the screens people use (docs/frontend-design.md §11).

const SRC = join(import.meta.dirname);

/** Internal pages, which stay plain and may say what they like. */
const INTERNAL = [
  'pages/CatalogPage.tsx',
  'pages/RatePage.tsx',
  'ui/CatalogPanel.tsx',
  'ui/NoteLabels.tsx',
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

/** JSX text, and string literals that read as words for people rather than keys or classes. */
function shownStrings(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/^import .*$/gm, '');
  let bare = code;
  // Template holes, nested strings and all.
  for (let prev = ''; prev !== bare; ) [prev, bare] = [bare, bare.replace(/\$\{[^{}]*\}/g, ' ')];
  const strings: string[] = [];
  // Text between tags, not after an arrow function's `=>`.
  for (const m of bare.matchAll(/(?<!=)>([^<>{}]*[A-Za-z][^<>{}]*)</g)) strings.push(m[1]!.trim());
  for (const m of bare.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    const s = m[2]!;
    const sentence = /[A-Z]/.test(s) || (/\s/.test(s) && !/\b[a-z0-9]+[-:][a-z0-9[\]/.%-]+/.test(s));
    if (sentence) strings.push(s);
  }
  return strings;
}

const banned = new RegExp(BANNED_WORDS.join('|'), 'i');

describe('user-facing words', () => {
  const shown = [join(SRC, 'copy.ts'), ...files(join(SRC, 'pages')), ...files(join(SRC, 'ui'))]
    .filter((path) => !INTERNAL.includes(relative(SRC, path)));

  it.each(shown.map((path) => [relative(SRC, path), path]))('%s says nothing internal', (_, path) => {
    const source = readFileSync(path, 'utf8');
    const words = shownStrings(source).filter((s) => banned.test(s));
    // BANNED_WORDS itself lists them, as data.
    const listed = path.endsWith('copy.ts') ? BANNED_WORDS : [];
    expect(words.filter((w) => !listed.includes(w))).toEqual([]);
  });

  it('finds words for people, not classes or keys', () => {
    const found = shownStrings(
      `<p className="scale-95 flex">Check the scale</p>; const k = 'no_scale'; t('Calibrate it');`,
    );
    expect(found).toContain('Check the scale');
    expect(found).toContain('Calibrate it');
    expect(found).not.toContain('scale-95 flex');
    expect(found).not.toContain('no_scale');
  });
});

describe('copy', () => {
  it('names a home by what it needs next', () => {
    expect(homeStatus('needs_calibration', 0)).toBe('Needs a quick check');
    expect(homeStatus('ready', 0)).toBe('Ready to furnish');
    expect(homeStatus('ready', 4)).toBe('Furnished');
    expect(homeStatus('uploaded', 0)).toBe('Not read yet');
  });

  it('offers only must-haves that suit the room', () => {
    const bedroom = mustHavesFor('bedroom').map((m) => m.label);
    expect(bedroom).toContain('A wardrobe');
    expect(bedroom).toContain('A desk for working from home');
    expect(bedroom).not.toContain('A sofa');
    expect(mustHavesFor('kitchen')).toEqual([]);
  });

  it('says plan problems in plain words', () => {
    const names = new Map([
      ['r1', 'Bedroom'],
      ['r2', 'Den'],
    ]);
    const text = planProblemText({ code: 'rooms_overlap', message: '', ids: ['r1', 'r2'] }, names);
    expect(text).toBe('Bedroom and Den overlap. Is one of them drawn too big?');
    expect(planProblemText({ code: 'no_scale', message: '', ids: [] }, names)).not.toMatch(banned);
  });

  it('never shows money for the daily limit', () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(refusalText('allowance_reached', tomorrow)).toMatch(/tomorrow/);
    expect(refusalText('allowance_reached', tomorrow)).not.toMatch(/\$/);
  });
});
