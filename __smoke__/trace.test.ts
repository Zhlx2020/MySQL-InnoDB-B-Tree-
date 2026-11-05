import { describe, it, expect } from 'vitest';
import { BPlusTree } from '../utils/bPlusTreeLogic';
import { TableRow } from '../types';

const rows: TableRow[] = [1, 2, 3, 4, 5, 6].map(id => ({ id, name: `n${id}`, age: 20 + id }));

/** 与 searchLeafNode() 相同的下降规则：key >= 分隔键 走右侧，首键之前走最左 */
function leafFor(tree: BPlusTree, key: number): number[] {
  let cur = tree.root;
  while (!cur.isLeaf) {
    let i = 0;
    while (i < cur.keys.length && key >= cur.keys[i]) i++;
    cur = cur.children[i];
  }
  return cur.keys;
}

/**
 * 这个用例钉住截图里那棵树的语义：root 的 [2,3,4] 是三个右侧子页的最小键，
 * 所以 4 必须落到 [4,5,6]，不能落到 [3]。
 * 画图时连线一旦从框中央扇出，这层对应关系就丢了——TreeVisualizer 现已改为从分隔键下方出发。
 */
describe('分隔键语义', () => {
  it('每个分隔键都等于其右侧子页的最小键', () => {
    const tree = BPlusTree.fromRows(rows, r => r.id, { uniqueKeys: true });
    expect(tree.root.keys).toEqual([2, 3, 4]);
    tree.root.keys.forEach((sep, i) => {
      expect(tree.root.children[i + 1].keys[0]).toBe(sep);
    });
  });

  it('查 4 走最右分支并命中，查 3 不会串到右边', () => {
    const tree = BPlusTree.fromRows(rows, r => r.id, { uniqueKeys: true });
    expect(leafFor(tree, 4)).toContain(4);
    expect(leafFor(tree, 3)).toEqual([3]);
    expect(leafFor(tree, 2)).toEqual([2]);
    expect(leafFor(tree, 1)).toEqual([1]);
    expect(leafFor(tree, 9)).toEqual([4, 5, 6]); // 大于所有分隔键 → 最右
  });
});
