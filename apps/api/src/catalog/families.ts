import type { Category } from '@roomie/schema';

export type FamilyMember = {
  itemNo: string;
  articleNo: string;
  category: Category;
  /** Other variants IKEA's pickers link to. Links to non-members are ignored. */
  variantItemNos: string[];
};

/**
 * Groups variants into families: products that IKEA's color, size and option pickers link,
 * directly or through other variants, within one category. Returns each member's family id,
 * the lowest article number in its family.
 */
export function familyIds(members: readonly FamilyMember[]): Map<string, string> {
  const index = new Map(members.map((m, i) => [m.itemNo, i]));
  const parent = members.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      // Path halving keeps the trees shallow.
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };

  members.forEach((member, i) => {
    for (const other of member.variantItemNos) {
      const j = index.get(other);
      if (j !== undefined && members[j]!.category === member.category) parent[find(i)] = find(j);
    }
  });

  const lowest = new Map<number, string>();
  members.forEach((member, i) => {
    const root = find(i);
    const current = lowest.get(root);
    if (current === undefined || member.articleNo < current) lowest.set(root, member.articleNo);
  });
  return new Map(members.map((member, i) => [member.itemNo, lowest.get(find(i))!]));
}
