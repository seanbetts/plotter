# Plotter

Plotter is a local-network trip-planning service. Its browser, command-line
client, and hosted route all use the same loopback Node service and the same
repository-backed SQLite data.

## Development

Use two terminals for normal development. The Vite frontend remains loopback
only, while the companion service owns the local data and provider secrets:

```bash
npm run dev:service
npm run dev
```

`npm run dev:service` listens on `127.0.0.1:5175`; Vite proxies its API path
there. With the hosted base path (`VITE_PUBLIC_BASE_PATH=/plotter/`), that is
`/plotter/api` and Vite rewrites it to the service's `/api`. Production browser
requests are same-origin under `/plotter/api`; no browser bundle needs a service
host, Supabase URL, Supabase key, or SerpApi key.

`npm run dev:e2e` is different: it starts only the disposable service-backed
environment used by the end-to-end harness. Do not use it with personal data.

Build a local-web release with `npm run build`. It produces `dist/` and
`server-dist/`, then composes the immutable `release/public/` and
`release/server/` directories. Runtime data and `.env` are never copied into
that release.

## Environment and service data

`.env` is optional: `npm run dev:service` and the hosted service tolerate its
absence, while a present but unreadable file stops service startup. The
development command uses `.env` by default; set `PLOTTER_SERVICE_ENV_FILE` to
an alternate optional file when an isolated development run needs one. The
`VITE_MAPTILER_API_KEY` and `VITE_OPENROUTESERVICE_API_KEY` values are read by
Vite when development or a browser release starts building and are exposed to
browser code; restart Vite after changing them. `SERPAPI_API_KEY` is different:
it is read only by the running service and is never included in a browser
bundle. All three provider values may be left unset when their feature is not
needed. Keep `.env` readable only by the account that runs Plotter (for example,
`chmod 600 .env`); never use a `VITE_` prefix for service or migration secrets.

On the Mac, the service receives `user-data/` from the local-web manifest. It is Git-ignored
and must stay owned by the service account; use restrictive owner-only
permissions (for example, `chmod 700 user-data`) rather than sharing it through
the release directory. Its normal layout is:

```text
user-data/
  plotter.sqlite3
  backups/
  media/
  trash/
  imports/
```

Mac mode validates that this directory remains inside the selected repository.
An isolated development copy may be used explicitly; production authority comes
from Local Web. Do not write SQLite/media files directly from the browser or CLI.

The NAS recipe selects `--runtime nas-docker`, exact `/state` storage and a
read-only code release at `/app/current`. All trips, uploads, media journals,
automatic/portable backups, trash and maintenance ownership locks stay in that
same durable mount. NAS mode accepts only `/state` and the optional selected
`/run/secrets/plotter.env`; it never adopts repository or legacy data. That secret
file may contain only `SERPAPI_API_KEY`; browser provider keys remain Mac build
inputs. The app accepts public traffic only with the configured canonical HTTPS
Host/Origin and forwarded scheme from the exact configured proxy IP. A local,
body-free readiness check needs no forwarded headers.

`production` declares native Mac build dependencies and a digest-pinned Linux
Node 24 image, including `node:sqlite`. Runtime code is bundled and needs no
runtime npm installation. The Dockerfile builds dependencies only; deployments
mount immutable code, selected state and secrets separately. This source recipe
does not activate or migrate production.

## CLI, backups, and recovery

The CLI queries the installed `local-web app data-target --repository <source-root>`
for the registered production base URL and profile revision. Missing or invalid
metadata and network failures stop the command; there is no implicit localhost,
repository-file or `.env` fallback. Run production commands from the registered
repository. For a direct isolated development service,
set its base URL explicitly:

```bash
PLOTTER_BASE_URL=http://127.0.0.1:5175/ npm run trip -- list
```

`PLOTTER_BASE_URL` is an explicit fixture/development override and bypasses
production metadata. After a NAS handoff, fence old Mac services and use copies
for development. A rollback after NAS writes must preserve the latest complete
NAS store (including media), never reactivate an old Mac snapshot.

The guarded Linux fixture checks proxy rejection, real SQLite/media mutations,
portable backup/restore, and old-code readback of a copied post-write store. Build
the current service and supply a disposable prior committed service bundle:

```sh
npm run build:service
python3 scripts/verify-nas-runtime.py --fixture-harness /path/to/slskd/scripts/test.py --old-service /tmp/prior-release/server/service.mjs
```

It uses only the existing guarded Mac VM, named volumes, a private bridge and
scoped cleanup, with no host mounts or published ports. It never connects to NAS.

Use `npm run trip -- backup-create`, `backup-list`, and
`backup-inspect --backup-id <id>` to manage portable backups. The service also
creates and validates an automatic SQLite backup before an accepted write, and
retains the five newest automatic backups. A portable restore is deliberately
not implicit: inspect the selected backup first, then provide both its ID and
the exact confirmation token:

```bash
npm run trip -- backup-restore --backup-id <id> --confirmation "RESTORE <id>"
```

Restore validates the archive and preserves the current canonical state as a
recovery backup before promotion. There is no automatic merge or fallback over
current data; investigate recovery backups and retry only after review.

## Supabase migration and activation gates

The migration executable is a separate, explicit maintenance operation. Start
with the credential-free synthetic gate:

```bash
npm run migrate:supabase -- --dry-run \
  --fixture scripts/supabase-migration/fixtures/complete-project.json
```

A real source dry-run requires runtime-only `PLOTTER_SUPABASE_URL` and
`PLOTTER_SUPABASE_SECRET_KEY`. The local Supabase CLI must already be
authenticated and linked to the same project reference as the URL. If that
linked CLI does not already hold the database password in native credential
storage, also set the separate `PLOTTER_SUPABASE_DB_PASSWORD`. Never give any
secret variable a `VITE_` prefix or put it in a release. Migration validates
those conditions before issuing read-only public-schema and data-only COPY
dumps.
The JavaScript source pass uses exact, paged `select`, Storage `list`, and
Storage `download` calls only; it disables session persistence, token refresh,
and URL-session detection. Every downloaded object is checked against the
listing byte size when Supabase supplies one; absent legacy size metadata is
preserved, while malformed or contradictory size metadata fails the run.

```bash
npm run migrate:supabase -- --dry-run --data-dir user-data
```

Dry-run retains its private raw archive, SQL/COPY dumps, downloaded object
bytes, materialized candidate, inventory, and reconciliation report under
`imports/`. It does not change `plotter.sqlite3`, `media/`, `backups/`, service
state, or local-web state. Review the report and its complete 64-character
source fingerprint. A second complete source pass must still match before the
run can pass. A changed or failed second pass leaves an explicit failed
`source-stability` report instead of a passing report. CLI output identifies
retained staging with a safe relative label and ID; it does not print absolute
fixture, staging, or data-root paths.

Apply requires a separately approved maintenance window, the stopped Plotter
service, the reviewed fingerprint, and the exact explicit confirmation:

```bash
npm run migrate:supabase -- --apply --data-dir user-data \
  --confirm-source-fingerprint <reviewed-64-character-sha256>
```

The service and apply command contend for the same exclusive data-root
ownership lock. A running service, a newly starting service, or a crash-stale
lock causes the other operation to fail closed; investigate a stale lock before
removing it. Apply creates a named `pre-supabase-import-*` backup and promotes
the validated database/media pair through the same crash-recoverable portable
restore transaction used by normal recovery. The Supabase source remains
read-only and remains an independent rollback source. Repeating the same
fixture does not merge or duplicate IDs or media. Structured destination,
route, activity, and media domain fields are validated recursively before a
candidate can pass reconciliation. Production-supported legacy destination
research is first normalized through the same persisted-row codec used by the
application; the raw source row remains unchanged in the archive, while the
normalized fields are recorded in import provenance and validated recursively
before materialization. Exact raw key allowlists run before that normalization,
so an unknown legacy research, link, book, or media field cannot be silently
discarded from an otherwise promotable candidate.

These commands are implementation and fixture gates only. They do not claim
that a live Supabase project has been read, that personal `user-data/` has been
changed, or that migration has been approved or completed. No migration or
import is performed by `npm run build`, the service, or local-web checks.

Local-web activation is also separate from implementation verification. First
run the app-local checks and `local-web app doctor`/`local-web app check` on the
committed release. Only a separately authorised activation preview and then
apply may register the service, assign its port, deploy it, or change host
state. Do not edit the host registry, Caddy, LaunchAgents, or a service port by
hand.
