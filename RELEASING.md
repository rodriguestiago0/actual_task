# Releasing

Dependabot PRs for `@actual-app/api` and patch updates are auto-merged after CI passes; other
updates need a review. A push to `main` that changes the image contents (code, `Dockerfile` or
runtime dependencies) creates a new patch release (`vX.Y.Z` git tag), and the Docker image is published to
`rodriguestiago0/actualtasks` with the tags `latest`, `X.Y.Z`, `X.Y` and `sha-<commit>`.

The git tag is the version source of truth. The `version` in `package.json` is not updated and
doesn't match the released version.

Setup:

- A fine-grained PAT (Contents + Pull requests: read/write) saved as the **Dependabot** secret
  `RELEASE_TOKEN`
- "Allow auto-merge" enabled in the repo settings
- The `CI` checks required on `main`
