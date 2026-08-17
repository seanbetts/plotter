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

Copy `.env.example` to the ignored `.env` only when development needs the map
keys or the service-side `SERPAPI_API_KEY`. Keep the file readable only by the
account that runs Plotter (for example, `chmod 600 .env`); never use a `VITE_`
prefix for service or migration secrets.

The service receives `user-data/` from the local-web manifest. It is Git-ignored
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

The service validates that this directory remains inside the canonical
repository. Do not point it at another path or write SQLite/media files from the
browser or CLI.

## CLI, backups, and recovery

The CLI targets the hosted route by default. For a direct development service,
set its base URL explicitly:

```bash
PLOTTER_BASE_URL=http://127.0.0.1:5175/ npm run trip -- list
```

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

The migration executable is a separate maintenance operation. Its required
sequence is a dry-run first, for example
`npm run migrate:supabase -- --dry-run --data-dir user-data`, followed by
review of the retained report and source fingerprint. An `--apply` promotion
requires a separately approved maintenance window and the reviewed value in
`--confirm-source-fingerprint`; do not infer approval from a dry run. The source
stays read-only and remains the rollback source; migration credentials are
runtime-only `PLOTTER_*` values, never Vite variables or release contents. No
migration or import is performed by `npm run build`, the service, or local-web
checks.

Local-web activation is also separate from implementation verification. First
run the app-local checks and `local-web app doctor`/`local-web app check` on the
committed release. Only a separately authorised activation preview and then
apply may register the service, assign its port, deploy it, or change host
state. Do not edit the host registry, Caddy, LaunchAgents, or a service port by
hand.
