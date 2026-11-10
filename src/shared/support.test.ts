import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportAvailability, supportUrl, type SupportConfig } from './support';
const config = (): SupportConfig => ({
  github: { url: 'https://github.com/sponsors/semiromest', enabled: true },
  kreosus: { url: 'https://kreosus.com/example-profile?hl=tr', enabled: true },
});
test('unpublished profiles are unavailable and never open a fallback payment page', () => {
  const pending = config(); pending.github.enabled = false; pending.kreosus.url = null;
  assert.deepEqual(supportAvailability(pending), { kreosus: false, github: false });
  assert.equal(supportUrl('github', pending), null); assert.equal(supportUrl('kreosus', pending), null);
});
test('only explicit HTTPS support profiles can be opened', () => {
  assert.equal(supportUrl('github', config()), 'https://github.com/sponsors/semiromest');
  assert.equal(supportUrl('kreosus', config()), 'https://kreosus.com/example-profile?hl=tr');
  for (const platform of ['https://example.com', '__proto__', null, {}, 'paypal']) assert.equal(supportUrl(platform, config()), null);
  for (const value of ['http://github.com/sponsors/semiromest', 'https://github.com.evil.test/sponsors/semiromest', 'https://github.com/login', 'file:///tmp/pay', 'https://user:password@github.com/sponsors/semiromest', 'https://github.com/sponsors/semiromest?redirect=https://example.com']) {
    const changed = config(); changed.github.url = value; assert.equal(supportUrl('github', changed), null);
  }
  const changed = config(); changed.kreosus.url = 'https://kreosus.com/'; assert.equal(supportUrl('kreosus', changed), null);
});
