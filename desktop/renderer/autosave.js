/*
 * Writing the open tree back to its file, a moment after every change.
 *
 * Until 0.6 nothing reached disk until somebody pressed Save, and the quit prompt was the only thing
 * standing between an afternoon's work and a closed window (#149). On the phone there is no such
 * thing as an unsaved tree: it is a database, always durable. The desktop's closest honest analogue
 * is write-behind to the `.ftree` that is open -- the file *is* the document here -- so that is what
 * this is.
 *
 * Deliberately not a write per change. A person typing a name, then a date, then adding a child
 * makes a burst of edits, and each write reads the whole tree back to verify it (save.js), so the
 * burst is coalesced: a write happens once changes have stopped for a moment. A change that arrives
 * while a write is in flight is not lost and not raced; it is written as soon as that one finishes.
 *
 * A failed write does not fail silently. The status says so, and the caller is told once per run of
 * failures rather than once per retry, because a full disk or an unplugged drive is one problem,
 * not forty. Retries back off, and any new change retries at once.
 *
 * Pure apart from the timers, which are passed in so the tests can drive time by hand.
 */

/** How long changes must stop before the tree is written. */
export const AUTOSAVE_DELAY_MS = 1200;

/** How long to wait before trying a failed write again, each time it fails in a row. */
export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

/**
 * @param {object} options
 * @param {() => Promise<void>} options.write writes the tree; resolves once it is on disk, throws if
 *   it could not be. Deciding there is nothing to write is its business, not this module's.
 * @param {(status: {state: string, error: Error|null, failures: number}) => void} [options.onStatus]
 *   told of every change of state: 'idle', 'pending', 'saving', 'saved' or 'error'
 * @param {(error: Error) => void} [options.onFailure] told once when writes start failing
 * @param {number} [options.delay]
 * @param {{setTimeout: Function, clearTimeout: Function}} [options.timers]
 */
export function createAutosave({
  write,
  onStatus = () => {},
  onFailure = () => {},
  delay = AUTOSAVE_DELAY_MS,
  timers = globalThis,
}) {
  let timer = null;
  let running = null;
  let again = false;
  let status = { state: 'idle', error: null, failures: 0 };

  const set = (next) => {
    status = { ...status, ...next };
    onStatus(status);
  };

  const clear = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };

  const schedule = (ms) => {
    clear();
    timer = timers.setTimeout(() => { timer = null; run(); }, ms);
  };

  async function run() {
    clear();
    if (running) {
      again = true;
      return running;
    }
    set({ state: 'saving' });
    running = (async () => {
      try {
        await write();
        set({ state: 'saved', error: null, failures: 0 });
        return true;
      } catch (error) {
        const failures = status.failures + 1;
        set({ state: 'error', error, failures });
        if (failures === 1) onFailure(error);
        return false;
      } finally {
        running = null;
      }
    })();

    const ok = await running;
    if (again) {
      // Something changed while that write was in flight. It is written now, not after another
      // pause: the pause was for the burst, and this is its tail.
      again = false;
      return run();
    }
    if (!ok) schedule(RETRY_DELAYS_MS[Math.min(status.failures, RETRY_DELAYS_MS.length) - 1]);
    return ok;
  }

  return {
    /** The tree changed. Written once changes stop for `delay`, or at once if the last write failed. */
    changed() {
      if (running) {
        again = true;
        return;
      }
      // After a failure the status stays 'error' until a write works, but a new change is still the
      // best moment to try again -- the drive may be back -- so it waits the ordinary pause, not
      // the rest of the backoff.
      if (status.state !== 'error') set({ state: 'pending' });
      schedule(delay);
    },

    /**
     * Writes now, without waiting out the pause, and resolves whether it worked.
     *
     * Waits for a write already in flight rather than starting a second beside it; the one it then
     * starts picks up anything that changed meanwhile.
     */
    async flush() {
      clear();
      if (running) await running;
      return run();
    },

    /** Forgets anything scheduled, for a tree that is being closed. */
    cancel() {
      clear();
      again = false;
      set({ state: 'idle', error: null, failures: 0 });
    },

    get status() {
      return status;
    },
  };
}

/**
 * Why a write failed, in words a person can act on.
 *
 * The codes are Node's, passed through by the main process. A message nobody recognises is shown
 * as it came, because a vague rewording would hide the one detail that might explain it.
 */
export function describeWriteFailure(error) {
  const text = String(error?.message ?? error ?? '');
  const code = error?.code ?? /\b(E[A-Z]+)\b/.exec(text)?.[1];
  switch (code) {
    case 'ENOSPC': return 'the disk is full';
    case 'EROFS': return 'that drive is read-only';
    case 'EACCES':
    case 'EPERM': return 'f-tree isn’t allowed to write there';
    case 'ENOENT': return 'its folder is no longer there — was a drive removed?';
    case 'EBUSY': return 'another program has the file open';
    default: return text || 'the write did not finish';
  }
}
