# Notes for coding agents

Chemweave is a chemistry drawing program with Office-style slides, documents and spreadsheets. Read
these before changing anything, and follow them as a person contributing would:

- [CONTRIBUTING.md](CONTRIBUTING.md): what may and may not go into the repository (nothing made by
  ChemDraw, Word, PowerPoint, Excel or another commercial program; libraries only under licenses
  compatible with GPL version 3, listed in THIRD-PARTY-NOTICES.md).
- [docs/developers.md](docs/developers.md): how to build and test, the **Rules for changes**, the
  **Checks for the standing rules** (R1 to R16: what each checks and how to run it) and the
  **Places that must stay in step**.
- [docs/ui-style.md](docs/ui-style.md): the UI style guide (S1 to S97) for anything people see:
  Office names for commands, American spelling, Title Case, real subscripts in formulas.
- [.github/pull_request_template.md](.github/pull_request_template.md): what every pull request
  says.

In short:

- Build test files in the tests themselves; never commit drawings or Office files made by another
  program, or anyone's own files.
- Chemistry values in tests come from a cited outside source, with the reference in a comment,
  never from running the code under test.
- A check's known-problems list is for problems that were there before; never add a new problem to
  one to make a check pass, and never weaken a check.
- Every automatic value can be changed by hand; every command is undone in one step.
- Every pull request that changes the app adds a change file to `changes/` saying in plain words what
  it changed (`changes/README.md`); it becomes the release notes, Help ▸ What's New and CHANGELOG.md.
  Never edit CHANGELOG.md by hand.
- Run the tests for what you changed (`npx vitest run tests/<file>`) and `npm run typecheck:strict`
  before committing.
