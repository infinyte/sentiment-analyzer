import { Cache } from '../../services/cache';

describe('Cache', () => {
  let cache: Cache;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = new Cache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // 1.1.1 — Set and retrieve a value
  it('stores and retrieves a value', () => {
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');
  });

  // 1.1.2 — Returns null for a missing key
  it('returns null for a missing key', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  // 1.1.3 — TTL expiration: value gone after TTL elapsed
  it('returns null after TTL has elapsed', () => {
    cache.set('key', 'value', 1_000); // 1 s TTL
    jest.advanceTimersByTime(1_001);
    expect(cache.get('key')).toBeNull();
  });

  // 1.1.4 — Value still present before TTL
  it('returns the value before TTL elapses', () => {
    cache.set('key', 'value', 1_000);
    jest.advanceTimersByTime(500);
    expect(cache.get('key')).toBe('value');
  });

  // 1.1.5 — Updating an existing key replaces value and resets TTL
  it('replaces the value when the same key is set again', () => {
    cache.set('key', 'original', 5_000);
    jest.advanceTimersByTime(4_000); // 4 s in — still alive
    cache.set('key', 'updated', 5_000); // reset with new TTL
    jest.advanceTimersByTime(4_000); // 4 s into new TTL — still alive
    expect(cache.get('key')).toBe('updated');
  });

  // 1.1.6 — delete() removes the key immediately
  it('removes a key via delete()', () => {
    cache.set('key', 'value', 60_000);
    cache.delete('key');
    expect(cache.get('key')).toBeNull();
  });

  // 1.1.7 — clear() removes all entries
  it('clears all entries', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('a')).toBeNull();
  });

  // 1.1.8 — size() reflects the number of live entries
  it('reports the correct size', () => {
    expect(cache.size()).toBe(0);
    cache.set('x', 1);
    cache.set('y', 2);
    expect(cache.size()).toBe(2);
  });

  // 1.1.9 — Handles many concurrent keys without collision
  it('stores and retrieves 100 distinct keys', () => {
    for (let i = 0; i < 100; i++) {
      cache.set(`key${i}`, `value${i}`);
    }
    for (let i = 0; i < 100; i++) {
      expect(cache.get(`key${i}`)).toBe(`value${i}`);
    }
  });

  // 1.1.10 — Stores complex nested objects by reference
  it('stores and retrieves complex objects correctly', () => {
    const obj = { nested: { items: [1, 2, 3], label: 'test' } };
    cache.set('complex', obj);
    expect(cache.get('complex')).toEqual(obj);
  });
});
