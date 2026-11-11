import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isUnsupportedImportScheme,
  resolveHttpShareUrl,
  resolvePlatformShareUrl
} from '../../share-destination-safety.js';

const APP_URL = 'https://blend.example/index.html';
const ITEM_DEEP_LINK = 'https://blend.example/index.html?experience=show&layer=playlist&item=one';

test('share page URL resolution rejects dangerous schemes and uses the generated deep link', () => {
  for (const unsafeUrl of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'blob:https://blend.example/unsafe'
  ]) {
    assert.equal(resolveHttpShareUrl(unsafeUrl, APP_URL, ITEM_DEEP_LINK), ITEM_DEEP_LINK, unsafeUrl);
  }
});

test('share page URL resolution keeps an explicit external HTTPS override by design', () => {
  assert.equal(
    resolveHttpShareUrl('https://evil.example', APP_URL, ITEM_DEEP_LINK),
    'https://evil.example/'
  );
});

test('share page URL resolution accepts HTTP(S) and resolves relative paths on the app origin', () => {
  assert.equal(resolveHttpShareUrl('http://example.com/item', APP_URL, ITEM_DEEP_LINK), 'http://example.com/item');
  assert.equal(resolveHttpShareUrl('../media/item.jpg', APP_URL, ITEM_DEEP_LINK), 'https://blend.example/media/item.jpg');
});

test('import scheme validation rejects unclassified schemes and preserves recognized references and drive paths', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'vbscript:msgbox(1)',
    'blob:https://example.com/id',
    'custom:payload',
    'https:evil.example'
  ]) {
    assert.equal(isUnsupportedImportScheme(value), true, value);
  }

  for (const value of [
    'https://example.com/media.jpg',
    'supabase://media/photos/item.jpg',
    'storage://media/photos/item.jpg',
    'ipfs://bafybeigdyr/example.jpg',
    'C:\\media\\item.jpg'
  ]) {
    assert.equal(isUnsupportedImportScheme(value), false, value);
  }
});

test('platform destinations allow HTTP(S) and reserve mailto for email', () => {
  assert.equal(
    resolvePlatformShareUrl('https://twitter.example/share?url=https%3A%2F%2Fblend.example%2F', 'twitter', APP_URL),
    'https://twitter.example/share?url=https%3A%2F%2Fblend.example%2F'
  );
  assert.equal(resolvePlatformShareUrl('mailto:?subject=Blend', 'email', APP_URL), 'mailto:?subject=Blend');
  assert.equal(resolvePlatformShareUrl('mailto:?subject=Blend', 'twitter', APP_URL), '');
  assert.equal(resolvePlatformShareUrl('javascript:alert(1)', 'email', APP_URL), '');
});
