export class Cache {
  private data = new Map<string, { value: unknown; expires: number }>();

  set(key: string, value: unknown, ttlMs: number = 10 * 60 * 1000): void {
    this.data.set(key, { value, expires: Date.now() + ttlMs });
  }

  get<T>(key: string): T | null {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.data.delete(key);
      return null;
    }
    return entry.value as T;
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }

  size(): number {
    return this.data.size;
  }
}
