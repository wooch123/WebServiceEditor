# ADR 0020: Deterministic Project Corpus Generation

Status: Accepted

## Decision

Phase 20 reads `webeditor_project_corpus_v3.json` as a generation descriptor and
creates exactly 100 isolated Projects through the same Project, Page, Element,
Layout Preset, Schema, and Runtime services used by `/api/v1`. The generator is
available only below the authenticated `/api/v1/internal/project-corpus`
boundary. It never accepts SQL, JavaScript, filesystem paths, or arbitrary
fixture definitions from a client.

Generation runs and per-Project results are durable Metadata records. A run is
bound to a validated deterministic seed, generator version, canonical source
manifest checksum, request hash, and idempotency key. A failed run is retained
with its error and is never reported as generated. Reusing an idempotency key
with another seed is a conflict; replaying the same request returns the stored
run.

Each descriptor's `pageCount`, `elementCount`, `tableCount`, and
`runtimeRowCount` are exact generated counts. `nodeCount` is the exact Phase 21
graph workload target. The product graph derives one real Node per current
Page, Element, and Table, so Phase 20 makes positions durable for
`min(nodeCount, derivedNodeCount)` real Nodes. If `nodeCount` is larger, the
remaining workload Nodes are deterministic route-verification inputs rather
than hidden product Nodes. Arrays of Page,
Preset, Element, and Binding types are deterministic coverage pools, not a
claim that every tag is instantiated in a Project whose scale is smaller than
the pool. Corpus-wide coverage must still equal the canonical sets.

Every Project stores a unique Project Sentinel in its Project description and
a unique Runtime Row Sentinel in its isolated Test Runtime database. Runtime
row generation uses the applied Test schema, prepared statements, an exact row
budget, integrity checks, and a durable command record. No Production Runtime
database is populated during Phase 20.

The generated manifest uses canonical recursively sorted JSON and lowercase
SHA-256. Results are ordered by `projectIndex`; coverage arrays and coordinates
are sorted before hashing. The report contains real generated UUIDs but is
otherwise deterministic for a given source manifest and seed.

Phase 20 creates the corpus only. Phase 21 performs reload, restart, publish,
runtime, read/write, navigation, lifecycle, isolation, orphan, and performance
operations and advances the same run/results to their verification states.

## Safety

- The generator requires a separate storage root and Metadata database for
  operational runs; Production Project data is never an input.
- Original Corpus Projects are protected by result foreign keys. Permanent
  purge is performed only on Phase 21 clones.
- Creation failure leaves the run `FAILED` and preserves evidence. It does not
  silently reuse or overwrite a previous corpus.
- Startup readiness validates the two corpus tables through normal SQLite
  integrity and foreign-key checks.
