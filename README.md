# BePartnerLabs Centralized Workflows

Reusable GitHub Actions workflows for all BePartnerLabs repositories.

## Available Workflows

| Workflow | Purpose |
|----------|---------|
| `release-drafter.yml` | Creates/updates a draft GitHub Release on every push to main using Release Drafter (pinned SHA) |
| `labeler.yml` | Applies semantic labels to PRs based on branch prefix and PR title (`feat/`, `fix/`, etc.) |

## Usage

Call from any BePartnerLabs repo:

```yaml
# .github/workflows/release-draft.yml
jobs:
  release:
    uses: BePartnerLabs/centralized-workflows/.github/workflows/release-drafter.yml@main

# .github/workflows/labeler.yml
jobs:
  label:
    uses: BePartnerLabs/centralized-workflows/.github/workflows/labeler.yml@main
```

## Release Drafter Config

The `release-drafter.yml` workflow reads `.github/release-drafter.yml` from the **calling repo's** default `.github` org config (`BePartnerLabs/.github`). Categories and version resolution are defined there.

## Updating the Pinned SHA

The `release-drafter/release-drafter` action is pinned to a commit SHA. To update:

1. Check the latest release at https://github.com/release-drafter/release-drafter/releases
2. Get the SHA: `gh api repos/release-drafter/release-drafter/git/ref/tags/vX | jq -r '.object.sha'`
3. Update the SHA in `.github/workflows/release-drafter.yml`
4. Commit with `chore: bump release-drafter SHA to vX`
