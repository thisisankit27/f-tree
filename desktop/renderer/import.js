/*
 * Reading somebody else's `.ftree` into the tree that is already open.
 *
 * A port of `transfer/TreeImporter.kt`, and it keeps that file's governing rule exactly:
 *
 *     an import adds, it never replaces.
 *
 * Nothing already here is deleted and no value already written is overwritten. The worst this can
 * do is add people who turn out to be duplicates, which somebody can then merge by hand. The
 * opposite mistake -- silently collapsing two real people into one -- cannot be undone by hand,
 * because the information that they were ever two people is gone.
 *
 * Two halves, and the split is the whole safety story: `planImport` reads and judges and changes
 * nothing, `applyImport` writes, once, using decisions somebody has actually seen.
 *
 * Where this deliberately differs from the phone: the Android importer writes a backup file first,
 * because it commits into a database the moment it is told to. Here the tree is in memory and no
 * file is touched until somebody saves, so the import goes through `tree.edit` as a single
 * undoable step. Ctrl+Z puts the tree back exactly as it was, and closing without saving leaves
 * the file on disk untouched. That is a stronger promise than a backup, and a cheaper one.
 */

import { matchPeople, graphOf, originKey, MatchTier, mergesByDefault, needsReview }
  from './matching.js';
import { RelationshipType, Rejection, checkRelationship, relationshipTypeFrom } from './rules.js';

/** A file that cannot be imported, with a reason worth showing somebody. */
export class ImportRefused extends Error {}

const isBlank = (value) => value == null || String(value).trim() === '';

/**
 * What importing this document *would* do. Writes nothing, changes nothing.
 *
 * @param {object} args
 * @param {object} args.document  the parsed exchange document, as `archive.js` returns it
 * @param {import('./document.js').Tree} args.tree  the tree currently open
 * @param {string} args.ownTreeId  this installation's id
 */
export function planImport({ document, tree, ownTreeId = '' }) {
  // `parseDocument` has already refused the wrong format and a version from the future, which are
  // the two refusals that must happen before anything here trusts a field. This adds the third.
  if (!document.people?.length) {
    throw new ImportRefused('That file has nobody in it, so there is nothing to import.');
  }

  const local = tree.people;

  /*
   * Where each local person has been known by before.
   *
   * Two sources. Origins recorded by previous imports are the ordinary one. The second is the
   * identity rule: a file exported by *this* installation names its people by ids this tree still
   * uses, so re-importing our own export recognises everybody outright, with no name comparison
   * at all. Getting that wrong in the safe direction merely proposes duplicates; getting it wrong
   * in the unsafe direction would merge strangers, so it is keyed on an id, never on a name.
   */
  const originIndex = new Map();
  for (const person of local) {
    for (const origin of person.origins ?? []) {
      originIndex.set(originKey(origin.treeId, origin.personId), person.id);
    }
  }
  if (ownTreeId && document.sourceTreeId === ownTreeId) {
    for (const person of local) originIndex.set(originKey(ownTreeId, person.id), person.id);
  }

  const importedGraph = graphOf((document.relationships ?? []).map((r) => [r.from, r.to]));
  const localGraph = graphOf(tree.relationships.map((r) => [r.from, r.to]));

  const found = matchPeople({
    imported: document.people,
    importedGraph,
    local,
    localGraph,
    originIndex,
    sourceTreeId: document.sourceTreeId ?? '',
  });

  /*
   * The evidence, in the terms somebody deciding would use.
   *
   * `sharedRelatives` counts; this names them. A strong match merges by default, so the screen
   * that says so has to be able to answer "why do you think that?" with something checkable --
   * "you both have Priya and Sunita" is an argument a person can agree or disagree with, where
   * "2 relatives in common" is only an assertion.
   */
  const localById = new Map(local.map((p) => [p.id, p]));
  const importedById = new Map(document.people.map((p) => [p.id, p]));
  const settledLocal = new Map(
    found.filter((m) => m.localId != null).map((m) => [m.importedId, m.localId]));

  const matches = found.map((match) => {
    if (match.localId == null) return { ...match, shared: [], theirs: importedById.get(match.importedId) ?? null, mine: null };
    const neighbours = localGraph.get(match.localId) ?? new Set();
    const shared = [];
    for (const neighbour of importedGraph.get(match.importedId) ?? new Set()) {
      const asLocal = settledLocal.get(neighbour);
      if (asLocal != null && neighbours.has(asLocal)) {
        shared.push(localById.get(asLocal)?.name ?? 'someone unnamed');
      }
    }
    return {
      ...match,
      shared,
      theirs: importedById.get(match.importedId) ?? null,
      mine: localById.get(match.localId) ?? null,
    };
  });

  const byImportedId = new Map(matches.map((m) => [m.importedId, m]));

  return {
    document,
    matches,
    matchFor: (importedId) => byImportedId.get(importedId) ?? null,

    /** The ones worth interrupting somebody for. A provable match is not a question. */
    reviewable: matches.filter(needsReview),
    certainMatches: matches.filter((m) => m.tier === MatchTier.CERTAIN).length,

    /** What happens if nobody touches anything. */
    defaultDecisions: new Map(
      matches.filter((m) => m.localId != null).map((m) => [m.importedId, mergesByDefault(m)])),

    /** So the confirm button can say what it is about to do, before it does it. */
    outcomeUnder(decisions) {
      let merged = 0;
      for (const match of matches) if (decisions.get(match.importedId) === true) merged += 1;
      return { added: matches.length - merged, merged };
    },
  };
}

/**
 * Fills one person's gaps from an imported record.
 *
 * Never overwrites. An empty field takes the imported value; a field that already says something
 * keeps saying it; a disagreement is reported rather than resolved. The person at this machine is
 * the authority on their own family, and a file from a cousin is not grounds for overruling them.
 */
function filledFrom(mine, record, photoEntry) {
  const conflicts = [];
  const filled = { ...mine };

  const pick = (field, label) => {
    const ours = mine[field];
    const theirs = record[field];
    if (isBlank(ours)) { if (!isBlank(theirs)) filled[field] = theirs; return; }
    if (isBlank(theirs) || String(ours) === String(theirs)) return;
    conflicts.push({ person: mine.name ?? record.name ?? null, field: label, kept: String(ours), ignored: String(theirs) });
  };

  pick('name', 'name');
  pick('birthDate', 'born');
  pick('deathDate', 'died');
  pick('notes', 'notes');

  // Not run through `pick`: an unset gender is written as a value rather than left absent, so
  // "nobody said" and "somebody said unspecified" look identical here and neither is a conflict.
  if (isBlank(mine.gender) || mine.gender === 'UNSPECIFIED') {
    if (!isBlank(record.gender)) filled.gender = record.gender;
  }

  /*
   * Once true, stays true -- nobody stops being dead because a second file forgot to say so.
   *
   * Only written when it becomes true. Assigning `false` to somebody who simply never had the
   * field adds a key, which changes the tree's signature, which makes a re-import of an unchanged
   * file report unsaved work and ask to save a file identical to the one on disk.
   */
  if (Boolean(record.deceased) && !mine.deceased) filled.deceased = true;

  if (isBlank(mine.photo) && photoEntry) filled.photo = photoEntry;

  return { filled, conflicts };
}

/** An archive entry name that is not already taken, keeping the original where it is free. */
function freePhotoName(taken, entry) {
  if (!taken.has(entry)) return entry;
  const match = /^(photos\/)(.*?)(\.[^.]*)?$/.exec(entry) ?? [];
  const [, dir = 'photos/', stem = 'photo', extension = ''] = match;
  for (let n = 2; ; n += 1) {
    const candidate = `${dir}${stem}-${n}${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Applies a reviewed plan, as one undoable edit.
 *
 * @param {object} args
 * @param {import('./document.js').Tree} args.tree  changed in place
 * @param {object} args.plan  from `planImport`
 * @param {Map<string, boolean>} args.decisions  imported id to "merge into the local person"
 * @param {Map<string, Uint8Array>} args.photos  the open tree's photos, added to in place
 * @param {Map<string, Uint8Array>} args.importedPhotos  photos read out of the imported archive
 * @param {string} args.label  what the undo entry should say
 */
export function applyImport({ tree, plan, decisions, photos = new Map(),
  importedPhotos = new Map(), label = 'Import' }) {
  const document = plan.document;
  const result = {
    peopleAdded: 0,
    peopleMerged: 0,
    relationshipsAdded: 0,
    relationshipsAlreadyPresent: 0,
    photosAdded: 0,
    conflicts: [],
    relationshipsRefused: [],
  };

  tree.edit(label, (state) => {
    const byId = new Map(state.people.map((p) => [p.id, p]));

    /*
     * Every imported person resolved to a local id before anything is written.
     *
     * Somebody not being merged gets a *freshly generated* id rather than the one in the file: an
     * imported id is only unique within the tree it came from, and here it could already belong to
     * a different person entirely.
     */
    const idMap = new Map();
    const merging = new Map();
    const arriving = [];

    for (const record of document.people) {
      const match = plan.matchFor(record.id);
      const localId = decisions.get(record.id) === true ? match?.localId ?? null : null;
      if (localId != null && byId.has(localId)) {
        idMap.set(record.id, localId);
        merging.set(record.id, localId);
      } else {
        const fresh = crypto.randomUUID();
        idMap.set(record.id, fresh);
        arriving.push([record, fresh]);
      }
    }

    // Photos first, and under names that cannot collide with ones already held.
    const photoFor = new Map();
    for (const record of document.people) {
      const entry = record.photo;
      if (!entry || !importedPhotos.has(entry)) continue;
      const name = freePhotoName(photos, entry);
      photos.set(name, importedPhotos.get(entry));
      photoFor.set(record.id, name);
      result.photosAdded += 1;
    }

    /*
     * Provenance for everybody, merged and new alike.
     *
     * This is what makes the *next* import of a related file a lookup instead of a judgement, so
     * it is recorded even when the match was certain and nothing else changed.
     */
    const originsFor = (record, localId) => {
      const from = document.sourceTreeId ?? '';
      const origins = [];
      /*
       * An origin that only restates the identity rule is not recorded: our own export, naming
       * our own person by the id they still have here. It would be true and useless, and writing
       * it would leave a re-import of our own file reporting unsaved work.
       */
      const restatesIdentity = from && from === tree.sourceTreeId && record.id === localId;
      if (!restatesIdentity) origins.push({ treeId: from, personId: record.id });
      for (const origin of record.origins ?? []) origins.push({ ...origin });
      return origins;
    };
    const withOrigins = (existing, record, localId) => {
      const seen = new Set((existing ?? []).map((o) => originKey(o.treeId, o.personId)));
      const merged = [...(existing ?? [])];
      for (const origin of originsFor(record, localId)) {
        const key = originKey(origin.treeId, origin.personId);
        if (origin.treeId && !seen.has(key)) { seen.add(key); merged.push(origin); }
      }
      // Absent rather than empty: an `origins: []` on somebody who has no recorded provenance is
      // a key that says nothing, and adding one is enough to report the tree as changed.
      return merged.length ? { origins: merged } : {};
    };

    for (const [record, fresh] of arriving) {
      const { origins, id, photo, ...fields } = record;
      state.people.push({
        ...fields,
        id: fresh,
        ...(photoFor.has(record.id) ? { photo: photoFor.get(record.id) } : {}),
        ...withOrigins([], record, fresh),
      });
      result.peopleAdded += 1;
    }

    for (const [importedId, localId] of merging) {
      const record = document.people.find((p) => p.id === importedId);
      const at = state.people.findIndex((p) => p.id === localId);
      if (at < 0) continue;
      const { filled, conflicts } = filledFrom(state.people[at], record, photoFor.get(importedId));
      state.people[at] = { ...filled, ...withOrigins(state.people[at].origins, record, localId) };
      result.conflicts.push(...conflicts);
      result.peopleMerged += 1;
    }

    /*
     * Every imported connection is put to the same rules that govern one added by hand.
     *
     * A deliberate divergence from the Kotlin, which inserts edges and lets the database drop
     * exact duplicates. That is not enough here, for two reasons. A symmetric edge arriving the
     * other way round -- they hold B is a spouse of A, we hold A is a spouse of B -- is the same
     * connection, and a literal duplicate check counts it as new. And merging is what makes
     * cycles reachable: two imported people collapsing onto one local person can close a line
     * where somebody becomes their own ancestor, which no hand edit is allowed to create and
     * which the layout has never had to survive.
     *
     * Refused connections are counted and reported, never dropped quietly.
     */
    const edgeKey = (from, to, type) => [from, to, type].join('\u0000');
    const edges = new Set(state.relationships.map((r) => edgeKey(r.from, r.to, r.type)));
    const parents = new Map();
    for (const edge of state.relationships) {
      if (edge.type !== RelationshipType.PARENT) continue;
      if (!parents.has(edge.to)) parents.set(edge.to, []);
      parents.get(edge.to).push(edge.from);
    }

    for (const record of document.relationships ?? []) {
      const from = idMap.get(record.from);
      const to = idMap.get(record.to);
      if (from == null || to == null) continue;

      const type = relationshipTypeFrom(record.type);
      if (!type) {
        result.relationshipsRefused.push({ reason: 'UNKNOWN_TYPE', type: record.type });
        continue;
      }

      const verdict = checkRelationship({
        from,
        to,
        type,
        existingEdgeExists: (f, t, ty) => edges.has(edgeKey(f, t, ty)),
        parentsOf: (who) => parents.get(who) ?? [],
      });

      if (!verdict.allowed) {
        // Two imported people merged onto one local person is the ordinary way a self-edge or a
        // duplicate arrives, so neither of those is a fault worth reporting as one.
        if (verdict.reason === Rejection.DUPLICATE || verdict.reason === Rejection.SELF_REFERENCE) {
          result.relationshipsAlreadyPresent += 1;
        } else {
          result.relationshipsRefused.push({ reason: verdict.reason, from, to, type });
        }
        continue;
      }

      edges.add(edgeKey(from, to, type));
      if (type === RelationshipType.PARENT) {
        if (!parents.has(to)) parents.set(to, []);
        parents.get(to).push(from);
      }
      state.relationships.push({
        id: crypto.randomUUID(),
        from,
        to,
        type,
        ...(record.subtype ? { subtype: record.subtype } : {}),
      });
      result.relationshipsAdded += 1;
    }
  });

  return result;
}
