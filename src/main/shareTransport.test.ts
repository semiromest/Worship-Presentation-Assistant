import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newToken, queryToken, tokenMatches } from './shareTransport';

test('broadcast tokens are independent and reject missing, wrong or stale credentials', () => {
  const first = newToken(),
    second = newToken();
  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(tokenMatches(first, first), true);
  for (const provided of [null, undefined, '', first + 'x', second]) assert.equal(tokenMatches(first, provided), false);
  assert.equal(tokenMatches(null, first), false);
});

test('token extraction accepts relative URLs and fails closed on malformed ones', () => {
  assert.equal(queryToken('/share?token=a%2Bb'), 'a+b');
  assert.equal(queryToken('/screen?token=screen'), 'screen');
  assert.equal(queryToken('/share'), null);
  assert.equal(queryToken(undefined), null);
  assert.equal(queryToken('http://['), null);
});
