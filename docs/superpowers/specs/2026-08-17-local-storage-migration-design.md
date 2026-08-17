# Local Storage Migration Design

**Date:** 2026-08-17
**Status:** Approved for implementation planning

## Purpose

Move Plotter's canonical trip storage from Supabase to the home-hosted local-web
installation without losing existing work. Every device on the trusted home
network must share the same trips and see changes made by other devices. Plotter
does not need to work away from home, and it may be unavailable when the host Mac
or its local-web service is unavailable.

The migration includes all Plotter domain rows and all Supabase Storage objects,
not only records visible to the current anonymous browser session. Supabase stays
unchanged as the rollback source until a later, separately approved retirement.

## Approved direction

Convert Plotter from a static local-web application with Supabase persistence to
a local-web service application with one repository-backed SQLite database and a
repository-backed media tree. The React frontend and `npm run trip` CLI use the
same versioned service contract. Neither opens the database directly.

This is a clean cutover, not a continuing synchronization bridge. There is one
canonical store after cutover. Browser IndexedDB remains available only for
isolated E2E tests and, if needed, explicit legacy import; it is never a fallback
source of truth.

## Scope

### In scope

- A small TypeScript/Node loopback service built and released with the app.
- SQLite persistence for trips, destinations, route legs, activities, media
  metadata, revisions, and schema metadata.
- Filesystem persistence and delivery for uploaded and imported media.
- Versioned HTTP adapters for the browser and trip CLI.
- Cross-device refresh notifications within the trusted home network.
- A lossless, project-wide export and verified import from Supabase.
- Ongoing database and media recovery mechanisms.
- Conversion of `local-web.json` from `static` to the standard `service` shape.
- Removal of Supabase from the active runtime only after local acceptance.

### Out of scope

- Access outside the home network.
- Offline browsing, offline editing, or client-side conflict merging.
- User accounts, permissions, or per-user trip ownership in the local runtime.
- Bidirectional Supabase/SQLite synchronization.
- Automatic deletion of the Supabase project or its data.
- The separately proposed shared, multi-user experience catalogue. That may use
  a different hosting model later without changing personal trip ownership.
- Unrelated route-planning, map, activity, or visual changes.

## Platform and release architecture

`local-web.json` becomes a service manifest using only the supported local-web
service contract:

- the immutable release contains the built React frontend and server code;
- the service binds `127.0.0.1` and accepts the platform-assigned port;
- `/api` is the only service proxy capability required by the frontend;
- the start command receives `{repository}/user-data` as its validated writable
  data directory;
- runtime data is not included in `build.release` and is unaffected by build,
  deployment, or rollback;
- Supabase credentials are not build environment variables after cutover.

The expected repository-owned layout is:

```text
user-data/
  plotter.sqlite3
  backups/
  media/
  trash/
  imports/
```

`user-data/` is ignored by Git. The service validates that its supplied data
directory is contained by the canonical repository before reading or writing it.
Development and E2E runs always receive separate explicit data directories.

The service uses the runtime's built-in SQLite support rather than adding a
native database dependency. The minimum supported Node version must be declared
and checked because both production and CLI paths depend on that API.

## Ownership and component boundaries

### Service

The service is the only runtime component that opens SQLite or mutates media
files. It owns:

- schema initialization and explicit migrations;
- transactional repositories;
- optimistic-concurrency checks;
- media path validation and atomic file operations;
- backup and recovery operations;
- the HTTP API and change-event stream;
- health reporting that distinguishes process health from data readiness.

### Domain and command layer

Existing domain invariants and `TripDataService` behaviour remain app-owned.
The implementation may move environment-neutral modules into shared source
locations, but it must not fork route reconciliation, validation, or mutation
logic into independent browser and server versions.

`TripRepository` and `TripDirectoryRepository` remain the domain-facing ports.
The server provides SQLite implementations. The browser receives HTTP-backed
implementations. The CLI calls the same HTTP service and retains its structured
command/result schema.

### Frontend

The frontend owns optimistic presentation and refetch behaviour, not canonical
persistence. If the service is unavailable, the UI shows shared storage as
unavailable and offers retry. It does not silently switch to IndexedDB.

### Local-web platform

The platform owns registration, release composition, port assignment, service
startup, proxying, deployment, and live health verification. Plotter does not
edit the host registry, persist a chosen port, or write into an immutable
release.

## SQLite model

The active database contains these logical tables:

- `schema_metadata` records the database schema version.
- `store_metadata` records the directory revision and migration provenance.
- `trips` stores trip metadata, routing vehicle state, timestamps, and a
  monotonic per-trip revision.
- `destinations` stores ordered trip stops and their structured location,
  research, routing-anchor, and timestamp data.
- `route_legs` stores route intent, geometry, sections, waypoints, warnings,
  provider diagnostics, and timestamps.
- `activities` stores destination-owned activities, location, research links,
  ordering, and timestamps.
- `media_assets` stores destination or activity ownership, local media identity,
  display metadata, source provenance, ordering, and timestamps.

The implementation preserves existing UUIDs and timestamps. Structured fields
that are currently Postgres arrays or JSONB remain structured values encoded
canonically as JSON text where a normalized child table adds no domain value.
Every JSON field is validated at the repository boundary.

SQLite foreign keys and uniqueness constraints reproduce the meaningful current
Postgres relationships, including trip ownership of children, destination
ownership of activities, endpoint ownership of route legs, and media ordering.
Foreign keys are enabled on every connection. Writes use transactions, a bounded
busy timeout, and WAL mode. SQLite remains a single-writer store; the service
serializes accepted write batches so browser and CLI callers never contend by
opening the file independently.

Supabase-only authentication fields are not part of the active authorization
model. Original owner and membership identifiers remain in the raw migration
archive and in migration provenance, so their source information is not lost.

## Media model

Storage-backed media bytes move to `user-data/media/`. Canonical filenames are
generated from stable media identity plus a safe extension; callers never supply
filesystem paths. `media_assets` retains the original bucket and object path as
migration provenance along with content type, byte count, and SHA-256.

The service streams media through a base-path-relative API URL. Existing
Supabase public or signed URLs are not treated as permanent local identifiers.
External research links that were never owned Supabase objects remain external
URLs and are preserved unchanged.

Media creation is staged to a temporary file, hashed and validated, then renamed
into place before its metadata transaction commits. If the database transaction
fails, the newly installed file is removed. If file installation fails, no
metadata becomes visible.

Media bytes are immutable after creation. Replacement creates a new local media
object. A user deletion removes active metadata transactionally and moves the
bytes into `user-data/trash/`; v1 never purges trash automatically. Cleanup is a
separate explicit maintenance action.

## HTTP contract

All routes are versioned beneath `/api/v1` and return structured JSON errors.
The initial contract contains:

- `GET /healthz` for loopback process and data-readiness health;
- `GET /api/v1/trips` for the directory revision and trip summaries;
- `POST /api/v1/trips` for trip creation;
- `GET /api/v1/trips/:tripId` for one complete trip snapshot and revision;
- `PATCH /api/v1/trips/:tripId` and `DELETE /api/v1/trips/:tripId` for directory
  mutations;
- `POST /api/v1/trips/:tripId/mutations` for the existing typed, bounded trip,
  stop, route, activity, link, and ordering commands;
- explicit multipart media creation/replacement endpoints;
- `GET /api/v1/media/:mediaId/content` for local media delivery;
- `GET /api/v1/events` for server-sent revision-change events;
- explicit backup creation, inspection, and restore endpoints used by the CLI.

Mutation requests carry the directory or trip revision last read by the caller.
The service rejects a stale revision with HTTP `409` and the current revision.
Validation failures use `400`, missing records use `404`, unavailable or invalid
canonical storage uses `503`, and unexpected failures use `500` without exposing
paths, credentials, SQL, or private source values.

The precise mutation union is generated from or shared with the existing
`TripDataService` command types. A generic SQL or arbitrary patch endpoint is
forbidden.

## Cross-device synchronization

The database stores one monotonic directory revision and one monotonic revision
per trip. A successful transaction increments the relevant revisions and only
then publishes a server-sent event containing the affected trip ID and new
revision. Events are invalidation hints, never authoritative state payloads.

The writing browser may retain the current optimistic UI flow. Other open
browsers refetch the directory or affected trip when they observe a newer
revision. Reconnects and page visibility changes compare current revisions, so a
missed event cannot leave a client permanently stale.

The first valid writer wins when two devices edit the same revision. The stale
writer receives `409`, discards uncommitted optimistic state, reloads canonical
state, and displays a concise conflict message. There is no automatic field
merge in v1.

## Supabase migration

### Source boundary

The migration reads the entire Plotter project, not only rows permitted to the
current browser's anonymous session. Project-wide credentials are supplied only
at execution time through an ignored local environment file. The importer uses
them exclusively for read, list, and download operations; the existing
publishable browser key is insufficient for the completeness requirement.

The source inventory includes at least:

- `trips`;
- `trip_members`;
- `destinations`;
- `route_legs`;
- `activities`;
- `media_assets`;
- every object in the Plotter `trip-media` bucket;
- migration identifiers and source timestamps needed to explain the snapshot.

The importer discovers the current schema rather than assuming that local
migration files exactly describe the live project. Unknown Plotter tables or
columns stop the apply phase until their treatment is reviewed. Secrets and row
contents are never printed to logs.

### Staged export

Migration runs during an explicit maintenance window in which Plotter is not
edited. The command supports a mandatory dry run and a separate apply mode. Both
create a timestamped directory under `user-data/imports/` containing:

- canonical JSON exports for every source table;
- an inventory of storage bucket, object path, byte count, content type, source
  timestamp, and SHA-256;
- downloaded object bytes;
- source schema and migration metadata;
- a machine-readable and human-readable reconciliation report.

The export is lossless. Obsolete ownership rows, unreferenced objects, and
records not used by the local runtime remain in this archive rather than being
dropped. Pagination is explicit and verified so provider response limits cannot
silently truncate a table or bucket listing.

### Local materialization

Apply creates a temporary SQLite database and temporary media tree within the
same filesystem as `user-data/`. It preserves identifiers and timestamps, maps
active domain rows into the SQLite schema, and records original Supabase media
locations and ownership identifiers as provenance.

The importer must pass all of these gates before promotion:

- expected source and destination row counts per active table;
- preservation of every source primary ID;
- `PRAGMA integrity_check` returning `ok`;
- an empty `PRAGMA foreign_key_check` result;
- successful domain deserialization of every trip snapshot;
- exact inventory coverage for every storage object;
- matching byte counts and SHA-256 values for every downloaded object;
- explicit classification of orphaned rows, missing referenced objects, and
  unreferenced objects;
- a second source revision or timestamp check confirming that no write occurred
  during the migration window.

Missing referenced media, changed source state, unknown schema, truncated
pagination, integrity errors, or unexplained count mismatches fail promotion.
Unreferenced storage objects do not fail a lossless export, but they remain in
the raw archive and appear prominently in the report.

### Atomic promotion and retry

Only a fully reconciled apply may rename the temporary database and media tree
to their canonical paths. Existing local canonical state, if any, is backed up
before promotion. A failed run leaves canonical state unchanged and retains its
staging directory for diagnosis.

The migration records a stable source fingerprint and is retry-safe. Repeating
the same import must either produce the same result or explain the changed source
fingerprint; it must not duplicate rows or media.

Supabase receives no writes or deletes during migration. Its project, schema,
storage, and credentials remain intact through local acceptance.

## Backup and recovery

Before each accepted write batch, the service creates a consistent SQLite
backup named for the current revision under `user-data/backups/` and retains the
five newest automatic database backups. Failure to create or validate the
backup rejects the mutation.

Schema migration and canonical import promotion always create an additional
named pre-operation backup that is not consumed by the five-backup automatic
rotation. Restore never overwrites canonical state silently: it validates the
selected backup, preserves the current database under a recovery name, and then
requires explicit confirmation before promotion.

A manual portable backup contains:

- a consistent SQLite online backup;
- the active media tree;
- a manifest with schema version, revisions, file sizes, and SHA-256 values.

Restore validates the complete archive and its hashes before changing state.
There is no automatic merge with current state. Media trash and raw Supabase
imports are excluded from ordinary portable backups but may be archived
separately.

## Error behaviour

- **Service unavailable:** the frontend shows shared storage unavailable and a
  retry action. It does not open a second writable store.
- **Revision conflict:** the client reloads canonical state, explains that
  another device changed it, and does not retry the stale mutation silently.
- **Invalid canonical state:** the process remains reachable, but readiness
  health returns a failure, mutations are rejected, and the UI gives recovery
  guidance.
- **Media failure:** no metadata references a partial file, and failed temporary
  files are cleaned up safely.
- **Backup failure:** the requested mutation does not execute.
- **Migration failure:** staging is retained, canonical local state is unchanged,
  and Supabase remains the rollback source.
- **Event-stream interruption:** clients reconnect and compare revisions; missed
  events cannot cause permanent divergence.

## Security and privacy boundary

The service binds loopback only and is exposed to the trusted home network only
through the local-web host. V1 adds no accounts, cookies, tokens, or internet
exposure. The service validates request schemas, identifiers, upload sizes,
content types, and all filesystem containment boundaries, but does not add
adversarial multi-tenant machinery without a demonstrated threat model.

Supabase project-wide migration credentials are temporary, ignored, server-side
only, and never included in Vite variables, the release, logs, backups, or Git.
After cutover, the frontend contains no Supabase URL, publishable key, client, or
session persistence.

## Verification strategy

### App-local automated checks

- Run one repository contract suite against SQLite.
- Test schema creation, forward migrations, foreign keys, transactions,
  serialization, busy handling, and rollback.
- Test API validation, structured errors, expected revisions, and `409`
  conflicts.
- Test media upload, import, streaming, deletion-to-trash, and interrupted
  operations.
- Test backup creation, retention, integrity rejection, and explicit restore.
- Test browser HTTP adapters and CLI commands against the service boundary.
- Test two-browser invalidation, reconnect, missed-event recovery, and stale
  writes.
- Keep pure domain and route-reconciliation coverage independent of transport.

### Isolated browser acceptance

Playwright owns a disposable service, SQLite database, media tree, and Vite
server. It never reads or writes `user-data/`, Supabase, or the user's normal
browser IndexedDB. The suite covers the existing Plotter workflows at the hosted
base path plus service unavailability, conflicts, cross-page synchronization,
media, and fresh-browser startup.

### Migration verification

- Exercise dry-run and apply against synthetic exports containing every entity,
  orphan classes, pagination boundaries, duplicate paths, missing objects, and
  interrupted downloads.
- Take a fresh read-only inventory of the live Supabase project immediately
  before the real migration.
- Require a clean reconciliation report before promotion.
- After promotion, compare every source table and storage object against the
  imported database, media tree, and raw archive.
- Open Plotter in a fresh browser context with no IndexedDB or Supabase session.
- Confirm every trip appears and manually inspect representative route geometry,
  activities, links, destination media, and activity media.
- Exercise a browser write, a CLI write, and cross-device refresh against the
  local service.

### Platform verification

Run the repository's app-local checks, isolated E2E suite, structural Doctor,
and full local-web application check. Preview the static-to-service activation
only after those pass. Applying activation remains a separate explicit approval
and must use the platform command; no host registry or port is edited manually.

## Cutover and rollback sequence

1. Implement the coherent service release and migration tooling in an isolated
   worktree and verify them using disposable data.
2. Commit the focused implementation, review it, and merge it to clean `main`
   without activating the service.
3. From committed canonical `main`, run the project-wide Supabase migration dry
   run and review its report.
4. Enter the no-edit maintenance window and run the real staged import.
5. Pass every integrity, count, fingerprint, media, and domain gate.
6. Promote the local state atomically.
7. Run app-local, browser, migration, and platform checks against that state.
8. Preview local-web activation from clean committed `main`.
9. Obtain explicit approval, then apply activation.
10. Verify live health, served registry, every trip, representative media,
    browser and CLI writes, and cross-device refresh.
11. Keep Supabase unchanged through an acceptance period.

If local acceptance fails, restore the pre-promotion local backup if necessary
and deploy the prior static release, which can still use the untouched Supabase
project. Rollback never copies partial local writes back to Supabase.

Removing Supabase dependencies, manifest capability, environment names,
migrations, credentials, or the remote project is a later cleanup decision. No
cleanup is implied by successful cutover.

## Acceptance criteria

The migration is complete only when:

- one SQLite database is the sole canonical runtime store;
- all home-network devices read and write that shared state;
- service unavailability does not create an independent browser store;
- every Supabase domain row is either active in SQLite or preserved and
  classified in the lossless raw archive;
- every Supabase Storage object is present with matching byte count and SHA-256;
- all database integrity, foreign-key, count, ID, pagination, and fingerprint
  checks pass;
- every trip loads from a fresh browser with no Supabase or IndexedDB state;
- representative route, activity, link, destination-media, and activity-media
  behaviour is visibly correct;
- browser and CLI writes share the service's concurrency and invariant checks;
- another open device refreshes after a committed change;
- backup creation, portable export, and explicit restore are verified;
- the complete local-web verification matrix passes;
- the live static-to-service cutover has separate explicit approval and live
  evidence;
- Supabase remains untouched and recoverable until separately retired.
