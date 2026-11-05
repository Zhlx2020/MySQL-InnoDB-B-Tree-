import { BPlusTreeNode, TableRow } from '../types';

// Constants for B+ Tree Order (Max children)
const ORDER = 4;
const MIN_KEYS = Math.ceil(ORDER / 2) - 1; // = 1 for ORDER=4

type KeySelector = (row: TableRow) => number;
type BPlusTreeOptions = {
  uniqueKeys?: boolean;
};

export interface SearchStep {
  nodeId: string;
  keys: number[];
  key: number;
  /** 选中的子页下标；叶子页为 null */
  nextChild: number | null;
  text: string;
}

/**
 * 分隔键的两种写法，只影响"等值怎么落"和文案，不影响树结构：
 * - innodb：分隔键 = 右侧子页的最小键，`key >= 分隔键` 走右侧
 * - textbook：分隔键 = 左侧子页的最大键，`key <= 分隔键` 走左侧
 */
export type SeparatorConvention = 'innodb' | 'textbook';

/** 子树里的最大键（一路取最右子页的最后一个键），教科书画法的分隔键用它 */
export const maxKeyOfSubtree = (node: BPlusTreeNode): number | undefined => {
  let current: BPlusTreeNode = node;
  while (!current.isLeaf && current.children.length > 0) {
    current = current.children[current.children.length - 1];
  }
  return current.keys.length > 0 ? current.keys[current.keys.length - 1] : undefined;
};

export class BPlusTree {
  root: BPlusTreeNode;
  keySelector: KeySelector;
  uniqueKeys: boolean;
  private nodeIdCounter = 0;

  constructor(keySelector: KeySelector, options: BPlusTreeOptions = {}) {
    this.uniqueKeys = options.uniqueKeys ?? true;
    this.root = this.createNode(true, null);
    this.keySelector = keySelector;
  }

  private generateId(): string {
    return `node_${this.nodeIdCounter++}`;
  }

  createNode(isLeaf: boolean, parent: BPlusTreeNode | null): BPlusTreeNode {
    return {
      keys: [],
      children: [],
      isLeaf,
      next: null,
      data: [] as TableRow[][],
      id: this.generateId(),
      parent,
    };
  }

  // Insert a row into the tree
  insert(row: TableRow) {
    const root = this.root;
    // Special case: if root is full, split it
    if (root.keys.length === ORDER - 1) {
      const newRoot = this.createNode(false, null);
      newRoot.children.push(this.root);
      this.root.parent = newRoot;
      this.splitChild(newRoot, 0, this.root);
      this.root = newRoot;
      this.insertNonFull(this.root, row);
    } else {
      this.insertNonFull(root, row);
    }
  }

  insertNonFull(node: BPlusTreeNode, row: TableRow) {
    let i = node.keys.length - 1;
    const key = this.keySelector(row);

    if (node.isLeaf) {
      // Find location to insert new key
      while (i >= 0 && key < node.keys[i]) {
        i--;
      }
      
      // Check for duplicate key
      if (i >= 0 && node.keys[i] === key) {
        if (this.uniqueKeys) {
          node.data[i] = [row];
        } else {
          node.data[i].push(row);
        }
        return;
      }

      // Insert
      node.keys.splice(i + 1, 0, key);
      node.data.splice(i + 1, 0, [row]);
    } else {
      // Internal node
      while (i >= 0 && key < node.keys[i]) {
        i--;
      }
      i++; // Child index
      node.children[i].parent = node;

      if (node.children[i].keys.length === ORDER - 1) {
        this.splitChild(node, i, node.children[i]);
        if (key > node.keys[i]) {
          i++;
        }
      }
      node.children[i].parent = node;
      this.insertNonFull(node.children[i], row);
    }
  }

  splitChild(parent: BPlusTreeNode, index: number, child: BPlusTreeNode) {
    const newNode = this.createNode(child.isLeaf, parent);
    child.parent = parent;
    
    if (child.isLeaf) {
      const splitPoint = Math.floor(child.keys.length / 2);
      
      newNode.keys = child.keys.splice(splitPoint);
      newNode.data = child.data.splice(splitPoint);
      newNode.next = child.next;
      child.next = newNode;
      
      // Promote the first key of the new leaf to parent
      parent.keys.splice(index, 0, newNode.keys[0]);
      parent.children.splice(index + 1, 0, newNode);
      
    } else {
      const splitPoint = Math.floor(child.keys.length / 2); // 1
      const midKey = child.keys[splitPoint];

      newNode.keys = child.keys.splice(splitPoint + 1);
      newNode.children = child.children.splice(splitPoint + 1);
      newNode.children.forEach(c => c.parent = newNode);
      
      // Remove mid key from child
      child.keys.splice(splitPoint, 1);

      parent.keys.splice(index, 0, midKey);
      parent.children.splice(index + 1, 0, newNode);
    }
  }

  // ==================== DELETE OPERATIONS ====================

  // Search for leaf node containing the key
  private searchLeafNode(key: number): BPlusTreeNode {
    let current = this.root;

    while (!current.isLeaf) {
      let i = 0;
      while (i < current.keys.length && key >= current.keys[i]) {
        i++;
      }
      current = current.children[i];
    }

    return current;
  }

  /**
   * 一次查找的逐步轨迹，给可视化与测试用。
   * 同一棵树、同一次下降，两种分隔键写法只是等值归属与文案不同，落点一致。
   */
  searchPath(
    key: number,
    convention: SeparatorConvention = 'innodb'
  ): { steps: SearchStep[]; found: boolean; leafId: string } {
    const steps: SearchStep[] = [];
    let current = this.root;

    while (!current.isLeaf) {
      // innodb 用右侧最小键（n 个），textbook 用左侧最大键（前 n 个子页，最后一个子页是兜底）
      const keys =
        convention === 'innodb'
          ? [...current.keys]
          : current.children
              .slice(0, -1)
              .map(child => maxKeyOfSubtree(child))
              .filter((k): k is number => k !== undefined);

      let i = 0;
      if (convention === 'innodb') {
        while (i < keys.length && key >= keys[i]) i++;
      } else {
        while (i < keys.length && key > keys[i]) i++;
      }

      let text: string;
      if (keys.length === 0) {
        text = '空内部页，无路可走';
      } else if (convention === 'innodb') {
        if (i === 0) text = `${key} < ${keys[0]}，走最左子页`;
        else if (i >= keys.length) text = `${key} ≥ ${keys[keys.length - 1]}，走最右子页`;
        else text = `${key} ≥ ${keys[i - 1]} 且 < ${keys[i]}，走中间子页`;
      } else {
        if (i === 0) text = `${key} ≤ ${keys[0]}，走最左子页`;
        else if (i >= keys.length) text = `${key} > ${keys[keys.length - 1]}，走最右子页`;
        else text = `${key} > ${keys[i - 1]} 且 ≤ ${keys[i]}，走中间子页`;
      }

      steps.push({ nodeId: current.id, keys, key, nextChild: i, text });
      current = current.children[i];
    }

    const found = current.keys.includes(key);
    steps.push({
      nodeId: current.id,
      keys: [...current.keys],
      key,
      nextChild: null,
      text: found ? `叶子页含 ${key}，命中` : `叶子页不含 ${key}，未命中`,
    });

    return { steps, found, leafId: current.id };
  }

  // Delete a row from the tree
  delete(key: number, row?: TableRow): void {
    const node = this.searchLeafNode(key);

    // Delete from leaf node
    const deleted = this.deleteFromLeaf(node, key, row);

    if (!deleted) return;

    this.refreshSeparatorsUpward(node);

    // Handle underflow
    if (node.keys.length < MIN_KEYS && node !== this.root) {
      this.handleUnderflow(node);
    }

    // Update root if empty
    if (this.root.keys.length === 0 && !this.root.isLeaf && this.root.children.length > 0) {
      this.root = this.root.children[0];
      this.root.parent = null;
    }
  }

  // Delete from leaf node
  private deleteFromLeaf(node: BPlusTreeNode, key: number, row?: TableRow): boolean {
    if (row) {
      // Find the key index that contains the specific row
      let foundIdx = -1;
      for (let i = 0; i < node.keys.length; i++) {
        if (node.keys[i] === key) {
          const rowIdx = node.data[i].findIndex(r => r.id === row.id);
          if (rowIdx !== -1) {
            foundIdx = i;
            break;
          }
        }
      }

      if (foundIdx === -1) return false;

      // Delete the specific row
      node.data[foundIdx].splice(
        node.data[foundIdx].findIndex(r => r.id === row.id),
        1
      );

      // If no data left for this key, remove entire key
      if (node.data[foundIdx].length === 0) {
        node.keys.splice(foundIdx, 1);
        node.data.splice(foundIdx, 1);
      }

      return true;
    } else {
      // Delete all keys with this value and their data
      let idx = node.keys.indexOf(key);
      if (idx === -1) return false;

      // Find all occurrences of this key and remove them
      while (idx !== -1) {
        node.keys.splice(idx, 1);
        node.data.splice(idx, 1);
        idx = node.keys.indexOf(key);
      }

      return true;
    }
  }

  private handleUnderflow(startNode: BPlusTreeNode): void {
    let node: BPlusTreeNode | null = startNode;

    while (node && node !== this.root && node.keys.length < MIN_KEYS) {
      const parent = node.parent;
      if (!parent) return;

      const childIdx = parent.children.indexOf(node);
      if (childIdx < 0) return;

      if (childIdx > 0 && parent.children[childIdx - 1].keys.length > MIN_KEYS) {
        this.borrowFromLeft(parent, childIdx);
        return;
      }

      if (childIdx < parent.children.length - 1 && parent.children[childIdx + 1].keys.length > MIN_KEYS) {
        this.borrowFromRight(parent, childIdx);
        return;
      }

      if (childIdx > 0) {
        this.mergeWithLeft(parent, childIdx);
      } else {
        this.mergeWithRight(parent, childIdx);
      }

      node = parent;
    }
  }

  // Borrow from left sibling
  private borrowFromLeft(parent: BPlusTreeNode, childIdx: number): void {
    const node = parent.children[childIdx];
    const leftSibling = parent.children[childIdx - 1];

    if (node.isLeaf) {
      // Borrow last key from left sibling
      const borrowedKey = leftSibling.keys.pop()!;
      const borrowedData = leftSibling.data.pop()!;

      // Update parent's separator key
      parent.keys[childIdx - 1] = borrowedKey;

      node.keys.unshift(borrowedKey);
      node.data.unshift(borrowedData);
    } else {
      // Borrow last key and child from left sibling
      const borrowedKey = leftSibling.keys.pop()!;
      const borrowedChild = leftSibling.children.pop()!;
      const parentKey = parent.keys[childIdx - 1];

      parent.keys[childIdx - 1] = borrowedKey;

      node.keys.unshift(parentKey);
      node.children.unshift(borrowedChild);
      borrowedChild.parent = node;
    }
  }

  // Borrow from right sibling
  private borrowFromRight(parent: BPlusTreeNode, childIdx: number): void {
    const node = parent.children[childIdx];
    const rightSibling = parent.children[childIdx + 1];

    if (node.isLeaf) {
      // Borrow first key from right sibling
      const borrowedKey = rightSibling.keys.shift()!;
      const borrowedData = rightSibling.data.shift()!;

      // Update parent's separator key to the new minimum key in right sibling
      if (rightSibling.keys.length > 0) {
        parent.keys[childIdx] = rightSibling.keys[0];
      } else {
        // Right sibling became empty - should trigger merge instead
        console.warn('Right sibling became empty after borrow, consider merging instead');
      }

      node.keys.push(borrowedKey);
      node.data.push(borrowedData);
    } else {
      // Borrow first key and child from right sibling
      const borrowedKey = rightSibling.keys.shift()!;
      const borrowedChild = rightSibling.children.shift()!;
      const parentKey = parent.keys[childIdx];

      parent.keys[childIdx] = borrowedKey;

      node.keys.push(parentKey);
      node.children.push(borrowedChild);
      borrowedChild.parent = node;
    }
  }

  // Merge with left sibling
  private mergeWithLeft(parent: BPlusTreeNode, childIdx: number): void {
    const node = parent.children[childIdx];
    const leftSibling = parent.children[childIdx - 1];
    const parentKey = parent.keys[childIdx - 1];

    if (node.isLeaf) {
      // Merge data and update linked list
      leftSibling.keys.push(...node.keys);
      leftSibling.data.push(...node.data);
      leftSibling.next = node.next;
    } else {
      // Merge keys and children
      leftSibling.keys.push(parentKey, ...node.keys);
      leftSibling.children.push(...node.children);
      node.children.forEach(child => child.parent = leftSibling);
    }

    // Remove separator key and child from parent
    parent.keys.splice(childIdx - 1, 1);
    parent.children.splice(childIdx, 1);
  }

  // Merge with right sibling
  private mergeWithRight(parent: BPlusTreeNode, childIdx: number): void {
    const node = parent.children[childIdx];
    const rightSibling = parent.children[childIdx + 1];
    const parentKey = parent.keys[childIdx];

    if (node.isLeaf) {
      // Merge data and update linked list
      node.keys.push(...rightSibling.keys);
      node.data.push(...rightSibling.data);
      node.next = rightSibling.next;
    } else {
      // Merge keys and children
      node.keys.push(parentKey, ...rightSibling.keys);
      node.children.push(...rightSibling.children);
      rightSibling.children.forEach(child => child.parent = node);
    }

    // Remove separator key and child from parent
    parent.keys.splice(childIdx, 1);
    parent.children.splice(childIdx + 1, 1);
  }

  private getSubtreeMinKey(node: BPlusTreeNode): number | undefined {
    let current: BPlusTreeNode = node;
    while (!current.isLeaf) {
      current = current.children[0];
    }
    return current.keys[0];
  }

  private refreshSeparatorsUpward(startNode: BPlusTreeNode): void {
    let node: BPlusTreeNode | null = startNode;

    while (node && node.parent) {
      const parent = node.parent;
      const idx = parent.children.indexOf(node);
      if (idx < 0) return;

      if (idx > 0) {
        const minKey = this.getSubtreeMinKey(node);
        if (typeof minKey === 'number') {
          parent.keys[idx - 1] = minKey;
        }
      }

      node = parent;
    }
  }

  // Helper to reconstruct tree from rows
  static fromRows(rows: TableRow[], keySelector: KeySelector = (r) => r.id, options: BPlusTreeOptions = {}): BPlusTree {
    const tree = new BPlusTree(keySelector, options);
    // Insert rows in original order to show real B+ tree splitting behavior
    const rowsToInsert = [...rows];
    for (const row of rowsToInsert) {
      tree.insert(row);
    }
    return tree;
  }
}
