# Tasks: Sonar CI lifecycle-script hardening

## Task 1: Harden the three reported workflow installs

OWNS:
- `test/repo-tooling.test.js`
- `.github/workflows/db-contract.yml`
- `.github/workflows/platform-web-ci.yml`
- `.github/workflows/platform-web-deploy.yml`

What to implement: Add one repo-tooling test that parses all three workflows,
finds each `Install dependencies` step, and requires the exact command
`bun install --frozen-lockfile --ignore-scripts`. Then make only the three
workflow command-line edits needed to satisfy it.

TDD steps:
1. Write the regression test in `test/repo-tooling.test.js`.
2. Run `bun test test/repo-tooling.test.js` and capture the expected failure:
   the existing command is `bun install --frozen-lockfile`.
3. Append `--ignore-scripts` to the install command in exactly the three owned
   workflow files.
4. Re-run `bun test test/repo-tooling.test.js` and confirm all tests pass.
5. Review the diff to prove action SHA pins, checkout credential settings,
   secret scoping, conditions, build steps, and deploy behavior are unchanged.
6. Commit as `security(ci): disable dependency lifecycle scripts`.

Expected output: all parsed install steps use the exact hardened command, focused
repo-tooling tests pass, and the production diff contains only the three command
changes.
