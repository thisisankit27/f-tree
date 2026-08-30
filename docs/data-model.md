# Data model reference

Generated schema JSON lives in [`app/schemas/`](../app/schemas) and is committed, so migrations can
be written against a checked-in history.

## `people`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `name` | TEXT? | **null means unknown** — the placeholder mechanism |
| `gender` | TEXT | `MALE`/`FEMALE`/`OTHER`/`UNSPECIFIED`; only ever used to choose a word |
| `birthDate` | TEXT? | partial ISO-8601: `1938`, `1938-04`, `1938-04-17` |
| `deathDate` | TEXT? | same |
| `deceased` | INT | someone can be known dead on an unknown date, so this is not derived |
| `photoId` | TEXT? | file name within `files/photos/`, never a path |
| `notes` | TEXT? | |
| `createdAt`, `updatedAt` | INT | |

Indexed on `name` for search.

## `relationships`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `fromPersonId` | TEXT | for `PARENT`, the parent |
| `toPersonId` | TEXT | for `PARENT`, the child |
| `type` | TEXT | `PARENT` / `SPOUSE` / `SIBLING`, with an `UNKNOWN` read fallback |
| `subtype` | TEXT? | `BIOLOGICAL`/`ADOPTIVE`/`STEP`/`FOSTER`, `MARRIED`/`PARTNER`/`DIVORCED`, `FULL`/`HALF` |
| `createdAt` | INT | |

- **UNIQUE** `(fromPersonId, toPersonId, type)` — with symmetric edges stored in canonical id order,
  this makes duplicate prevention a database guarantee.
- Indexed on `(fromPersonId, type)` and `(toPersonId, type)`.
- Foreign keys to `people` with `ON DELETE CASCADE`. Foreign keys are enabled explicitly on open;
  SQLite leaves them off by default, and the cascade is what stops a hard delete orphaning an edge.

## `person_origins`

`(personId, sourceTreeId, sourcePersonId)`, primary key over all three; a person accumulates origins
as they are merged from several sources. Indexed on `(sourceTreeId, sourcePersonId)` for the lookup
an import does.

## Adding a relationship kind

1. Add the constant to `RelationshipType`.
2. Add a keep rule if it must survive R8 — enum names are persisted.
3. Nothing else. The column is TEXT, unrecognised values read back as `UNKNOWN`, and older releases
   degrade the row rather than dropping it.
