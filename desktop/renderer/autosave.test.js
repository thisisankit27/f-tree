/*
 * Autosave's scheduling (#149): the three cases the issue asked for -- many edits make one write, a
 * failed write says so, and a tree with no file yet is left alone -- plus the ones that decide
 * whether it can be trusted: nothing written twice at once, nothing lost in flight, a flush that
 * really flushes.
 *
 * Time is driven by hand. A test that slept for the real delay would be slow, and one that slept
 * for "about" the delay would be flaky in exactly the way that hides a scheduling bug.
 */

import test from 'node:test';
import assert from 'node:assert';

import { createAutosave, describeWriteFailure, AUTOSAVE_DELAY_MS, RETRY_DELAYS_MS } from './autosave.js';

/** A clock that only moves when told to. */
function manualTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) { const id = nextId++; pending.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { pending.delete(id); },
    /** Moves time on, running whatever falls due, in order. */
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...pending].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await settle();
      }
      now = until;
    },
    get scheduled() { return pending.size; },
  };
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function harness({ fail = () => false } = {}) {
  const timers = manualTimers();
  const log = { writes: 0, statuses: [], failures: [] };
  let release = null;
  const autosave = createAutosave({
    timers,
    write: async () => {
      log.writes += 1;
      if (release) await new Promise((resolve) => { release.push(resolve); });
      if (fail()) {
        const error = new Error('ENOSPC: no space left on device, write');
        error.code = 'ENOSPC';
        throw error;
      }
    },
    onStatus: (s) => log.statuses.push(s.state),
    onFailure: (e) => log.failures.push(e),
  });
  return {
    autosave, timers, log,
    /** Makes writes wait until `finish()` is called. */
    hold() { release = []; },
    finish() { const all = release ?? []; release = null; all.forEach((r) => r()); },
  };
}

test('many edits in a burst make one write', async () => {
  const { autosave, timers, log } = harness();
  for (let i = 0; i < 12; i += 1) {
    autosave.changed();
    await timers.advance(AUTOSAVE_DELAY_MS / 3);
  }
  assert.strictEqual(log.writes, 0, 'nothing written while the edits keep coming');
  await timers.advance(AUTOSAVE_DELAY_MS);
  assert.strictEqual(log.writes, 1);
  assert.strictEqual(autosave.status.state, 'saved');
});

test('a write happens once the edits stop, not before', async () => {
  const { autosave, timers, log } = harness();
  autosave.changed();
  assert.strictEqual(autosave.status.state, 'pending');
  await timers.advance(AUTOSAVE_DELAY_MS - 1);
  assert.strictEqual(log.writes, 0);
  await timers.advance(1);
  assert.strictEqual(log.writes, 1);
});

test('a change during a write is written straight after it, and never alongside it', async () => {
  const h = harness();
  h.autosave.changed();
  h.hold();
  await h.timers.advance(AUTOSAVE_DELAY_MS);
  assert.strictEqual(h.log.writes, 1);
  assert.strictEqual(h.autosave.status.state, 'saving');

  h.autosave.changed();
  h.autosave.changed();
  await h.timers.advance(AUTOSAVE_DELAY_MS * 3);
  assert.strictEqual(h.log.writes, 1, 'the second write waits for the first');

  h.finish();
  await settle();
  await settle();
  assert.strictEqual(h.log.writes, 2, 'and then the changes made meanwhile are written');
  assert.strictEqual(h.autosave.status.state, 'saved');
});

test('a failed write is said once, however many times it fails', async () => {
  const { autosave, timers, log } = harness({ fail: () => true });
  autosave.changed();
  await timers.advance(AUTOSAVE_DELAY_MS);
  assert.strictEqual(autosave.status.state, 'error');
  assert.strictEqual(log.failures.length, 1);

  // The retries, backing off.
  for (const wait of RETRY_DELAYS_MS) await timers.advance(wait);
  assert.ok(log.writes >= RETRY_DELAYS_MS.length, `it kept trying: ${log.writes} attempts`);
  assert.strictEqual(log.failures.length, 1, 'one problem, one notice');
  assert.strictEqual(autosave.status.error.code, 'ENOSPC');
});

test('a write that works after failing clears the error, and the next failure is news again', async () => {
  let failing = true;
  const { autosave, timers, log } = harness({ fail: () => failing });
  autosave.changed();
  await timers.advance(AUTOSAVE_DELAY_MS);
  failing = false;
  await timers.advance(RETRY_DELAYS_MS[0]);
  assert.strictEqual(autosave.status.state, 'saved');
  assert.strictEqual(autosave.status.failures, 0);

  failing = true;
  autosave.changed();
  await timers.advance(AUTOSAVE_DELAY_MS);
  assert.strictEqual(log.failures.length, 2);
});

test('a new change after a failure tries again after the ordinary pause, not the backoff', async () => {
  const { autosave, timers, log } = harness({ fail: () => log.writes < 2 });
  autosave.changed();
  await timers.advance(AUTOSAVE_DELAY_MS);
  autosave.changed();
  await timers.advance(AUTOSAVE_DELAY_MS);
  assert.strictEqual(log.writes, 2);
  assert.strictEqual(autosave.status.state, 'saved');
});

test('flush writes now, and resolves whether it worked', async () => {
  const ok = harness();
  ok.autosave.changed();
  assert.strictEqual(await ok.autosave.flush(), true);
  assert.strictEqual(ok.log.writes, 1);
  await ok.timers.advance(AUTOSAVE_DELAY_MS * 2);
  assert.strictEqual(ok.log.writes, 1, 'and the scheduled write it replaced does not also happen');

  const bad = harness({ fail: () => true });
  assert.strictEqual(await bad.autosave.flush(), false);
});

test('flush during a write waits for it, then writes what changed since', async () => {
  const h = harness();
  h.autosave.changed();
  h.hold();
  await h.timers.advance(AUTOSAVE_DELAY_MS);
  const flushed = h.autosave.flush();
  h.finish();
  assert.strictEqual(await flushed, true);
  assert.strictEqual(h.log.writes, 2);
});

test('nothing is scheduled until something changes -- a tree with no file writes nothing', async () => {
  // The app only calls `changed()` for a tree that has a file to go to. An untitled tree never
  // does, so it is never written, and it keeps its Save button and its quit prompt.
  const { autosave, timers, log } = harness();
  await timers.advance(AUTOSAVE_DELAY_MS * 10);
  assert.strictEqual(log.writes, 0);
  assert.strictEqual(autosave.status.state, 'idle');
  assert.strictEqual(timers.scheduled, 0);
});

test('cancel forgets what was scheduled, for a tree being closed', async () => {
  const { autosave, timers, log } = harness();
  autosave.changed();
  autosave.cancel();
  await timers.advance(AUTOSAVE_DELAY_MS * 2);
  assert.strictEqual(log.writes, 0);
  assert.strictEqual(autosave.status.state, 'idle');
});

test('a failure is described in words a person can act on', () => {
  const coded = (code) => Object.assign(new Error(`${code}: something`), { code });
  assert.strictEqual(describeWriteFailure(coded('ENOSPC')), 'the disk is full');
  assert.strictEqual(describeWriteFailure(coded('EROFS')), 'that drive is read-only');
  assert.match(describeWriteFailure(coded('EACCES')), /allowed/);
  assert.match(describeWriteFailure(coded('ENOENT')), /drive removed/);
  // The code survives the trip across IPC only inside the message, so it is read from there too.
  assert.strictEqual(describeWriteFailure(new Error('ENOSPC: no space left on device')),
    'the disk is full');
  assert.strictEqual(describeWriteFailure(new Error('something odd')), 'something odd',
    'an unknown failure is shown as it came, not reworded into vagueness');
});
