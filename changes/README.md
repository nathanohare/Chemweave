# Change files

Every pull request that changes the app adds one small file here saying what it changed, in plain words. When a version is published, these files become its release notes, the app's **Help ▸ What's New**, and its section of [CHANGELOG.md](../CHANGELOG.md) (made on `main` by `scripts/changelog.mjs` each time a version is published; a pull request never changes CHANGELOG.md).

## How to write one

Add `changes/<short-name>.md` (any name; the branch name works) in the same pull request. Each line is one change:

```
<Type>: <what changed, in one or two sentences>
```

The types, in the order the changelog lists them:

| Type | For |
|---|---|
| `Added` | a new feature, command, tool, file format, table or option |
| `Changed` | something that works or looks different or better than before, including speed people notice |
| `Fixed` | something that was wrong and now works |
| `Removed` | a feature or option taken out |
| `Under the hood` | tests, checks, builds, signing, developer docs, clean-ups: things people won't see |

For example:

```
Added: Slides: Summary Zoom slides jump to their section during a slide show.
Fixed: Canvas: undoing a pasted ChemDraw object removes it in one step. Fixes #123.
```

- Write for the people who use the app: what they can now do or what now works, not how the code changed. No file paths, function names or internal ids.
- Start with the area when it helps (Canvas, Document, Slides, Spreadsheet, Design, SI Project, Knowledge Base, Files, Copy and paste, Desktop app, Web version, Settings, Help).
- Name the issue a fix closes ("Fixes #123"), so whoever reported it sees it in What's New.
- American spelling, menu paths with ▸, no names of people.
- The pull request's number is added by itself.

A pull request that only changes tests, checks, workflows or documentation doesn't need one (an `Under the hood` line is still welcome). One that changes `src/`, `src-tauri/`, `index.html`, `public/` or `opsin-js/` but that nobody will notice can carry the `no changelog` label instead. The **Changelog** check on each pull request checks all of this.

Change files are never deleted once merged: CHANGELOG.md is made from them. `history/` holds the changelog from before change files (written from every earlier pull request) and the milestones list at the top of CHANGELOG.md; both can be edited by hand.
