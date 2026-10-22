import type { Category } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import { type FamilyMember, familyIds } from './families';

const member = (
  itemNo: string,
  variantItemNos: string[] = [],
  category: Category = 'sofa',
): FamilyMember => ({
  itemNo,
  articleNo: `${itemNo.slice(0, 3)}.${itemNo.slice(3, 6)}.${itemNo.slice(6)}`,
  category,
  variantItemNos,
});

describe('familyIds', () => {
  it('groups variants linked directly or through each other, even one way', () => {
    const ids = familyIds([
      member('30000000', ['20000000']),
      member('20000000'),
      member('10000000', ['30000000']),
    ]);
    expect(Object.fromEntries(ids)).toEqual({
      '30000000': '100.000.00',
      '20000000': '100.000.00',
      '10000000': '100.000.00',
    });
  });

  it('gives a product without links a family of its own', () => {
    expect(familyIds([member('12345678')]).get('12345678')).toBe('123.456.78');
  });

  it('ignores links to items outside the catalog', () => {
    const ids = familyIds([member('20000000', ['10000000']), member('30000000', ['10000000'])]);
    expect(ids.get('20000000')).toBe('200.000.00');
    expect(ids.get('30000000')).toBe('300.000.00');
  });

  it('never puts two categories in one family', () => {
    const ids = familyIds([member('10000000', ['20000000']), member('20000000', [], 'armchair')]);
    expect(ids.get('20000000')).toBe('200.000.00');
  });

  it('does not depend on the input order', () => {
    const members = [
      member('40000000', ['30000000']),
      member('30000000'),
      member('20000000', ['10000000']),
      member('10000000'),
    ];
    const forward = Object.fromEntries(familyIds(members));
    expect(Object.fromEntries(familyIds(members.toReversed()))).toEqual(forward);
  });
});
