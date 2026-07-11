# Plotter README Design

## Purpose

Create a practical repository README that helps a developer or coding agent understand Plotter, configure it safely, run it locally, and find the correct operational documentation without reading the source tree first.

## Audience

The primary audience is a developer or agent working in this private repository. Product positioning is secondary to accurate setup and workflow guidance.

## Structure

The README will contain these sections in order:

1. A concise description of Plotter and its current capabilities.
2. Prerequisites.
3. Installation and environment configuration.
4. Development workflows, clearly separating normal Supabase-backed development from isolated E2E storage.
5. A command reference derived from `package.json`.
6. A concise architecture and repository-layout guide.
7. Supabase and edge-function notes.
8. A trip CLI introduction that links to `docs/trip-cli.md` instead of duplicating it.
9. Testing and verification commands.
10. Compatibility notes for intentionally retained legacy storage identifiers.

## Content Rules

- Use the repository as the source of truth for commands, environment variables, and paths.
- Keep setup instructions copyable and ordered.
- Explain which external services each environment variable supports without documenting secret values.
- State that `npm run dev` uses normal application storage and `npm run dev:e2e` uses isolated local E2E storage.
- Explain that `npm run test:e2e` owns and stops its disposable server.
- Link to detailed documentation rather than repeating the trip CLI contract.
- Avoid roadmap claims, marketing language, contribution boilerplate, deployment instructions, and licensing claims that are not represented in the repository.
- Mention that the IndexedDB name, legacy preference keys, and legacy CLI session path remain for data migration compatibility.

## Verification

- Confirm every listed npm command exists in `package.json`.
- Confirm every listed environment variable exists in `.env.example` or is directly used by the documented workflow.
- Confirm all relative links resolve.
- Run a Markdown-oriented source audit for stale `world-tour` branding, allowing only the intentional compatibility note.
- Run `npm run lint` because the README is part of the repository-wide lint scope.

## Success Criteria

A developer with Node.js and npm can clone the repository, create `.env`, start Plotter, understand the storage modes, run the relevant checks, and discover the trip CLI documentation from the README alone.
