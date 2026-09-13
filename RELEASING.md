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

For the one-time npm bootstrap, run
`npx --yes @agilesyndrome/cf-genai-cli@0.1.3 publish:first` and complete npm's
interactive account/2FA prompts. Then configure npm Trusted Publishing for
organization `agilesyndrome`, this repository, workflow `publish.yml`, and the
`npm publish` action. Later releases use GitHub OIDC and require no npm token.
