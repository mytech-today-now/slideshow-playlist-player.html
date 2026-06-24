import test from 'node:test';
import assert from 'node:assert/strict';

import { SupabaseAuthError, createSupabaseAuthClient } from '../../supabase-auth.js';

function createMemoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    }
  };
}

test('bootstrap restores and refreshes expiring session', async () => {
  const now = Math.floor(Date.now() / 1000);
  const storage = createMemoryStorage({
    'blend-auth-test': JSON.stringify({
      access_token: 'old-token',
      refresh_token: 'refresh-token',
      expires_at: now + 5
    })
  });
  const fetchCalls = [];
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage,
    storageKey: 'blend-auth-test',
    fetchImpl: async (url) => {
      fetchCalls.push(String(url));
      return new Response(JSON.stringify({
        access_token: 'new-token',
        refresh_token: 'refresh-token',
        expires_in: 3600
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  try {
    const session = await client.bootstrap();
    assert.equal(session.access_token, 'new-token');
    assert.equal(fetchCalls.length, 1);
  } finally {
    client.shutdown();
  }
});

test('signInWithPassword stores session and reports authenticated state', async () => {
  const storage = createMemoryStorage();
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage,
    storageKey: 'blend-auth-test',
    fetchImpl: async () => new Response(JSON.stringify({
      access_token: 'signed-in-token',
      refresh_token: 'refresh-token',
      expires_in: 3600
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  });

  try {
    const session = await client.signInWithPassword({ email: 'demo@example.com', password: 'secret' });
    assert.equal(session.access_token, 'signed-in-token');
    assert.equal(client.isAuthenticated(), true);
    assert.ok(storage.getItem('blend-auth-test'));
  } finally {
    client.shutdown();
  }
});

test('signInWithPassword rejects missing credentials', async () => {
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage: createMemoryStorage(),
    fetchImpl: async () => new Response('{}', { status: 200 })
  });
  try {
    await assert.rejects(
      () => client.signInWithPassword({ email: '', password: '' }),
      error => error instanceof SupabaseAuthError && error.code === 'auth_invalid_credentials'
    );
  } finally {
    client.shutdown();
  }
});
