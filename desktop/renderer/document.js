/*
 * A tree you can change, and change back.
 *
 * `archive.js` reads a document and `write.js` writes one; both deal in the flat exchange shape,
 * which is right for a file and wrong for editing. This sits between them: it holds one tree,
 * applies edits under the relationship rules, remembers what it did, and hands back the exchange
 * shape when it is time to save.
 *
 * Three decisions worth stating, because they are what make an editor safe to hand somebody:
 *
 * **Every edit is a whole snapshot.** Undo restores a copy of the previous state rather than
 * running an inverse operation. Inverse operations are where undo bugs live -- deleting a person
 * removes their relationships too, and an inverse that forgets one of them silently corrupts the
 * tree. A tree of a few hundred people is tens of kilobytes; correctness is worth the copies.
 *
 * **Nothing is edited in place.** Callers get frozen objects. A screen that mutated a person
 * directly would change the tree without passing the rules, without marking it unsaved and
 * without anything to undo -- and it would do it invisibly.
 *
 * **A refusal is a value, not an exception.** `addRelationship` returns why it said no, using the
 * same reasons as `RelationshipRules.kt`, so the interface can explain rather than just fail.
 */

import { checkRelationship, isSymmetric, RelationshipType, Rejection } from './rules.js';

export { RelationshipType, Rejection };

/** How many steps back a person can go. Beyond this the oldest are dropped. */
const HISTORY_LIMIT = 100;

const clone = (value) => structuredClone(value);

function newId() {
  // Present in every browser this runs in, in the Electron renderer, and in Node 19+.
  return crypto.randomUUID();
}

/** The fields a person actually has. Anything else a caller passes is ignored, not stored. */
const PERSON_FIELDS = ['name', 'gender', 'birthDate', 'deathDate', 'deceased', 'photo', 'notes'];

/**
 * Trims a person down to the format's fields, and to values the format can hold.
 *
 * Empty strings become absent: a name someone typed and then cleared is not a name, and writing
 * `""` would make the app show a person called nothing rather than one whose name is unknown.
 */
function tidyPerson(fields) {
  const out = {};
  for (const key of PERSON_FIELDS) {
    if (!Object.hasOwn(fields, key)) continue;
    const value = fields[key];
    if (key === 'deceased') {
      if (value) out.deceased = true;
      continue;
    }
    if (value == null) continue;
    const text = String(value).trim();
    if (text) out[key] = text;
  }
  return out;
}

export class Tree {
  /**
   * @param {object} document a document in the exchange shape, as `archive.js` returns
   * @param {{ownTreeId?: string}} options this installation's id, for a tree that came from
   *   nowhere. See `desktop/identity.js` for why an empty origin is not an acceptable default.
   */
  constructor(document = {}, { ownTreeId = '' } = {}) {
    this.state = {
      exportedAt: document.exportedAt ?? '',
      /*
       * Whose tree this is, in the sense the importer means.
       *
       * A tree that arrived from a phone keeps that phone's id, and that is not an oversight: the
       * importer recognises a file whose `sourceTreeId` matches its own and then matches people by
       * id alone, with no name comparison. Rewriting it here would throw that away and send a
       * desktop-edited tree back as a stranger.
       *
       * A tree that came from nowhere -- started on this machine -- takes this installation's own
       * id instead. The empty string is the one value that must never be written: every desktop
       * would be claiming it, and importing one such tree into another would merge people who
       * merely share a position, not an identity.
       */
      sourceTreeId: document.sourceTreeId || ownTreeId || '',
      people: clone(document.people ?? []),
      relationships: clone(document.relationships ?? []),
    };
    this.past = [];
    this.future = [];
    /* What the tree looked like when it was last saved, so "unsaved" is a fact and not a flag. */
    this.savedAt = this.signature();
  }

  /* -------------------------------------------------------------- reading */

  get people() {
    return this.state.people.map((p) => Object.freeze({ ...p }));
  }

  get relationships() {
    return this.state.relationships.map((r) => Object.freeze({ ...r }));
  }

  person(id) {
    const found = this.state.people.find((p) => p.id === id);
    return found ? Object.freeze({ ...found }) : null;
  }

  /**
   * Cheap enough to take on every edit, and the honest answer to "has this changed?".
   *
   * A dirty *flag* would say yes after an edit and its undo, and nag somebody to save a file
   * identical to the one on disk. Comparing content means undoing back to the start is genuinely
   * unmodified, which is what the person doing it believes.
   */
  signature() {
    return JSON.stringify([this.state.people, this.state.relationships]);
  }

  get isDirty() {
    return this.signature() !== this.savedAt;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  /** What undo would take back, for a menu item that says so. */
  get undoLabel() {
    return this.past.at(-1)?.label ?? null;
  }

  get redoLabel() {
    return this.future.at(-1)?.label ?? null;
  }

  /** Called after a successful save. */
  markSaved() {
    this.savedAt = this.signature();
  }

  /* -------------------------------------------------------------- the graph, for the rules */

  parentsOf(id) {
    return this.state.relationships
      .filter((r) => r.type === RelationshipType.PARENT && r.to === id)
      .map((r) => r.from);
  }

  edgeExists(from, to, type) {
    return this.state.relationships.some((r) => r.from === from && r.to === to && r.type === type);
  }

  /* -------------------------------------------------------------- changing */

  /**
   * Runs `change`, keeping the state it replaced.
   *
   * The snapshot is taken before and only kept if something actually changed, so an edit that
   * sets a name to the name it already had does not put a no-op on the undo stack for somebody
   * to wonder about later.
   */
  edit(label, change) {
    const before = clone(this.state);
    const beforeSignature = this.signature();
    const result = change();
    if (result?.ok === false) {
      this.state = before;
      return result;
    }
    if (this.signature() === beforeSignature) return result ?? { ok: true };

    this.past.push({ label, state: before });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future.length = 0;
    return result ?? { ok: true };
  }

  undo() {
    if (!this.past.length) return { ok: false, reason: 'NOTHING_TO_UNDO' };
    const step = this.past.pop();
    this.future.push({ label: step.label, state: clone(this.state) });
    this.state = step.state;
    return { ok: true, label: step.label };
  }

  redo() {
    if (!this.future.length) return { ok: false, reason: 'NOTHING_TO_REDO' };
    const step = this.future.pop();
    this.past.push({ label: step.label, state: clone(this.state) });
    this.state = step.state;
    return { ok: true, label: step.label };
  }

  /* -------------------------------------------------------------- people */

  addPerson(fields = {}) {
    const person = { id: fields.id ?? newId(), ...tidyPerson(fields) };
    if (this.state.people.some((p) => p.id === person.id)) {
      return { ok: false, reason: 'DUPLICATE_ID' };
    }
    return this.edit(`Add ${person.name ?? 'person'}`, () => {
      this.state.people.push(person);
      return { ok: true, id: person.id };
    });
  }

  updatePerson(id, fields = {}) {
    const at = this.state.people.findIndex((p) => p.id === id);
    if (at < 0) return { ok: false, reason: 'NO_SUCH_PERSON' };

    /*
     * A field named with an explicit null or empty string is being cleared, and a field not
     * named is being left alone. Without that distinction a screen that edits only the notes
     * would silently wipe the birth date it never showed.
     */
    const next = { id };
    const current = this.state.people[at];
    for (const key of PERSON_FIELDS) {
      if (Object.hasOwn(fields, key)) continue;
      if (Object.hasOwn(current, key)) next[key] = current[key];
    }
    Object.assign(next, tidyPerson(fields));
    if (current.origins) next.origins = current.origins;

    return this.edit(`Edit ${current.name ?? 'person'}`, () => {
      this.state.people[at] = next;
      return { ok: true };
    });
  }

  /**
   * Removes a person and every relationship that touched them.
   *
   * Leaving the edges behind would put ends in the file that point at nobody. `model.js` drops
   * those when reading, so the tree would look right here and be wrong on disk -- the worst of
   * both, and invisible until somebody opened the file elsewhere.
   */
  removePerson(id) {
    const person = this.state.people.find((p) => p.id === id);
    if (!person) return { ok: false, reason: 'NO_SUCH_PERSON' };

    return this.edit(`Delete ${person.name ?? 'person'}`, () => {
      const before = this.state.relationships.length;
      this.state.people = this.state.people.filter((p) => p.id !== id);
      this.state.relationships = this.state.relationships
        .filter((r) => r.from !== id && r.to !== id);
      return { ok: true, removedEdges: before - this.state.relationships.length };
    });
  }

  /* -------------------------------------------------------------- relationships */

  /**
   * Records an edge, if the rules allow it.
   *
   * Both ends must exist. The Kotlin does not check that because its rows are foreign keys into
   * a table that enforces it; here nothing does, and an edge to a person who was never added
   * would write a file no reader can resolve.
   */
  addRelationship({ from, to, type, subtype = null }) {
    if (!this.person(from) || !this.person(to)) {
      return { ok: false, reason: 'NO_SUCH_PERSON' };
    }
    const verdict = checkRelationship({
      from,
      to,
      type,
      existingEdgeExists: (f, t, ty) => this.edgeExists(f, t, ty),
      parentsOf: (who) => this.parentsOf(who),
    });
    if (!verdict.allowed) return { ok: false, reason: verdict.reason };

    const edge = { id: newId(), from, to, type };
    if (subtype != null && String(subtype).trim()) edge.subtype = String(subtype).trim();

    return this.edit(this.labelFor(type, from, to), () => {
      this.state.relationships.push(edge);
      return { ok: true, id: edge.id };
    });
  }

  labelFor(type, from, to) {
    const name = (id) => this.person(id)?.name ?? 'someone';
    if (type === RelationshipType.PARENT) return `Make ${name(from)} a parent of ${name(to)}`;
    if (isSymmetric(type)) return `Connect ${name(from)} and ${name(to)}`;
    return 'Add a relationship';
  }

  removeRelationship(id) {
    const edge = this.state.relationships.find((r) => r.id === id);
    if (!edge) return { ok: false, reason: 'NO_SUCH_RELATIONSHIP' };
    return this.edit('Remove a relationship', () => {
      this.state.relationships = this.state.relationships.filter((r) => r.id !== id);
      return { ok: true };
    });
  }

  /* -------------------------------------------------------------- saving */

  /**
   * The exchange shape, ready for `write.js`.
   *
   * `exportedAt` is stamped now because that is what the field means -- when this file was
   * written. `sourceTreeId` is carried through untouched: it identifies the installation a tree
   * came from, and rewriting it here would break the identity matching an import depends on.
   */
  toExchange(now = new Date()) {
    return {
      exportedAt: now.toISOString(),
      sourceTreeId: this.state.sourceTreeId,
      people: clone(this.state.people),
      relationships: clone(this.state.relationships),
    };
  }
}
