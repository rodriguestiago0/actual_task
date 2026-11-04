# Releasing

Dependabot PRs for `@actual-app/api` are approved and auto-merged once CI passes; every other
update needs a review. Approving any PR as the repo owner enables auto-merge on it, so it
squash-merges once CI is green.

A push to `main` that changes the image contents (code, `Dockerfile`, `package.json` or runtime
dependencies) since the last `v*` tag runs CI again and, if it passes, creates a new patch release
(`vX.Y.Z` git tag). The Docker image is then published to `rodriguestiago0/actualtasks` with the
tags `latest`, `X.Y.Z`, `X.Y` and `sha-<commit>`. Comparing with the last tag means a release run
that was cancelled or failed is picked up by the next one. Dev-only dependency updates and
lockfile metadata don't count as changes.

The GitHub release is created before the image is pushed. If publishing fails, the release exists
without an image: rerun the failed **Docker Image Publish** job, or run **Docker Image Publish →
Run workflow** with that tag. Republishing a tag by hand only moves `X.Y.Z` and `sha-<commit>`,
never `latest` or `X.Y`, so republishing an old tag can't move them back. A manual run of
**Release** releases `main` even when nothing changed.

The git tag is the version source of truth. The `version` in `package.json` is not updated and
doesn't match the released version.

Setup:

- A fine-grained PAT (Contents + Pull requests: read/write) saved as `RELEASE_TOKEN` both as an
  **Actions** secret (owner-approval auto-merge) and as a **Dependabot** secret (Dependabot
  auto-merge). It's used instead of `GITHUB_TOKEN` so the merge to `main` triggers the release.
- `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` Actions secrets, to push the image
- "Allow auto-merge" enabled in the repo settings
- The `CI` checks required on `main`
