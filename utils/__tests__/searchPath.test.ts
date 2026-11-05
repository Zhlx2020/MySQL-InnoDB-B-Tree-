import { describe, it, expect } from 'vitest';
import { BPlusTree } from '../bPlusTreeLogic';
import { TableRow } from '../../types';

const rows: TableRow[] = [1, 2, 3, 4, 5].map(id => ({ id, name: `n${id}`, age: 20 + id }));
const tree = () => BPlusTree.fromRows(rows, r => r.id, { uniqueKeys: true });

describe('searchPath 轨迹', () => {
  it('命中时给出每一步比较与序号，最后一步标命中', () => {
    const t = tree();
    const trace = t.searchPath(4);
    expect(trace.found).toBe(true);
    expect(trace.steps.length).toBe(2);
    expect(trace.steps[0].nextChild).toBe(2); // 4 ≥ 2、4 ≥ 3 → 最右（共 3 个子页）
    expect(trace.steps[0].text).toContain('最右');
    expect(trace.steps[1].text).toContain('命中');
    expect(trace.steps[1].nextChild).toBeNull();
  });

  it('未命中时也走完全程并标未命中', () => {
    const t = tree();
    const trace = t.searchPath(99);
    expect(trace.found).toBe(false);
    expect(trace.steps[trace.steps.length - 1].text).toContain('未命中');
  });

  it('小键走最左', () => {
    const t = tree();
    const trace = t.searchPath(1);
    expect(trace.steps[0].nextChild).toBe(0);
    expect(trace.steps[0].text).toContain('最左');
  });

  it('中间键的文案给出区间', () => {
    const t = BPlusTree.fromRows(
      [{ id: 1, name: 'a', age: 1 }, { id: 3, name: 'b', age: 3 }, { id: 5, name: 'c', age: 5 },
       { id: 7, name: 'd', age: 7 }, { id: 9, name: 'e', age: 9 }],
      r => r.id,
      { uniqueKeys: true }
    );
    // 这批数据插完，根是 [3,5]（三个子页），4 落在 3 与 5 之间 → 中间子页
    expect(t.root.keys).toEqual([3, 5]);
    const trace = t.searchPath(4);
    expect(trace.steps[0].nextChild).toBe(1);
    expect(trace.steps[0].text).toContain('中间');
  });

  it('两种画法对每个已存在的键都落到同一片叶子', () => {
    const t = BPlusTree.fromRows(
      [{ id: 1, name: 'a', age: 1 }, { id: 3, name: 'b', age: 3 }, { id: 5, name: 'c', age: 5 },
       { id: 7, name: 'd', age: 7 }, { id: 9, name: 'e', age: 9 }],
      r => r.id,
      { uniqueKeys: true }
    );
    // 存在的键：两种写法必须同页
    for (const k of [1, 3, 5, 7, 9]) {
      expect(t.searchPath(k, 'textbook').leafId).toBe(t.searchPath(k, 'innodb').leafId);
    }
    // 落在页间空隙的键（2、4 等）两边都是未命中，只是停的页不同——这就是"等值归属"的差别
    for (const k of [2, 4, 6]) {
      expect(t.searchPath(k, 'textbook').found).toBe(false);
      expect(t.searchPath(k, 'innodb').found).toBe(false);
    }
  });

  it('教科书写法把等值判给左侧，比较符号随之翻转', () => {
    const t = BPlusTree.fromRows(rows, r => r.id, { uniqueKeys: true });
    const trace = t.searchPath(4, 'textbook');
    expect(trace.steps[0].text).toContain('>');
    expect(trace.found).toBe(true);
  });
});
