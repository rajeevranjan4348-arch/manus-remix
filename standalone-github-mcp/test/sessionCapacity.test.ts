import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionCapacity } from '../src/sessionCapacity.js';

test('session capacity reservations account for concurrent initializations and release once', () => {
  const capacity = new SessionCapacity();
  const first = capacity.reserve(0, 1);
  assert.ok(first);
  assert.equal(capacity.reserve(0, 1), undefined);
  first();
  first();
  const second = capacity.reserve(0, 1);
  assert.ok(second);
  assert.equal(capacity.reserve(1, 1), undefined);
  second();
});
