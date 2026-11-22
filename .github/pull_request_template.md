## What this changes

<!-- A few lines in plain words: what people will see or what now works. -->

## Checklist

<!-- Delete what doesn't apply, but say "not needed" rather than leaving a line out. -->

- **Real-program check** (writers, or drawing meant to match ChemDraw): queued / done / not needed. Laptop items added:
  <!-- id, steps, expected result; run with CHEMWEAVE_CORPUS (docs/developers.md) -->
- **Edge cases tested:** empty · very large · malformed file · a failure on the way (network, unreadable file) · the target changing while async work runs · the web build · the other desktop platforms. Not covered, and why:
- **License and IP** (only when adding data, fixtures, names, fonts or third-party code): follows [CONTRIBUTING](../CONTRIBUTING.md#what-not-to-contribute); sources and licences:
- **Screenshots** for changed screens (`node scripts/screenshot-matrix.mjs <screen>`): attached / no visible change.
- **Mockup pick:** link / ChemDraw-match exception (S41) / no visual change.
- **New controls** take their name, place and behavior from Office (or ChemDraw for drawing), with icon, label, tooltip, a preview for a look setting and structured input for data ([UI style guide](../docs/ui-style.md)): yes / no new controls.
- **Chemistry test values** come from a cited outside source, with the reference in a comment, never from running the code: yes / none added.
- **Replaces:** … (removed here) / nothing.
- **Kept in step** with the places listed under "Places that must stay in step" in [docs/developers.md](../docs/developers.md#places-that-must-stay-in-step): yes / not affected.
