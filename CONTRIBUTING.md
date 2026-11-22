# Contributing to Chemweave

Ideas, bug reports and code are all welcome. Report a problem or suggest a feature with
**Help ▸ Send Feedback** in the app, or open an issue on GitHub.

## Licence of contributions

Chemweave is licensed under the GNU General Public License, version 3 or later ([LICENSE](LICENSE)),
with an additional permission that lets it be distributed through Apple's App Store and TestFlight
([APP-STORE-EXCEPTION.md](APP-STORE-EXCEPTION.md)).

By opening a pull request or otherwise submitting code, text, pictures or data to this project, you
agree that your contribution is licensed under the GNU GPL version 3 or later **together with that
App Store permission**, and you confirm that you have the right to contribute it (it is your own work,
or its licence allows this).

## What not to contribute

To keep the project free of other people's rights:

- No code, documentation, icons, artwork, templates or example files from ChemDraw or other
  commercial chemistry programs, and no files those programs produced.
- No benchmark or comparison results from programs whose licences forbid them (for example Mnova
  and ChemDraw).
- No structures, figures or tables copied from textbooks, papers or catalogues: draw your own.
- Fonts only under the SIL Open Font License; libraries only under licences compatible with GPL
  version 3 (list new ones in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).
- No CAS Registry Numbers in bundled data; key compounds by PubChem CID instead.

## Screens and wording

Changes to what people see follow the [UI style guide](docs/ui-style.md): standard Office command
names, American spelling, Title Case for commands, formulas with real subscripts and charges.

## Chemistry test values

A test's expected chemistry answer (a mass, a formula, a shift, a name, a hazard, a ranking) comes
from a cited published source (a paper, a handbook, PubChem, NIST, IUPAC) or from Nate's reference
molecules, with the reference in a comment beside it. Never take it from running the code being
tested, and never from the CHEM21 solvent guide. See "Rules for changes" in
[docs/developers.md](docs/developers.md#rules-for-changes).

## Pull requests

Fill in the [pull request template](.github/pull_request_template.md), and keep the places listed
under [Places that must stay in step](docs/developers.md#places-that-must-stay-in-step) in step.

## Building and testing

See [docs/developers.md](docs/developers.md).
