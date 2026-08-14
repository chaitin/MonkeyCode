/** 可变高度行的 Fenwick 索引：前缀和、单点测量更新、像素→行都为 O(log n)。 */
export class HeightIndex<T extends { key: string } = { key: string }> {
  readonly keys: readonly string[];
  private readonly positions = new Map<string, number>();
  private readonly values: number[];
  private readonly tree: number[];

  constructor(rows: readonly T[], heightOf: (row: T, index: number) => number) {
    this.keys = rows.map((row) => row.key);
    this.values = new Array(rows.length);
    this.tree = new Array(rows.length + 1).fill(0);
    rows.forEach((row, index) => {
      this.positions.set(row.key, index);
      const value = Math.max(1, heightOf(row, index));
      this.values[index] = value;
      this.add(index, value);
    });
  }

  get length() {
    return this.values.length;
  }

  indexOf(key: string): number {
    return this.positions.get(key) ?? -1;
  }

  heightAt(index: number): number {
    return this.values[index] ?? 0;
  }

  offsetAt(index: number): number {
    return this.prefix(Math.min(Math.max(0, index), this.length));
  }

  total(): number {
    return this.prefix(this.length);
  }

  update(index: number, nextHeight: number): number {
    if (index < 0 || index >= this.length) return 0;
    const next = Math.max(1, nextHeight);
    const delta = next - this.values[index]!;
    if (Math.abs(delta) < 0.5) return 0;
    this.values[index] = next;
    this.add(index, delta);
    return delta;
  }

  /** 包含目标像素的行；越界钳到首尾。 */
  indexAt(offset: number): number {
    if (!this.length) return -1;
    const target = Math.min(Math.max(0, offset), Math.max(0, this.total() - 0.001));
    let index = 0;
    let sum = 0;
    let bit = 1;
    while ((bit << 1) <= this.length) bit <<= 1;
    for (; bit; bit >>= 1) {
      const next = index + bit;
      if (next <= this.length && sum + this.tree[next]! <= target) {
        index = next;
        sum += this.tree[next]!;
      }
    }
    return Math.min(index, this.length - 1);
  }

  private prefix(count: number): number {
    let sum = 0;
    for (let i = count; i > 0; i -= i & -i) sum += this.tree[i]!;
    return sum;
  }

  private add(index: number, delta: number) {
    for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i] = (this.tree[i] ?? 0) + delta;
  }
}
