# Local Storage Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Plotter's active Supabase persistence with one home-hosted, repository-backed SQLite and media service, migrate every Supabase domain row and Storage object without loss, and retain Supabase unchanged as the rollback source.

**Architecture:** Convert Plotter to a standard local-web service release. A loopback Node service is the sole owner of SQLite, media files, revisions, backups, and migration promotion; the React browser and `npm run trip` CLI share a versioned HTTP client and existing domain command layer. Mutations use optimistic revisions, successful commits emit invalidation-only server-sent events, and clients always refetch canonical snapshots instead of creating an offline copy.

**Tech Stack:** Node.js 24+ built-in `node:sqlite`, TypeScript 6, esbuild 0.28.2, React 19, Vite 8, Vitest 4, Playwright 1.61, Supabase JavaScript 2.108.2 and Supabase CLI 2.109 for read-only migration, local-web service contract 1.

## Global Constraints

- Execute Tasks 1-15 in an isolated `codex/` worktree created with `superpowers:using-git-worktrees`; do not implement substantive code on the current dirty `main` worktree.
- Preserve the unrelated `.superpowers/sdd/task-1-report.md`, `task-4-report.md`, `task-7-report.md`, and `task-8-report.md` edits. Never stage or rewrite them.
- Keep one canonical runtime store. Browser IndexedDB may remain for unit coverage and an explicit legacy import, but normal development, Playwright, hosted use, and the CLI must use the service.
- Bind the app service to `127.0.0.1` on the platform-assigned port. Do not hand-edit the local-web host registry, Caddy configuration, LaunchAgents, or assigned ports.
- Keep runtime data in ignored `user-data/`; never copy the database, media, backups, trash, imports, credentials, or `.env` into `dist`, `server-dist`, `release`, Git, logs, or browser bundles.
- Only the service may open SQLite or mutate `user-data/media` and `user-data/trash`. Browser and CLI code use `/api/v1` through the shared client.
- Preserve existing domain validation, route reconciliation, trip mutation behavior, activity ordering, media ordering, and provider request semantics. Do not fork those rules by transport.
- Preserve every source ID and timestamp that is supported by the local model. Preserve all other source rows, columns, ownership data, memberships, and unreferenced objects losslessly in the raw import archive and provenance report.
- Migration credentials use `PLOTTER_SUPABASE_URL` and `PLOTTER_SUPABASE_SECRET_KEY` from an ignored execution-time environment only. They may only list, select, download, and inspect. No source insert, update, delete, upload, move, or remove call is permitted.
- Do not print secrets, row contents, signed URLs, filesystem roots, SQL text, or private provider responses in user-facing errors or normal logs.
- Every accepted write must first create and validate an automatic SQLite backup. Retain five automatic backups; named pre-operation and recovery backups are outside that rotation.
- Media bytes are immutable after creation. Stage and hash new bytes before metadata commit; deletion moves bytes to trash and rolls back the move if the database transaction fails.
- `409` means a stale directory or trip revision. The client reloads canonical state and explains the conflict; it never retries a stale mutation silently.
- SSE messages are invalidation hints only. Reconnect and visibility recovery must compare revisions with the service so missed events cannot leave stale state.
- Playwright owns a disposable service, SQLite database, media tree, and Vite server. It must never access `user-data/`, live Supabase, or the user's normal browser IndexedDB.
- Keep the existing browser MapTiler and OpenRouteService build variables. Move `SERPAPI_API_KEY` and all Supabase migration secrets behind the service boundary.
- Keep commits narrowly scoped and run the specified checks before each commit. Do not weaken assertions, lint, TypeScript, migration gates, or the local-web verification matrix.
- Stop at every explicit approval gate in Tasks 16-18. Approval to implement does not authorize live Supabase access, import promotion, service activation, Supabase cleanup, or remote project retirement.

---

## File Structure

**Create:**

- `src/api/contracts.ts` — versioned request, response, event, and structured-error types.
- `src/api/client.ts` and `src/api/client.test.ts` — environment-neutral HTTP client, multipart support, and conflict mapping.
- `src/storage/persistedRows.ts` and `src/storage/persistedRows.test.ts` — shared row codecs extracted from the Supabase adapter.
- `src/storage/revision.ts` — revisioned snapshots and `TripStorageConflictError`.
- `src/storage/serviceRepositories.ts` and tests — HTTP-backed directory and trip repository adapters.
- `src/storage/serviceRealtime.ts` and tests — EventSource invalidation and revision recovery.
- `server/args.ts` and tests — validated port, repository-contained data directory, and optional env-file arguments.
- `server/schema.ts`, `server/database.ts`, and tests — SQLite schema, migrations, readiness, and integrity checks.
- `server/backupStore.ts`, `server/writeCoordinator.ts`, and tests — online backups, retention, transactions, revisions, and event publication.
- `server/directoryRepository.ts`, `server/tripRepository.ts`, and contract tests — SQLite persistence for every repository operation.
- `server/mediaStore.ts` and tests — contained paths, staging, hashing, streaming, trash, and recovery.
- `server/events.ts` and tests — SSE connection registry and invalidation events.
- `server/providers/linkPreview.ts`, `imageSearch.ts`, `remoteImage.ts`, and tests — server-side provider operations.
- `server/http.ts`, `server/service.ts`, and integration tests — versioned HTTP API and static frontend serving.
- `server/portableBackup.ts` and tests — portable manifest, archive, validation, and explicit restore.
- `scripts/supabase-migration/source.ts`, `archive.ts`, `materialize.ts`, `reconcile.ts`, `cli.ts`, and tests — read-only source inventory, lossless export, reconciliation, and atomic promotion.
- `scripts/migrate-supabase.ts` — migration executable entrypoint.
- `tests/start-service.ts` — disposable E2E service lifecycle.
- `tests/service-storage.spec.ts` — fresh-browser, conflict, synchronization, media, and unavailable-service acceptance.
- `tsconfig.server.json` and `vitest.server.config.ts` — Node service build/test boundaries.

**Modify:**

- `package.json`, `package-lock.json`, and `.gitignore` — Node requirement, service scripts, exact esbuild dependency, and runtime/build ignores.
- `vite.config.ts` — development API proxy and hosted base-path handling.
- `playwright.config.ts` and `AGENTS.md` — disposable service-backed E2E contract.
- `src/storage/tripRepository.ts` — coherent snapshot extension without changing existing bounded operations.
- `src/storage/tripDirectoryRepository.ts` — revisioned directory extension.
- `src/storage/supabaseTripRepository.ts` — consume shared codecs while it remains available for rollback.
- `src/storage/appRepository.ts` and tests — select service storage for normal and E2E use; remove active anonymous-auth dependency.
- `src/hooks/useTripData.ts`, `src/hooks/useTripWorkspace.ts`, and tests — coherent snapshot loading, conflict recovery, and availability messages.
- `src/App.tsx` and tests — service invalidation wiring and reconnect/visibility recovery.
- `src/services/linkPreviewClient.ts`, `src/services/webImageSearchClient.ts`, and tests — use local provider endpoints.
- `src/cli/trip.ts` and CLI tests — use `PLOTTER_BASE_URL` and service-backed repositories.
- `local-web.json` — supported service release, health, proxy, start command, and capability removal.
- `.env.example` and `README.md` — local service, migration, backup, restore, and operational instructions.

---

### Task 1: Establish the Node Service Build and Test Boundary

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `tsconfig.server.json`
- Create: `vitest.server.config.ts`
- Create: `server/args.ts`
- Create: `server/args.test.ts`
- Create: `server/service.ts`

**Interfaces:**

```ts
export type ServiceArguments = {
  port: number;
  dataDir: string;
  envFile?: string;
};

export function parseServiceArguments(argv: string[], repositoryRoot: string): ServiceArguments;
```

- [ ] **Step 1: Create the isolated implementation worktree**

Follow `superpowers:using-git-worktrees`, verify ignored worktree placement, create a `codex/plotter-local-storage` branch, install dependencies there, and record the clean baseline:

```bash
git status --short
npm ci
npm run check
npm run test:e2e
```

Expected: the worktree is clean before implementation and both existing suites pass without reading personal data.

- [ ] **Step 2: Write failing argument-boundary tests**

Cover a valid numeric port, missing arguments, a data directory outside the canonical repository, a symlink escape, and an optional existing env file. Require stable public error messages that omit absolute paths.

```ts
expect(parseServiceArguments([
  '--port', '5175',
  '--data-dir', repositoryDataDir,
], repositoryRoot)).toEqual({ port: 5175, dataDir: repositoryDataDir });

expect(() => parseServiceArguments([
  '--port', '5175',
  '--data-dir', outsideDirectory,
], repositoryRoot)).toThrow('The service data directory is outside the Plotter repository.');
```

Run `npx vitest run --config vitest.server.config.ts server/args.test.ts`. Expected: fail because the service boundary does not exist.

- [ ] **Step 3: Add the service toolchain and minimal entrypoint**

Pin `esbuild` to `0.28.2`, declare `engines.node` as `>=24.0.0`, and add these scripts:

```json
{
  "dev:service": "tsx server/service.ts --port 5175 --data-dir user-data --env-file .env",
  "build:service": "esbuild server/service.ts --bundle --platform=node --format=esm --outfile=server-dist/service.mjs",
  "test:server": "vitest run --config vitest.server.config.ts",
  "migrate:supabase": "tsx scripts/migrate-supabase.ts"
}
```

Make `build` run the existing TypeScript/Vite build followed by `build:service`, and make `test` run browser-unit and server-unit configurations. Ignore `server-dist/`, `release/`, `user-data/`, and `tests/.tmp/`.

- [ ] **Step 4: Implement and verify the boundary**

Use realpath containment, validate port range 1-65535, require an existing directory or create only the final `user-data` directory beneath the repository, and load the optional env file without exposing its values. The entrypoint may initially start a loopback HTTP server whose `/healthz` returns `503` with `{ "status": "initializing" }`.

Run:

```bash
npx vitest run --config vitest.server.config.ts server/args.test.ts
npm run build:service
node server-dist/service.mjs --port 5175 --data-dir user-data
```

Expected: tests and build pass; a separate `curl http://127.0.0.1:5175/healthz` returns the initializing response; terminate the process.

- [ ] **Step 5: Commit the service scaffold**

```bash
git add package.json package-lock.json .gitignore tsconfig.server.json vitest.server.config.ts server/args.ts server/args.test.ts server/service.ts
git commit -m "build: add Plotter service runtime"
```

---

### Task 2: Define Shared Persistence and API Contracts

**Files:**
- Create: `src/storage/persistedRows.ts`
- Create: `src/storage/persistedRows.test.ts`
- Create: `src/storage/revision.ts`
- Create: `src/api/contracts.ts`
- Modify: `src/storage/tripRepository.ts`
- Modify: `src/storage/tripDirectoryRepository.ts`
- Modify: `src/storage/supabaseTripRepository.ts`

**Interfaces:**

```ts
export type TripSnapshot = {
  revision: number;
  destinations: Destination[];
  routeLegs: RouteLeg[];
  activities: Activity[];
};

export type DirectorySnapshot = {
  revision: number;
  trips: TripSummary[];
};

export class TripStorageConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super('Another device changed this data. Plotter reloaded the latest version.');
  }
}

export type RevisionEvent =
  | { scope: 'directory'; revision: number }
  | { scope: 'trip'; tripId: string; revision: number };
```

- [ ] **Step 1: Add failing round-trip and contract tests**

Move the complete Supabase row shapes and conversion expectations into fixture-driven tests. Include routing anchors, vehicle fields, ferry policy, waypoints, sections, warnings, provider diagnostics, activity links, media ownership, and sort order. Assert that `TripRepository.loadSnapshot()` and `TripDirectoryRepository.loadDirectory()` are optional compatibility extensions while old methods remain present.

Run `npm test -- src/storage/persistedRows.test.ts`. Expected: fail because shared codecs are absent.

- [ ] **Step 2: Extract codecs without changing Supabase behavior**

Export named row codecs from `persistedRows.ts`, consume them from `supabaseTripRepository.ts`, and add:

```ts
export type TripRepository = {
  loadSnapshot?(): Promise<TripSnapshot>;
  listDestinations(): Promise<Destination[]>;
  listRouteLegs(): Promise<RouteLeg[]>;
};

export type TripDirectoryRepository = {
  loadDirectory?(): Promise<DirectorySnapshot>;
  listTrips(): Promise<TripSummary[]>;
};
```

Keep every existing operation in both interfaces; the shortened excerpt defines only the new seam.

- [ ] **Step 3: Define the versioned API union**

Define exact JSON contracts for directory reads/writes, coherent trip reads, every bounded repository mutation, structured errors, backup operations, provider operations, and revision events. Use discriminated mutation names such as `save-destination`, `delete-destinations`, `save-route-leg`, `apply-trip-mutation`, `create-activity`, `update-activity`, `reorder-activities`, and media-specific HTTP routes. Do not introduce arbitrary object patches beyond the existing typed repository patches.

- [ ] **Step 4: Verify no behavioral drift and commit**

```bash
npm test -- src/storage/persistedRows.test.ts src/storage/supabaseTripRepository.test.ts src/storage/tripRepository.test.ts
npm run lint
git add src/storage/persistedRows.ts src/storage/persistedRows.test.ts src/storage/revision.ts src/api/contracts.ts src/storage/tripRepository.ts src/storage/tripDirectoryRepository.ts src/storage/supabaseTripRepository.ts
git commit -m "refactor: share Plotter persistence contracts"
```

---

### Task 3: Create and Validate the SQLite Schema

**Files:**
- Create: `server/schema.ts`
- Create: `server/database.ts`
- Create: `server/database.test.ts`

**Interfaces:**

```ts
export type PlotterDatabase = {
  connection: DatabaseSync;
  schemaVersion: number;
  close(): void;
};

export function openPlotterDatabase(databasePath: string): PlotterDatabase;
export function assertDatabaseIntegrity(connection: DatabaseSync): void;
```

- [ ] **Step 1: Write failing schema tests**

Assert fresh creation, reopening, `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = 1`, a bounded busy timeout, explicit schema version, all indexes, and cascades. Insert complete codec fixtures into `trips`, `destinations`, `route_legs`, `activities`, `media_assets`, `trip_revisions`, `store_metadata`, and `migration_provenance`. Assert duplicate IDs and invalid foreign keys fail.

Run `npx vitest run --config vitest.server.config.ts server/database.test.ts`. Expected: fail.

- [ ] **Step 2: Implement schema v1 and migrations**

Use `DatabaseSync`, prepared statements, JSON columns for structured domain values, integer revisions, ISO timestamps, and explicit migration transactions. `store_metadata` must contain `schema_version`, `directory_revision`, and optional accepted-import provenance. Never auto-repair an integrity or foreign-key failure.

- [ ] **Step 3: Add readiness and corruption coverage**

```ts
expect(database.connection.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
expect(database.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
```

Corrupt or unsupported schemas must leave the process alive but data readiness false; all mutation paths will later map that state to `503`.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run --config vitest.server.config.ts server/database.test.ts
git add server/schema.ts server/database.ts server/database.test.ts
git commit -m "feat: add Plotter SQLite schema"
```

---

### Task 4: Enforce Backups, Transactions, Revisions, and Events

**Files:**
- Create: `server/backupStore.ts`
- Create: `server/backupStore.test.ts`
- Create: `server/events.ts`
- Create: `server/events.test.ts`
- Create: `server/writeCoordinator.ts`
- Create: `server/writeCoordinator.test.ts`

**Interfaces:**

```ts
export type WriteScope =
  | { kind: 'directory'; expectedRevision: number }
  | { kind: 'trip'; tripId: string; expectedRevision: number };

export type WriteCoordinator = {
  run<T>(scope: WriteScope, mutate: (connection: DatabaseSync) => T): Promise<{ value: T; revision: number }>;
};
```

- [ ] **Step 1: Write failing coordinator tests**

Prove writes serialize, a backup completes before mutation begins, backup failure prevents mutation, stale revisions throw `TripStorageConflictError`, rollback retains the old revision, successful commits increment exactly once, and events emit only after commit. Verify only the five newest `automatic-*.sqlite3` files remain and named backups are untouched.

- [ ] **Step 2: Implement online backup and validation**

Use the built-in SQLite backup API to a temporary file in `backups/`, open the completed copy read-only, require integrity `ok` and no foreign-key violations, then atomically rename it. Rotation runs only after a valid new automatic backup exists.

- [ ] **Step 3: Implement a single write queue**

Queue promises in process order. Inside each queued write: create backup, begin immediate transaction, compare the supplied revision, run the bounded callback, increment revisions, commit, then publish a `RevisionEvent`. On any failure, roll back and emit nothing.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run --config vitest.server.config.ts server/backupStore.test.ts server/events.test.ts server/writeCoordinator.test.ts
git add server/backupStore.ts server/backupStore.test.ts server/events.ts server/events.test.ts server/writeCoordinator.ts server/writeCoordinator.test.ts
git commit -m "feat: coordinate backed-up revisioned writes"
```

---

### Task 5: Implement SQLite Directory and Trip Repositories

**Files:**
- Create: `server/directoryRepository.ts`
- Create: `server/tripRepository.ts`
- Create: `server/repositoryContract.test.ts`
- Modify: `src/storage/tripRepository.ts`

**Interfaces:**

```ts
export function createSqliteDirectoryRepository(
  database: PlotterDatabase,
  writes: WriteCoordinator,
): RevisionedDirectoryStore;

export function createSqliteTripRepository(
  database: PlotterDatabase,
  writes: WriteCoordinator,
  tripId: string,
): RevisionedTripStore;

export type RevisionedDirectoryStore = {
  load(): Promise<DirectorySnapshot>;
  create(expectedRevision: number, input: CreateTripRequest): Promise<DirectoryWriteResponse>;
  update(expectedRevision: number, tripId: string, patch: UpdateTripRequest): Promise<DirectoryWriteResponse>;
  delete(expectedRevision: number, tripId: string): Promise<DirectoryWriteResponse>;
};

export type RevisionedTripStore = {
  load(): Promise<TripSnapshot>;
  mutate(expectedRevision: number, mutation: TripMutationRequest): Promise<TripWriteResponse>;
};
```

- [ ] **Step 1: Parameterize the repository contract suite**

Adapt the same creation, update, deletion, ordering, topology, activity, and replacement fixtures used by the existing repository contract to the revisioned SQLite stores. Add coherent snapshot assertions that never observe half of an `applyTripMutation` or `replaceTripData` transaction.

Run `npx vitest run --config vitest.server.config.ts server/repositoryContract.test.ts`. Expected: SQLite cases fail.

- [ ] **Step 2: Implement directory persistence**

Preserve UUIDs, timestamps, routing vehicle fields, sort order, cascaded deletion, and directory revision semantics. Trip creation creates its trip revision in the same transaction; deletion removes active metadata but delegates media byte movement to Task 6.

- [ ] **Step 3: Implement every trip repository operation**

Use shared codecs and prepared statements. `loadSnapshot()` reads destinations, route legs, and activities in one read transaction with the trip revision. Bounded bulk changes and ordering validate the complete requested ID sets before writing.

- [ ] **Step 4: Verify parity and commit**

```bash
npm test -- src/storage/tripRepository.test.ts
npx vitest run --config vitest.server.config.ts server/repositoryContract.test.ts
git add server/directoryRepository.ts server/tripRepository.ts server/repositoryContract.test.ts src/storage/tripRepository.ts
git commit -m "feat: persist trips in SQLite"
```

---

### Task 6: Add Atomic Media Storage

**Files:**
- Create: `server/mediaStore.ts`
- Create: `server/mediaStore.test.ts`
- Modify: `server/directoryRepository.ts`
- Modify: `server/tripRepository.ts`

**Interfaces:**

```ts
export type StoredMediaObject = {
  relativePath: string;
  byteCount: number;
  sha256: string;
  contentType: string;
};

export type MediaStore = {
  stage(input: ReadableStream<Uint8Array>, contentType: string): Promise<StoredMediaObject>;
  commit(staged: StoredMediaObject, mediaId: string): Promise<StoredMediaObject>;
  moveToTrash(relativePath: string, mediaId: string): Promise<() => Promise<void>>;
};
```

- [ ] **Step 1: Write failing containment and failure tests**

Cover upload size limits, allowed content types, filename independence, SHA-256, partial stream failure, atomic rename, symlink/path traversal rejection, missing bytes, metadata rollback, deletion-to-trash, restoration after database failure, and whole-trip media deletion.

- [ ] **Step 2: Implement immutable content-addressed storage**

Stream bytes into an exclusive temporary file beneath the media staging directory while hashing and counting. Validate before renaming to a contained canonical path. Serve by media ID resolved through metadata; never accept a filesystem path from a request.

- [ ] **Step 3: Integrate media metadata transactions**

Create or import bytes before the SQLite transaction, commit metadata and revision once, remove the staged canonical file if that transaction fails, and publish only afterward. On deletion, move bytes to trash first, delete metadata transactionally, and restore bytes if the database operation fails.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run --config vitest.server.config.ts server/mediaStore.test.ts server/repositoryContract.test.ts
git add server/mediaStore.ts server/mediaStore.test.ts server/directoryRepository.ts server/tripRepository.ts
git commit -m "feat: store Plotter media atomically"
```

---

### Task 7: Move Provider Operations Behind the Service

**Files:**
- Create: `server/providers/linkPreview.ts`
- Create: `server/providers/linkPreview.test.ts`
- Create: `server/providers/imageSearch.ts`
- Create: `server/providers/imageSearch.test.ts`
- Create: `server/providers/remoteImage.ts`
- Create: `server/providers/remoteImage.test.ts`

**Interfaces:**

```ts
export function fetchLinkPreview(input: { url: string }, signal: AbortSignal): Promise<LinkPreview>;
export function searchWebImages(input: { query: string }, apiKey: string, signal: AbortSignal): Promise<WebImageSearchResult[]>;
export function fetchRemoteImage(input: { url: string }, signal: AbortSignal): Promise<{ bytes: ReadableStream<Uint8Array>; contentType: string }>;
```

- [ ] **Step 1: Port existing Edge Function cases into failing Node tests**

Cover scheme validation, DNS/private-address rejection after redirects, timeouts, response-size bounds, content-type validation, HTML metadata precedence, SERPAPI missing-key behavior, response normalization, remote image download, and redacted provider errors.

- [ ] **Step 2: Implement server-owned provider clients**

Keep `SERPAPI_API_KEY` server-side. Permit public `http`/`https` research pages and images only after validating every resolved address and redirect. Use abort timeouts and bounded streaming. Return normalized app contracts, not raw provider payloads.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run --config vitest.server.config.ts server/providers
git add server/providers
git commit -m "feat: host Plotter provider operations locally"
```

---

### Task 8: Expose the Versioned HTTP API and SSE Stream

**Files:**
- Create: `server/http.ts`
- Create: `server/http.test.ts`
- Modify: `server/service.ts`

**Interfaces:**

```ts
export function createPlotterHttpHandler(dependencies: {
  directory: RevisionedDirectoryStore;
  tripRepository(tripId: string): RevisionedTripStore;
  media: MediaStore;
  events: RevisionEventSource;
  readiness(): { ready: boolean; reason?: string };
}): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
```

- [ ] **Step 1: Write failing HTTP integration tests**

Exercise `GET /healthz`, directory CRUD, coherent trip snapshot, every typed mutation, multipart upload/import, media content streaming, provider calls, backup routes, `GET /api/v1/events`, invalid JSON, unknown fields, invalid IDs, oversized bodies, `404`, `409`, `503`, and redacted `500`. Mutation requests must carry both `Content-Type` and `X-Plotter-Write: 1`.

- [ ] **Step 2: Implement strict routing and validation**

Map only the approved `/api/v1` contract to repository methods. Reject unknown properties and mutation discriminants. Set `Cache-Control: no-store` on state and errors, content-safe headers on media, heartbeat comments on SSE, and the platform-compatible frontend fallback only for non-API `GET`/`HEAD` requests.

- [ ] **Step 3: Wire service startup and readiness**

Open the canonical database, initialize repositories and media directories, and serve the immutable `public/` frontend. Bind explicitly to `127.0.0.1`. Process liveness may be `200` only when data readiness is true; invalid canonical storage returns structured `503` while leaving diagnostics reachable.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run --config vitest.server.config.ts server/http.test.ts server
npm run build:service
git add server/http.ts server/http.test.ts server/service.ts
git commit -m "feat: expose the Plotter storage service"
```

---

### Task 9: Build the Shared HTTP Client and Repository Adapters

**Files:**
- Create: `src/api/client.ts`
- Create: `src/api/client.test.ts`
- Create: `src/storage/serviceRepositories.ts`
- Create: `src/storage/serviceRepositories.test.ts`

**Interfaces:**

```ts
export type PlotterApiClient = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  upload<T>(path: string, form: FormData, expectedRevision: number): Promise<T>;
};

export function createServiceRepositories(client: PlotterApiClient): {
  directory: TripDirectoryRepository;
  createTripRepository(tripId: string): TripRepository;
};
```

- [ ] **Step 1: Write failing client tests**

Assert base-path-safe URLs, JSON parsing, empty responses, multipart requests, write headers, `AbortSignal`, structured errors, redacted unknown errors, and mapping a `409` body to `TripStorageConflictError(currentRevision)`.

- [ ] **Step 2: Implement revision-aware adapters**

The directory adapter caches the last directory revision read. Each trip adapter caches the last coherent trip revision. A successful response replaces the cached revision; a caller with no successful read cannot mutate. Keep media content URLs service-relative and do not cache state in browser storage.

- [ ] **Step 3: Run browser and server contract fixtures against the adapter**

Use a real disposable service for one integration case proving the HTTP adapter and SQLite repository produce the same normalized snapshot.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- src/api/client.test.ts src/storage/serviceRepositories.test.ts
npx vitest run --config vitest.server.config.ts server/http.test.ts
git add src/api/client.ts src/api/client.test.ts src/storage/serviceRepositories.ts src/storage/serviceRepositories.test.ts
git commit -m "feat: add Plotter service repositories"
```

---

### Task 10: Cut the Browser Runtime Over to the Service

**Files:**
- Modify: `src/storage/appRepository.ts`
- Modify: `src/storage/appRepository.test.ts`
- Create: `src/storage/serviceRealtime.ts`
- Create: `src/storage/serviceRealtime.test.ts`
- Modify: `src/hooks/useTripData.ts`
- Modify: `src/hooks/useTripData.test.tsx`
- Modify: `src/hooks/useTripWorkspace.ts`
- Modify: `src/hooks/useTripWorkspace.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**

```ts
export type ServiceRealtimeSubscriptions = {
  subscribeToDirectory(onInvalidate: (revision: number) => void): () => void;
  subscribeToTrip(tripId: string, onInvalidate: (revision: number) => void): () => void;
  reconcile(): Promise<void>;
};
```

- [ ] **Step 1: Write failing selection and coherent-load tests**

Normal mode and `e2e-service` must create service repositories without checking Supabase configuration or anonymous auth. Unit-only injected repositories remain supported. `useTripData` must prefer `loadSnapshot()` and publish destinations, legs, and activities together.

- [ ] **Step 2: Write failing synchronization and conflict tests**

Cover a newer directory event, newer selected-trip event, duplicate/older events, reconnect, `visibilitychange`, missed-event reconciliation, and stale mutation. Assert optimistic state is discarded, canonical data reloads once, and the user sees: `Another device changed this trip. Plotter reloaded the latest version.`

- [ ] **Step 3: Implement runtime selection and SSE invalidation**

Remove active browser Supabase initialization. Create the API client from `import.meta.env.BASE_URL`, use `EventSource` at the hosted base path, compare revisions before reloading, and reconcile after reconnect or return to visibility. Do not fall back to Dexie on any network or readiness error.

- [ ] **Step 4: Implement availability and conflict UI behavior**

Initial `503` or network failure displays `Shared trip storage is unavailable.` with the existing retry affordance. Conflict handling rolls back pending optimistic recipes through the current repository-generation mechanism before reloading.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- src/storage/appRepository.test.ts src/storage/serviceRealtime.test.ts src/hooks/useTripData.test.tsx src/hooks/useTripWorkspace.test.tsx src/App.test.tsx
npm run lint
git add src/storage/appRepository.ts src/storage/appRepository.test.ts src/storage/serviceRealtime.ts src/storage/serviceRealtime.test.ts src/hooks/useTripData.ts src/hooks/useTripData.test.tsx src/hooks/useTripWorkspace.ts src/hooks/useTripWorkspace.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: use shared local trip storage"
```

---

### Task 11: Cut Provider Clients and the Trip CLI Over to HTTP

**Files:**
- Modify: `src/services/linkPreviewClient.ts`
- Modify: `src/services/linkPreviewClient.test.ts`
- Modify: `src/services/webImageSearchClient.ts`
- Modify: `src/services/webImageSearchClient.test.ts`
- Modify: `src/cli/trip.ts`
- Modify: existing CLI tests

**Interfaces:**

```ts
export function resolvePlotterBaseUrl(environment: NodeJS.ProcessEnv): URL;
```

- [ ] **Step 1: Write failing provider-client and CLI tests**

Require provider clients to call `/api/v1/link-preview` and `/api/v1/image-search`. Require the CLI to default to `http://127.0.0.1/plotter/`, accept `PLOTTER_BASE_URL`, preserve every command/output contract, and show a concise service-unavailable error without referring to Supabase.

- [ ] **Step 2: Reuse service repositories from the CLI**

Instantiate the shared API client and HTTP repositories, then pass them into the existing `TripDataService`. Keep route calculation and domain command behavior shared. Do not use the local-web internal assigned port; normal CLI requests go through the stable loopback `/plotter/` route.

- [ ] **Step 3: Switch browser provider calls**

Use the same base-path-safe API client. Keep deterministic injected fakes for unit tests; Playwright receives deterministic server-side provider fakes from its disposable service.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- src/services/linkPreviewClient.test.ts src/services/webImageSearchClient.test.ts src/cli
npm run trip -- help
git add src/services/linkPreviewClient.ts src/services/linkPreviewClient.test.ts src/services/webImageSearchClient.ts src/services/webImageSearchClient.test.ts src/cli
git commit -m "feat: route Plotter clients through the service"
```

---

### Task 12: Add Portable Backup and Explicit Restore

**Files:**
- Create: `server/portableBackup.ts`
- Create: `server/portableBackup.test.ts`
- Modify: `server/http.ts`
- Modify: `server/http.test.ts`
- Modify: `src/cli/trip.ts`
- Modify: existing CLI tests

**Interfaces:**

```ts
export type PortableBackupManifest = {
  formatVersion: 1;
  schemaVersion: number;
  createdAt: string;
  directoryRevision: number;
  tripRevisions: Record<string, number>;
  files: Array<{ path: string; byteCount: number; sha256: string }>;
};
```

- [ ] **Step 1: Write failing backup and restore tests**

Assert a portable backup contains one validated online database copy, the active media tree, and a deterministic manifest. Reject missing, extra, changed, traversing, or duplicate archive paths. Restore must require the selected backup ID plus an exact confirmation token and must preserve current canonical state under a recovery name first.

- [ ] **Step 2: Implement backup creation and inspection**

Stream archive creation without loading media into memory. Exclude automatic backups, trash, imports, `.env`, and credentials. Hash every included file and expose create/list/inspect operations through bounded CLI-only API routes.

- [ ] **Step 3: Implement validated restore**

Extract into a contained staging directory, validate every manifest entry and SQLite gate, create a named recovery backup, stop accepting writes, atomically promote database and media, reopen readiness, and emit directory plus trip invalidations. Any failure leaves canonical state intact.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run --config vitest.server.config.ts server/portableBackup.test.ts server/http.test.ts
npm test -- src/cli
git add server/portableBackup.ts server/portableBackup.test.ts server/http.ts server/http.test.ts src/cli
git commit -m "feat: add Plotter backup and restore"
```

---

### Task 13: Make Playwright Own Disposable Service Storage

**Files:**
- Create: `tests/start-service.ts`
- Create: `tests/service-storage.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`
- Modify: `AGENTS.md`
- Modify: `vite.config.ts`
- Modify: existing `tests/*.spec.ts`

**Interfaces:**

```ts
export type E2eService = {
  baseUrl: string;
  dataDir: string;
  stop(): Promise<void>;
};
```

- [ ] **Step 1: Add a failing fresh-browser service test**

Start the service on a dedicated loopback test port with `tests/.tmp/e2e-user-data`, seed through `/api/v1`, open Vite with `VITE_TRIP_STORAGE=e2e-service`, and prove data appears in a fresh browser context with no IndexedDB databases.

- [ ] **Step 2: Replace the IndexedDB E2E harness**

Have Playwright launch one disposable service and Vite on `127.0.0.1:5174`; proxy `/api` to the disposable service and rewrite the hosted base path correctly. Delete the test data directory only inside the test lifecycle after validating its exact contained path. Update AGENTS.md so `npm run dev:e2e` is service-backed.

- [ ] **Step 3: Add service acceptance coverage**

Use two browser contexts to prove cross-page invalidation. Force a same-revision race to prove one `409`. Cover reconnect, visibility reconciliation, service unavailability, media upload/display/delete, link preview and image-search fakes, browser writes, CLI writes, and existing trip workflows.

- [ ] **Step 4: Verify rendered behavior**

```bash
npm run test:e2e
npx playwright test tests/service-storage.spec.ts --repeat-each=3 --workers=1
```

Expected: all tests pass; inspection of traces or screenshots confirms the unavailable and conflict messages render within the existing shell without clipped controls or broken map interactions.

- [ ] **Step 5: Commit the E2E cutover**

```bash
git add tests playwright.config.ts package.json package-lock.json AGENTS.md vite.config.ts
git commit -m "test: run Plotter against disposable service storage"
```

---

### Task 14: Build the Standard Local-Web Service Release

**Files:**
- Modify: `local-web.json`
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Target manifest:**

```json
{
  "schemaVersion": 1,
  "id": "plotter",
  "title": "Plotter",
  "route": "/plotter",
  "kind": "service",
  "build": {
    "commands": [["npm", "ci"], ["npm", "run", "build"]],
    "output": "release",
    "release": { "dist": "public", "server-dist": "server" },
    "environment": ["VITE_PUBLIC_BASE_PATH", "VITE_MAPTILER_API_KEY", "VITE_OPENROUTESERVICE_API_KEY"]
  },
  "healthPath": "/plotter/healthz",
  "service": {
    "module": "server/service.mjs",
    "healthPath": "/healthz",
    "frontend": "public",
    "proxy": ["/api"],
    "startCommand": ["/usr/bin/env", "node", "{release}/server/service.mjs", "--port", "{port}", "--data-dir", "{repository}/user-data", "--env-file", "{repository}/.env"]
  },
  "home": { "icon": "route", "accent": "#D9467A" },
  "platform": { "contractVersion": 1, "templateVersion": 1, "uiVersion": "0.5.2", "capabilities": [] }
}
```

- [ ] **Step 1: Write failing release-shape checks**

Extend existing manifest/config tests to require the exact service shape, exclude Supabase and SERPAPI from browser build variables, assert the built browser assets contain no Supabase endpoint or key, assert release maps `dist` to `public` and `server-dist` to `server`, and verify Vite development proxy rewrites `/plotter/api` to the local service while production uses same-origin URLs.

- [ ] **Step 2: Implement the release and documentation**

Build both artifacts, assemble `release/`, document `npm run dev` plus `npm run dev:service`, `PLOTTER_BASE_URL`, local data layout, backup/restore, migration gates, and the rule that live activation is separate. Do not copy a local-web template into the repository.

- [ ] **Step 3: Run app-local and structural checks without activation**

Resolve the repository launcher exactly as required by `local-web-app-development`, then run:

```bash
npm run check
npm run test:e2e
local-web doctor
local-web app check
```

Expected: every command passes. Do not run `local-web app activate --apply`.

- [ ] **Step 4: Commit the service release**

```bash
git add local-web.json package.json package-lock.json vite.config.ts .env.example README.md
git commit -m "feat: package Plotter as a local service"
```

---

### Task 15: Build the Lossless Supabase Migration

**Files:**
- Create: `scripts/supabase-migration/source.ts`
- Create: `scripts/supabase-migration/source.test.ts`
- Create: `scripts/supabase-migration/archive.ts`
- Create: `scripts/supabase-migration/archive.test.ts`
- Create: `scripts/supabase-migration/materialize.ts`
- Create: `scripts/supabase-migration/materialize.test.ts`
- Create: `scripts/supabase-migration/reconcile.ts`
- Create: `scripts/supabase-migration/reconcile.test.ts`
- Create: `scripts/supabase-migration/cli.ts`
- Create: `scripts/supabase-migration/cli.test.ts`
- Create: `scripts/supabase-migration/fixtures/complete-project.json`
- Create: `scripts/migrate-supabase.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**

```ts
export type MigrationMode = 'dry-run' | 'apply';

export type SourceFingerprint = {
  schemaSha256: string;
  tableInventories: Record<string, { rowCount: number; idsSha256: string; rowsSha256: string }>;
  storageInventorySha256: string;
};

export type ReconciliationReport = {
  passed: boolean;
  source: SourceFingerprint;
  destinationCounts: Record<string, number>;
  preservedSourceIds: Record<string, boolean>;
  orphanClassifications: Array<{ kind: string; sourceId: string; disposition: string }>;
  media: { objectCount: number; byteCount: number; hashesMatch: boolean };
  failures: Array<{ gate: string; message: string }>;
};
```

- [ ] **Step 1: Write failing read-only source-client tests**

Use a strict fake that records every Supabase method. Page `trips`, `trip_members`, `destinations`, `route_legs`, `activities`, and `media_assets` until a short page; recursively page every `trip-media` prefix; download every object; detect duplicate paths; and fail on truncation. Assert the complete call log contains only select/list/download and never a mutation method.

- [ ] **Step 2: Implement lossless raw archive creation**

Require `PLOTTER_SUPABASE_URL` and `PLOTTER_SUPABASE_SECRET_KEY` at execution time with browser auth persistence disabled. Verify the Supabase CLI is authenticated, linked to the same project reference, and able to use its separately contained database credential before invoking read-only schema and COPY data dumps into a timestamped staging directory. Write canonical per-table JSON, source metadata, object inventory, downloaded bytes, and SHA-256 values. Use `--linked`, explicit `--schema public`, `--data-only`, and `--use-copy` where applicable. Logs contain counts and fingerprints only.

- [ ] **Step 3: Write failing schema and reconciliation tests**

Cover every known table/column, a new unknown table, a new unknown column, exact count/ID preservation, invalid foreign keys, domain-deserialization failure, missing referenced media, changed bytes, unreferenced objects, orphan rows, pagination boundaries, repeated identical imports, and changed source fingerprints. Unknown schema and unexplained loss must set `passed: false`; unreferenced objects pass only when preserved and classified.

- [ ] **Step 4: Implement temporary materialization**

Create a temporary SQLite database and media tree on the same filesystem as canonical state. Preserve active IDs/timestamps, create provenance for owner and source storage fields, and retain unsupported/obsolete records in the raw archive. Run integrity, foreign-key, count, ID, domain, media byte, and hash gates before producing the report.

- [ ] **Step 5: Implement the second source fingerprint and atomic promotion**

After staging, inventory source tables and Storage again. Require an identical fingerprint. In `dry-run`, retain staging and stop before canonical mutation. In `apply`, require `--confirm-source-fingerprint` to equal the report's complete SHA-256 fingerprint, create a named pre-import backup, close the service or acquire its exclusive maintenance lock, atomically rename the database and media tree, and reopen/validate canonical state. A failure leaves prior canonical paths intact.

- [ ] **Step 6: Verify migration fixtures and retry behavior**

```bash
npx vitest run --config vitest.server.config.ts scripts/supabase-migration
npm run migrate:supabase -- --help
npm run migrate:supabase -- --dry-run --fixture scripts/supabase-migration/fixtures/complete-project.json
```

Expected: synthetic dry run passes; a second identical run yields the same fingerprint and no duplicate IDs or media; negative fixtures stop before promotion.

- [ ] **Step 7: Commit migration tooling**

```bash
git add scripts package.json package-lock.json README.md
git commit -m "feat: add lossless Supabase migration"
```

---

### Task 16: Review and Integrate the Implementation Without Activating It

**Files:**
- Review: every file changed in Tasks 1-15
- Modify: `docs/superpowers/specs/2026-08-17-local-storage-migration-design.md` only to record verified implementation evidence

- [ ] **Step 1: Request whole-branch code review**

Use `superpowers:requesting-code-review`. Review the complete base-to-head diff for data loss, security boundary errors, direct SQLite access outside the service, missing repository operations, revision races, media rollback, backup ordering, migration mutability, archive completeness, and local-web contract drift. Resolve every substantive finding with focused tests and commits.

- [ ] **Step 2: Run the full clean-worktree verification matrix**

```bash
npm ci
npm run check
npm run test:e2e
npx vitest run --config vitest.server.config.ts scripts/supabase-migration
local-web doctor
local-web app check
git diff --check
git status --short
```

Expected: all checks pass and only intentionally tracked implementation files differ from the base branch. No live Supabase request has occurred.

- [ ] **Step 3: Merge through the repository's normal branch workflow**

Use `superpowers:finishing-a-development-branch`. Ensure focused commits are reviewed, then merge to clean canonical `main` without running activation. Because the managed post-commit hook may deploy existing registered behavior, inspect its output and verify the currently served Plotter remains healthy; do not claim the new service is active.

- [ ] **Step 4: Stop for live migration authorization**

Report the implementation commit range, full verification evidence, exact source-read command, required ignored environment names, archive destination, and expected non-mutating Supabase operations. Request explicit approval to perform the live read-only dry run. Do not continue into Task 17 in the same turn without that approval.

---

### Task 17: Run and Reconcile the Live Supabase Dry Run

**Operational gate:** This task starts only after explicit approval for live, project-wide, read-only Supabase access.

- [ ] **Step 1: Verify execution state and credential containment**

Require clean committed `main`, the intended linked Supabase project, ignored credential file, writable contained import directory, enough free disk space for two complete copies, and no credential in shell history, Git, process output, or Vite variables. Record only the project reference, timestamps, and redacted tool versions.

- [ ] **Step 2: Run the dry run**

```bash
npm run migrate:supabase -- --dry-run --data-dir user-data
```

Expected: the command writes one timestamped archive/staging directory and reconciliation reports, performs two matching read-only source inventories, and does not promote canonical state.

- [ ] **Step 3: Independently inspect the report**

Verify exact row counts and ID sets for all six known tables, all discovered schema objects are classified, every Storage object is present with matching byte count and SHA-256, all orphans/unreferenced objects have dispositions, database integrity and foreign keys pass, and every trip deserializes. Compare the tool's logged operation audit against the read-only allowlist.

- [ ] **Step 4: Stop for import authorization**

Present the report path, source fingerprint, per-table counts, object/byte totals, classifications, gate results, and any warnings. If any gate fails, stop with canonical state untouched. If all pass, request explicit approval for a no-edit maintenance window and live `apply` promotion. Do not infer approval from the earlier dry-run authorization.

---

### Task 18: Promote, Activate, and Verify the Local Canonical Store

**Operational gates:** This task requires separate explicit approvals for import promotion and for `local-web app activate --apply`.

- [ ] **Step 1: Enter the approved maintenance window and recheck source state**

Confirm Plotter is not being edited, the dry-run fingerprint is still current, canonical `main` is clean, and the current static Supabase-backed release is healthy. If the fingerprint changed, leave maintenance mode and repeat Task 17 rather than applying stale staging.

- [ ] **Step 2: Apply the verified import**

```bash
read -r PLOTTER_APPROVED_SOURCE_FINGERPRINT
npm run migrate:supabase -- --apply --data-dir user-data --confirm-source-fingerprint "$PLOTTER_APPROVED_SOURCE_FINGERPRINT"
unset PLOTTER_APPROVED_SOURCE_FINGERPRINT
```

At the prompt, paste the exact fingerprint presented and approved in Task 17. Expected: named pre-import backup exists, promotion is atomic, canonical SQLite/media pass all gates, and Supabase remains unchanged.

- [ ] **Step 3: Verify canonical data before activation**

Run service integration checks against canonical data; compare all report counts/hashes again; open a fresh browser context with no IndexedDB or Supabase session; inspect every trip plus representative route geometry, activities, links, destination media, and activity media. Exercise a reversible browser write, CLI write, backup creation, and cross-device refresh, then retain the resulting canonical state unless the user requests restoration.

- [ ] **Step 4: Preview activation and stop**

From clean committed `main`, use the resolved local-web launcher:

```bash
local-web app activate
```

Present the previewed static-to-service command migration, release revision, health path, start command shape, rollback checkpoint, and all canonical-data evidence. Request explicit approval to apply. Do not run with `--apply` yet.

- [ ] **Step 5: Apply the separately approved activation**

```bash
local-web app activate --apply
```

Do not edit registry, Caddy, ports, or LaunchAgents directly. If the platform refuses activation, preserve the current registration and resolve the reported repository/manifest condition before seeking approval again.

- [ ] **Step 6: Prove live operation**

Run local-web status, served System Index registry readback, real `/plotter/healthz`, app shell load, and `/plotter/api/v1/trips`. Verify every trip and representative media from a fresh browser, then perform a browser write, CLI write, second-device invalidation, backup creation, and restore-to-staging validation. Capture exact live revision and health evidence.

- [ ] **Step 7: Close the maintenance window without retiring Supabase**

Report the local canonical revision, imported counts/hashes, live release, browser/CLI/cross-device evidence, backup locations, and rollback procedure. Keep the Supabase project, schema, bucket, credentials, dependency, and raw archive intact through the separately chosen acceptance period. Supabase retirement requires a new design and explicit approval.

---

## Completion Evidence

The work is complete only when all automated, rendered, migration, and platform checks pass; every source record or object is active or losslessly classified; live service activation has explicit approval and verified readback; browser and CLI writes share one revisioned store; and Supabase remains untouched and recoverable. Record command outputs, commit IDs, source fingerprint, reconciliation report path, canonical database revision, live release revision, and rollback checkpoint in the final handoff.
