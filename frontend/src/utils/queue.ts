/**
 * Generic queue data structure with standard queue operations.
 */
export class Queue<T> {
  private items: T[] = []

  /**
   * Adds an item to the end of the queue.
   */
  enqueue(item: T): void {
    this.items.push(item)
  }

  /**
   * Adds multiple items to the end of the queue.
   */
  enqueueAll(items: T[]): void {
    this.items.push(...items)
  }

  /**
   * Removes and returns the item at the front of the queue.
   * Returns undefined when the queue is empty.
   */
  dequeue(): T | undefined {
    return this.items.shift()
  }

  /**
   * Returns the front item without removing it.
   */
  peek(): T | undefined {
    return this.items[0]
  }

  /**
   * Returns the last item without removing it.
   */
  peekLast(): T | undefined {
    return this.items[this.items.length - 1]
  }

  /**
   * Checks whether the queue is empty.
   */
  isEmpty(): boolean {
    return this.items.length === 0
  }

  /**
   * Returns the queue length.
   */
  size(): number {
    return this.items.length
  }

  /**
   * Clears the queue.
   */
  clear(): void {
    this.items = []
  }

  /**
   * Returns a copy of all queue items without modifying the queue.
   */
  toArray(): T[] {
    return [...this.items]
  }

  /**
   * Iterates over each item in the queue.
   */
  forEach(callback: (item: T, index: number) => void): void {
    this.items.forEach(callback)
  }

  /**
   * Finds the first item matching the predicate.
   */
  find(predicate: (item: T) => boolean): T | undefined {
    return this.items.find(predicate)
  }

  /**
   * Checks whether any item matches the predicate.
   */
  some(predicate: (item: T) => boolean): boolean {
    return this.items.some(predicate)
  }

  /**
   * Returns a new queue containing items that match the predicate.
   */
  filter(predicate: (item: T) => boolean): Queue<T> {
    const newQueue = new Queue<T>()
    newQueue.enqueueAll(this.items.filter(predicate))
    return newQueue
  }

  /**
   * Removes the first item matching the predicate.
   * @returns Whether an item was removed.
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
   * Removes all items matching the predicate.
   * @returns The number of removed items.
   */
  removeAll(predicate: (item: T) => boolean): number {
    const originalLength = this.items.length
    this.items = this.items.filter((item) => !predicate(item))
    return originalLength - this.items.length
  }
}
