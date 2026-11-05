import { describe, it, expect } from 'vitest';
import { BPlusTree } from '../utils/bPlusTreeLogic';
import { TableRow } from '../types';

// 截图里的数据（id 1..5，payload 是 name, age）
const rows: TableRow[] = [
  { id: 1, name: 'zz', age: 33 },
  { id: 2, name: 'ss', age: 32 },
  { id: 3, name: 'xs', age: 23 },
  { id: 4, name: 'ds', age: 22 },
  { id: 5, name: 'xs', age: 13 },
];

function shape(node: any, depth = 0): string[] {
  const pad = '  '.repeat(depth);
  if (node.isLeaf) return [`${pad}leaf [${node.keys.join(',')}]`];
  const out = [`${pad}internal [${node.keys.join(',')}] children=${node.children.length}`];
  for (const c of node.children) out.push(...shape(c, depth + 1));
  return out;
}

function leafFor(tree: BPlusTree, key: number): number[] {
  let cur = tree.root;
  while (!cur.isLeaf) {
    let i = 0;
    while (i < cur.keys.length && key >= cur.keys[i]) i++;
    cur = cur.children[i];
  }
  return cur.keys;
}

describe('截图二', () => {
  it('形状与分隔键一致，且每个键落在包含自己的那只子页', () => {
    const tree = BPlusTree.fromRows(rows, r => r.id, { uniqueKeys: true });
    console.log(shape(tree.root).join('\n'));
    tree.root.keys.forEach((sep, i) => {
      expect(tree.root.children[i + 1].keys[0]).toBe(sep);
      expect(tree.root.children[i].keys.every(k => k < sep)).toBe(true);
    });
    for (const k of [1, 2, 3, 4, 5]) {
      expect(leafFor(tree, k)).toContain(k);
    }
  });
});
