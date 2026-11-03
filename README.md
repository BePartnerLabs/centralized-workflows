# BePartnerLabs Centralized Workflows

Reusable GitHub Actions workflows for all BePartnerLabs repositories.

## Available Workflows

| Workflow | Purpose |
|----------|---------|
| `release-drafter.yml` | Creates/updates a draft GitHub Release on every push to main using Release Drafter (pinned SHA) |
| `labeler.yml` | Applies semantic labels to PRs based on branch prefix and PR title (`feat/`, `fix/`, etc.) |
| `release-to-project.yml` | Moves the stories closed by a release's PRs to "Released" in a GitHub Project v2 and comments `Released in <tag>`. Optional `bump-issue` mode sets Work type = Bump |

See `examples/` for copy-pasteable callers.

## Usage

Call from any BePartnerLabs repo:

```yaml
# .github/workflows/release-draft.yml
jobs:
  release:
    uses: BePartnerLabs/centralized-workflows/.github/workflows/release-drafter.yml@v1
    # with:
    #   commitish: master   # only if the default branch isn't main

# .github/workflows/labeler.yml
jobs:
  label:
    uses: BePartnerLabs/centralized-workflows/.github/workflows/labeler.yml@v1
```

## Release to Project

```yaml
jobs:
  released:
    uses: BePartnerLabs/centralized-workflows/.github/workflows/release-to-project.yml@v1
    with:
      project-owner: BePartnerLabs
      project-number: 5
      tag: v1.2.3
      # status-field: Status        (default)
      # released-option: Released   (default)
    secrets:
      project-token: ${{ secrets.PROJECT_TOKEN }}
```

- **No hardcoded IDs.** The project (from `project-owner` + `project-number`), the status field and its option are looked up by name on every run, so a recreated or copied project keeps working.
- **The script lives here.** The job checks out this repo at `job.workflow_sha` (the same commit as the `@v1` the caller resolved) and runs `scripts/release-to-project.mjs`. Callers don't carry a copy.
- **First release.** With no earlier published release, it scans the whole history reachable from the tag.
- **`project-token`.** `github.token` can't reach organization projects. Fine-grained PAT: Contents read, Issues read/write, Pull requests read, Projects read/write on the project's owner.
- **Bump mode.** `bump-issue: <n>` (ignores `tag`) sets `work-type-field`/`bump-option` (default `Work type`/`Bump`), and `site-field`/`site-option` when `site-option` is given.

Full caller with the `workflow_run` trigger after Deploy: `examples/release-to-project.yml`. Script tests: `node --test scripts/`.

## Release Drafter Config

The `release-drafter.yml` workflow reads `.github/release-drafter.yml` from the **calling repo's** default `.github` org config (`BePartnerLabs/.github`). Categories and version resolution are defined there.

## Updating the Pinned SHA

The `release-drafter/release-drafter` action is pinned to a commit SHA. To update:

1. Check the latest release at https://github.com/release-drafter/release-drafter/releases
2. Get the SHA: `gh api repos/release-drafter/release-drafter/git/ref/tags/vX | jq -r '.object.sha'`
3. Update the SHA in `.github/workflows/release-drafter.yml`
4. Commit with `chore: bump release-drafter SHA to vX`
