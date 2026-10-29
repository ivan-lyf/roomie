import { describe, expect, it } from 'vitest';
import { unseen } from './products';

describe('unseen', () => {
  it('asks once for each product not known, missing, or already asked for', () => {
    const state = {
      byArticle: new Map([['111.111.11', {} as never]]),
      missing: new Set(['222.222.22']),
    };
    const asked = new Set(['333.333.33']);
    const articleNos = ['111.111.11', '444.444.44', '222.222.22', '444.444.44', '333.333.33'];
    expect(unseen(articleNos, state, asked)).toEqual(['444.444.44']);
  });
});
