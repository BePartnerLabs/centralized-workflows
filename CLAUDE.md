# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Purpose

Reusable GitHub Actions workflows for all BePartnerLabs projects. Called via:

```yaml
uses: BePartnerLabs/centralized-workflows/.github/workflows/<name>.yml@v1
```

## Workflows

| File | Purpose |
|---|---|
| `setup.yml` | Install & cache pnpm dependencies — outputs `cache-key` and `store-path` |
| `lint.yml` | Run `pnpm lint` |
| `test.yml` | Run unit tests via configurable `test-command` input |
| `migrate-payload.yml` | Pull Vercel env vars for `environment` and run `pnpm payload migrate` — Payload projects only |
| `deploy-vercel.yml` | `vercel deploy` (optionally `--prod`) — generic, no Payload dependency, callable directly by non-Payload projects |
| `release-drafter.yml` | Auto-draft releases from PR titles |
| `labeler.yml` | Auto-label PRs |
| `tag-sync.yml` | Moves the major version tag (e.g. `v1`) when a release is published |

### Deploying a Payload + Vercel project

Wire one caller workflow with two triggers (push to `main` → preview, `release: published` → production), computing `environment`/`prod` from `github.event_name`:

```yaml
on:
  push: { branches: [main] }
  release: { types: [published] }

jobs:
  migrate:
    uses: BePartnerLabs/centralized-workflows/.github/workflows/migrate-payload.yml@v1
    with:
      environment: ${{ github.event_name == 'release' && 'production' || 'preview' }}
    secrets: inherit

  deploy:
    needs: migrate
    uses: BePartnerLabs/centralized-workflows/.github/workflows/deploy-vercel.yml@v1
    with:
      environment: ${{ github.event_name == 'release' && 'production' || 'preview' }}
      prod: ${{ github.event_name == 'release' }}
    secrets: inherit
```

A project with no Payload/DB migrations calls `deploy-vercel.yml` alone, skipping `migrate-payload.yml`.

## Release & tagging flow

**Never move version tags manually.** The flow is:

1. Merge changes to `main` — release-drafter auto-updates the draft release
2. When ready to ship: publish the draft release on GitHub (`gh release edit <tag> --draft=false`)
3. `tag-sync.yml` fires on `release: released` and moves the `v1` major tag to the new commit automatically

All consumer repos pin to `@v1` — they pick up changes as soon as the tag moves.
