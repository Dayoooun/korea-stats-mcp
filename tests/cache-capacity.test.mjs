import assert from 'node:assert/strict';
import test from 'node:test';

const { CacheManager } = await import('../dist/cache/index.js');

const MAX_SERIALIZED_CACHE_BYTES = 32 * 1024 * 1024;

function serializedBytes(key, value) {
  return Buffer.byteLength(JSON.stringify(key), 'utf8') +
    Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function close(manager) {
  manager.cache.close();
}

test('evicts the least recently used key instead of failing at maxKeys', async () => {
  const manager = new CacheManager();
  try {
    const maxKeys = manager.cache.options.maxKeys;
    assert.ok(maxKeys > 1);

    for (let index = 0; index < maxKeys; index += 1) {
      await manager.getOrFetch('capacity', { index }, async () => ({ index }));
    }
    // A hit refreshes key 0, making key 1 the eviction candidate.
    await manager.getOrFetch('capacity', { index: 0 }, async () => {
      throw new Error('key 0 should still be cached');
    });
    await manager.getOrFetch('capacity', { index: maxKeys }, async () => ({ index: maxKeys }));

    assert.equal(manager.getStats().keys, maxKeys);
    assert.deepEqual(
      await manager.getOrFetch('capacity', { index: 0 }, async () => {
        throw new Error('key 0 should still be cached after eviction');
      }),
      { index: 0 },
    );

    let evictedFetches = 0;
    assert.deepEqual(
      await manager.getOrFetch('capacity', { index: 1 }, async () => {
        evictedFetches += 1;
        return { index: 1, refetched: true };
      }),
      { index: 1, refetched: true },
    );
    assert.equal(evictedFetches, 1);
    assert.equal(manager.getStats().keys, maxKeys);
  } finally {
    close(manager);
  }
});

test('admits entries only within the serialized byte budget and bypasses oversized values', async () => {
  const manager = new CacheManager();
  try {
    const first = 'a'.repeat(20 * 1024 * 1024);
    const second = 'b'.repeat(20 * 1024 * 1024);
    const firstKey = `bytes:id=${JSON.stringify('first')}`;

    await manager.getOrFetch('bytes', { id: 'first' }, async () => first);
    assert.equal(manager.getCachedBytes(), serializedBytes(firstKey, first));
    assert.ok(manager.getCachedBytes() <= MAX_SERIALIZED_CACHE_BYTES);

    await manager.getOrFetch('bytes', { id: 'second' }, async () => second);
    assert.ok(manager.getCachedBytes() <= MAX_SERIALIZED_CACHE_BYTES);

    let secondFetches = 0;
    assert.equal(
      await manager.getOrFetch('bytes', { id: 'second' }, async () => {
        secondFetches += 1;
        return second;
      }),
      second,
    );
    assert.equal(secondFetches, 0);

    let firstFetches = 0;
    await manager.getOrFetch('bytes', { id: 'first' }, async () => {
      firstFetches += 1;
      return first;
    });
    assert.equal(firstFetches, 1);
    manager.flush();

    const oversized = 'x'.repeat(MAX_SERIALIZED_CACHE_BYTES);
    let oversizedFetches = 0;
    await manager.getOrFetch('oversized', { id: 1 }, async () => {
      oversizedFetches += 1;
      return oversized;
    });
    assert.equal(manager.getCachedBytes(), 0);
    await manager.getOrFetch('oversized', { id: 1 }, async () => {
      oversizedFetches += 1;
      return oversized;
    });
    assert.equal(oversizedFetches, 2);
  } finally {
    close(manager);
  }
});

test('keeps byte accounting correct for replacement, expiry, and flush', async () => {
  const manager = new CacheManager();
  try {
    const key = `account:id=${JSON.stringify('entry')}`;
    const original = 'original';
    const replacement = 'replacement-value';

    await manager.getOrFetch('account', { id: 'entry' }, async () => original, 0.01);
    assert.equal(manager.getCachedBytes(), serializedBytes(key, original));

    await new Promise(resolve => setTimeout(resolve, 30));
    await manager.getOrFetch('account', { id: 'entry' }, async () => replacement, 60);
    assert.equal(manager.getCachedBytes(), serializedBytes(key, replacement));

    await manager.getOrFetch('expiry', { id: 1 }, async () => 'short-lived', 0.01);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(manager.getCachedBytes(), serializedBytes(key, replacement));

    manager.flush();
    assert.equal(manager.getCachedBytes(), 0);
    assert.equal(manager.getStats().keys, 0);
  } finally {
    close(manager);
  }
});

test('preserves cache hits and propagates fetch failures', async () => {
  const manager = new CacheManager();
  try {
    const value = { rows: [{ id: 1 }] };
    let hitFetches = 0;
    const first = await manager.getOrFetch('hit', { id: 1 }, async () => {
      hitFetches += 1;
      return value;
    });
    const second = await manager.getOrFetch('hit', { id: 1 }, async () => {
      hitFetches += 1;
      return { rows: [] };
    });
    assert.strictEqual(first, value);
    assert.strictEqual(second, value);
    assert.equal(hitFetches, 1);

    const failure = new Error('provider failed');
    await assert.rejects(
      () => manager.getOrFetch('failure', { id: 1 }, async () => {
        throw failure;
      }),
      error => error === failure,
    );
  } finally {
    close(manager);
  }
});
