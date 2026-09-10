'use strict';

/*
 * Every gate the smoke harness knows must be one the workflow sets.
 *
 * This is #117 a second time, and the reason it needed a second guard is worth keeping.
 *
 * #118 added `suite.test.js`, which proves every `*.test.js` file is claimed by an npm script. It
 * reasons about *files*. The smoke harness is one file, claimed by one command, and its sections are
 * gated on environment variables set in a workflow -- so there is no unclaimed file for that guard to
 * find, and 52 of 95 assertions ran nowhere for four phases of work without anything going red.
 *
 * The rule here is deliberately about the harness rather than a list: a gate added to `main.js` and
 * not to `desktop.yml` fails, so the next feature cannot repeat this quietly. Nobody has to remember.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MAIN = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const WORKFLOW = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'desktop.yml'),
  'utf8',
);

/*
 * `FTREE_SMOKE` itself is the file to open, not a gate, and every step that runs the harness sets it
 * by definition or the harness refuses to start.
 *
 * `FTREE_SMOKE_SHOT*` are excluded by name and not by accident: they write a PNG for a person to look
 * at and assert nothing. Requiring CI to set them would mean uploading screenshots no test reads.
 */
const NOT_A_GATE = (name) => name === 'FTREE_SMOKE' || name.startsWith('FTREE_SMOKE_SHOT');

function gatesInHarness() {
  const found = new Set();
  for (const [, name] of MAIN.matchAll(/process\.env\.(FTREE_SMOKE[A-Z_]*)/g)) {
    if (!NOT_A_GATE(name)) found.add(name);
  }
  return [...found].sort();
}

/*
 * Each `- name:` block is one step. A step that mentions any gate is a step that runs the harness,
 * and there is more than one: the `smoke` job runs it from the checkout, and `package` runs it again
 * against the built binary. The second is the only check that reads the *staged* page, which is where
 * 0.4.0's two packaging mistakes lived, so a gate set in one and not the other is half a check.
 */
function stepsThatRunTheHarness() {
  return WORKFLOW.split(/^ {6}- name: /m)
    .slice(1)
    .map((block) => ({ name: block.split('\n')[0].trim(), text: block }))
    .filter((step) => /FTREE_SMOKE/.test(step.text));
}

test('the workflow sets every gate the harness reads', () => {
  const gates = gatesInHarness();

  // If this is ever empty the test has stopped testing anything -- a rename in main.js would do it.
  assert.ok(gates.length >= 4, `found only ${gates.length} gates in main.js; the pattern has rotted`);

  const steps = stepsThatRunTheHarness();
  assert.ok(steps.length >= 2, `expected the harness to run in at least two steps, found ${steps.length}`);

  for (const step of steps) {
    const missing = gates.filter((gate) => !step.text.includes(gate));
    assert.deepStrictEqual(
      missing,
      [],
      `"${step.name}" runs the smoke harness but never sets ${missing.join(', ')} — `
        + 'those assertions will not run in CI',
    );
  }
});

test('the gates it excludes are excluded for a stated reason, not by omission', () => {
  // Screenshot writers assert nothing; the base variable is the file to open. Both are named above.
  assert.ok(NOT_A_GATE('FTREE_SMOKE'));
  assert.ok(NOT_A_GATE('FTREE_SMOKE_SHOT'));
  assert.ok(NOT_A_GATE('FTREE_SMOKE_SHOT_RELATE'));
  assert.ok(!NOT_A_GATE('FTREE_SMOKE_RELATE'), 'a feature gate must never read as a screenshot');
  assert.ok(!NOT_A_GATE('FTREE_SMOKE_COMPACT'));
});
