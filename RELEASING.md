# Releasing

Dependabot PRs for `@actual-app/api` and patch updates are auto-merged after CI passes; other
updates need a review. Approving any PR as the repo owner enables auto-merge on it, so it
squash-merges once CI is green. A push to `main` that changes the image contents (code, `Dockerfile` or
runtime dependencies) runs CI again and, if it passes, creates a new patch release (`vX.Y.Z` git tag), and the Docker image is published to
`rodriguestiago0/actualtasks` with the tags `latest`, `X.Y.Z`, `X.Y` and `sha-<commit>`. Republishing an older tag by hand
(**Docker Image Publish → Run workflow**) leaves `latest` where it is.

The git tag is the version source of truth. The `version` in `package.json` is not updated and
doesn't match the released version.

Setup:

- A fine-grained PAT (Contents + Pull requests: read/write) saved as `RELEASE_TOKEN` both as an
  **Actions** secret (owner-approval auto-merge) and as a **Dependabot** secret (Dependabot
  auto-merge)
- "Allow auto-merge" enabled in the repo settings
- The `CI` checks required on `main`
