const test = require('node:test');
const assert = require('node:assert');
const { canTransition } = require('../src/workflow');

test('valid transitions allowed', () => {
  assert.ok(canTransition('Submitted', 'Under Review'));
  assert.ok(canTransition('Inspection Pending', 'Inspection Completed'));
});

test('invalid transitions blocked', () => {
  assert.ok(!canTransition('Submitted', 'Closed'));
  assert.ok(!canTransition('Closed', 'Submitted'));
});
