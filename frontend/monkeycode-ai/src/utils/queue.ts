/**
 * 通用队列数据结构
 * 支持泛型，提供标准队列操作
 */
export class Queue<T> {
  private items: T[] = []

  /**
   * 入队：将元素添加到队列末尾
   */
  enqueue(item: T): void {
    this.items.push(item)
  }

  /**
   * 批量入队：将多个元素添加到队列末尾
   */
  enqueueAll(items: T[]): void {
    this.items.push(...items)
  }

  /**
   * 出队：移除并返回队列头部元素
   * 如果队列为空，返回 undefined
   */
  dequeue(): T | undefined {
    return this.items.shift()
  }

  /**
   * 查看队首元素但不移除
   */
  peek(): T | undefined {
    return this.items[0]
  }

  /**
   * 查看队尾元素但不移除
   */
  peekLast(): T | undefined {
    return this.items[this.items.length - 1]
  }

  /**
   * 检查队列是否为空
   */
  isEmpty(): boolean {
    return this.items.length === 0
  }

  /**
   * 获取队列长度
   */
  size(): number {
    return this.items.length
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.items = []
  }

  /**
   * 获取队列所有元素的副本（不修改原队列）
   */
  toArray(): T[] {
    return [...this.items]
  }

  /**
   * 遍历队列中的每个元素
   */
  forEach(callback: (item: T, index: number) => void): void {
    this.items.forEach(callback)
  }

  /**
   * 查找满足条件的第一个元素
   */
  find(predicate: (item: T) => boolean): T | undefined {
    return this.items.find(predicate)
  }

  /**
   * 检查队列中是否包含满足条件的元素
   */
  some(predicate: (item: T) => boolean): boolean {
    return this.items.some(predicate)
  }

  /**
   * 过滤队列，返回满足条件的元素组成的新队列
   */
  filter(predicate: (item: T) => boolean): Queue<T> {
    const newQueue = new Queue<T>()
    newQueue.enqueueAll(this.items.filter(predicate))
    return newQueue
  }

  /**
   * 移除满足条件的第一个元素
   * @returns 是否成功移除
   */
  remove(predicate: (item: T) => boolean): boolean {
    const index = this.items.findIndex(predicate)
    if (index !== -1) {
      this.items.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * 移除所有满足条件的元素
   * @returns 移除的元素数量
   */
  removeAll(predicate: (item: T) => boolean): number {
    const originalLength = this.items.length
    this.items = this.items.filter((item) => !predicate(item))
    return originalLength - this.items.length
  }
}
