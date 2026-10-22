# Releasing

When Dependabot bumps `@actual-app/api`, the PR is auto-merged after CI passes. A new patch release
(`vX.Y.Z` git tag) is then created, and the Docker image is published to
`rodriguestiago0/actualtasks` with the tags `latest`, `X.Y.Z`, `X.Y` and `sha-<commit>`.

The git tag is the version source of truth. The `version` in `package.json` is not updated and
doesn't match the released version.

Setup:

- A fine-grained PAT (Contents + Pull requests: read/write) saved as the **Dependabot** secret
  `RELEASE_TOKEN`
- "Allow auto-merge" enabled in the repo settings
- The `CI` checks required on `main`
