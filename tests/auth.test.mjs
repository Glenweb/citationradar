import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, passwordProblem, verifyPassword } from '../src/lib/auth/password.ts';

test('a hashed password verifies and is salted per call', async () => {
  const a = await hashPassword('correct horse 7 battery');
  const b = await hashPassword('correct horse 7 battery');
  assert.notEqual(a, b, 'the same password must not produce the same hash');
  assert.equal(await verifyPassword('correct horse 7 battery', a), true);
  assert.equal(await verifyPassword('correct horse 7 battery', b), true);
});

test('a wrong password does not verify', async () => {
  const stored = await hashPassword('correct horse 7 battery');
  assert.equal(await verifyPassword('wrong horse 7 battery', stored), false);
  assert.equal(await verifyPassword('', stored), false);
});

test('the hash records its own parameters', async () => {
  const stored = await hashPassword('correct horse 7 battery');
  const [scheme, N, r, p, salt, hash] = stored.split('$');
  assert.equal(scheme, 'scrypt');
  assert.equal(N, '16384');
  assert.equal(r, '8');
  assert.equal(p, '1');
  assert.equal(salt.length, 32, '16 bytes of salt as hex');
  assert.equal(hash.length, 128, '64 bytes of key as hex');
});

test('malformed stored hashes are rejected rather than throwing', async () => {
  for (const bad of ['', 'nonsense', 'scrypt$a$b$c$d$e', 'bcrypt$16384$8$1$aa$bb', 'scrypt$16384$8$1$aa']) {
    assert.equal(await verifyPassword('anything', bad), false, `should reject: ${bad}`);
  }
});

test('unicode passwords normalise so an equivalent form still verifies', async () => {
  // U+00E9 vs e + U+0301 are the same character in NFKC.
  const stored = await hashPassword('café pass 1234');
  assert.equal(await verifyPassword('café pass 1234', stored), true);
});

test('password policy rejects weak input', () => {
  assert.ok(passwordProblem('short1'));
  assert.ok(passwordProblem('alllettersonly'), 'needs a digit');
  assert.ok(passwordProblem('1234567890'), 'needs a letter');
  assert.equal(passwordProblem('goodpassword1'), null);
});
