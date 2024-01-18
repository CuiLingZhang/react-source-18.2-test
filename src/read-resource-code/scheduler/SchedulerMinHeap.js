/**
 * 向最小堆（二叉树(1个或2个子节点)->完全树(从左往右，从上往下)->最小堆(父节点数值比直系子节点数值小)）数组中推入一个元素
 * 这个元素的值可能比父元素小，所以需要使用 siftUp 向上调整
 * @param heap
 * @param node
 */
export function push(heap, node) {
  const index = heap.length;
  heap.push(node);
  siftUp(heap, node, index);
}

/**
 * 向上调整
 * 和父节点比较，如果比父节点小，则跟父节点交换，交换后继续向上比较
 * @param heap
 * @param node
 * @param i 初始值为 heap 的原长度（push 之前的长度）
 */
function siftUp(heap, node, i) {
  let index = i;
  while (index > 0) {
    // push 后存在至少两个元素才需要调整
    // 取父节点下标： Math.floor((index - 1) / 2)
    // >>> 1 相当于十进制的 /2^1 向下取整
    const parentIndex = (index - 1) >>> 1;
    const parent = heap[parentIndex];
    // 比较父节点数字和当前节点（push进来的最后一个节点）数值
    // 如果当前节点数值比父节点小，则跟父节点交换位置，否则结束循环，已经是排序正确的最小堆
    if (compare(parent, node) > 0) {
      // The parent is larger. Swap positions.
      heap[parentIndex] = node;
      heap[index] = parent;
      // 继续向上比
      index = parentIndex;
    } else {
      // The parent is smaller. Exit.
      return;
    }
  }
}

/**
 * sortIndex 不相等时返回 sortIndex 的差值，相等时返回 id 的差值
 * 从调用的位置看，sortIndex 是任务应该开始执行的时间，如果两个任务开始执行时间相同，则比较 id 哪个更小
 * @param a
 * @param b
 * @returns {number}
 */
function compare(a, b) {
  // Compare sort index first, then task id.
  const diff = a.sortIndex - b.sortIndex;
  return diff !== 0 ? diff : a.id - b.id;
}

/**
 * 从最小堆取出第一个任务
 * @param heap
 * @returns {null|*}
 */
export function peek(heap) {
  return heap.length === 0 ? null : heap[0];
}

/**
 * 从最小堆中弹出第一个任务
 * 这里要考虑弹出后最小堆的完整性（弹出第一个任务时该哪个任务补上）
 * @param heap
 * @returns {*|null}
 */
export function pop(heap) {
  // 堆中没有任务则直接返回
  if (heap.length === 0) {
    return null;
  }
  const first = heap[0];
  // 数组的pop()会删除数组的最后一个元素，并返回这个删除的元素
  const last = heap.pop();
  // 如果堆中不止一个任务则需要对堆进行调整
  if (last !== first) {
    // 将最后一个元素放到第一个的位置来，然后向下调整
    heap[0] = last;
    siftDown(heap, last, 0);
  }
  return first;
}

/**
 * 向下调整
 * 从左到右，先比较左分支子节点，如果比子节点大则交换，交换后继续向下比
 * @param heap
 * @param node
 * @param i
 */
function siftDown(heap, node, i) {
  let index = i;
  const length = heap.length;
  const halfLength = length >>> 1;
  // TODO 为什么只比较到一半？以二叉树的结构来说 length >>> 1 应该是都在倒数第二层
  while (index < halfLength) {
    // 获取当前节点的左子节点
    const leftIndex = (index + 1) * 2 - 1;
    const left = heap[leftIndex];
    // 右子节点
    const rightIndex = leftIndex + 1;
    const right = heap[rightIndex];

    // If the left or right node is smaller, swap with the smaller of those.
    if (compare(left, node) < 0) {
      // 左子节点比当前节点小
      if (rightIndex < length && compare(right, left) < 0) {
        // 存在右子节点并且右子节点比左子节点小，那就直接跟右子节点交换
        heap[index] = right;
        heap[rightIndex] = node;
        // 继续向下比
        index = rightIndex;
      } else {
        // 跟左子节点交换
        heap[index] = left;
        heap[leftIndex] = node;
        // 继续向下比
        index = leftIndex;
      }
    } else if (rightIndex < length && compare(right, node) < 0) {
      // 存在右子节点并且右子节点比当前节点小
      // 跟右子节点交换
      heap[index] = right;
      heap[rightIndex] = node;
      // 继续向下比
      index = rightIndex;
    } else {
      // Neither child is smaller. Exit.
      // 当前节点比左子节点和右子节点都小，排序正确，不用继续调整
      return;
    }
  }
}
