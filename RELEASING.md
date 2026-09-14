# Releasing

The repository uses `@agilesyndrome/cf-genai-cli` for local project and release
automation. Install Node.js 24 or newer, then run from this directory:

```sh
npx --yes @agilesyndrome/cf-genai-cli@0.1.3 check
npx --yes @agilesyndrome/cf-genai-cli@0.1.3 test
npx --yes @agilesyndrome/cf-genai-cli@0.1.3 release
```

`release` requires a clean tree, bumps the patch version when the current
version or tag is already consumed, commits the package metadata, creates the
matching `v<version>` tag, and pushes both `main` and the tag. The tag starts
the GitHub Actions publish workflow.

For the one-time npm bootstrap, authenticate locally and publish with
provenance disabled (local shells do not have a GitHub OIDC provider):

```sh
npm login --registry=https://registry.npmjs.org
npm run publish:first
```

`npm publish` will prompt for the account's 2FA one-time password when needed.
The script's `--provenance=false` override is intentional: local npm cannot
create GitHub provenance, while the GitHub Actions workflow below enables it
for later releases. After the first publish, configure npm Trusted Publishing
for organization `agilesyndrome`, this repository, workflow `publish.yml`, and
the `npm publish` action. Later releases use GitHub OIDC and require no npm
token.
