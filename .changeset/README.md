# Changesets

Public package behavior changes should include `pnpm changeset`.

Release commits are prepared locally with `pnpm prepare-release` and pushed to `main`.
When no pending changesets exist, `pnpm prepare-release` starts the Changesets prompt first.
The manual release workflow only publishes package versions that are already committed.
