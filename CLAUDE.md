# CLAUDE.md

## Project
Open-source JS library that fills a heading's letters like a pint of beer - simulated surface, foam and carbonation - extracted from the BaseModelBrewing.com hero pour. David owns the code and the lager colors. Package and repo: `beer-text` (`y3klab/beer-text`, private until launch). Beer only by design: no cola, champagne or other drinks (David, 2026-10-08).

## Structure
- `src/physics.js` - the pour simulation: pure math, no DOM, tested in Node.
- `src/beer-text.js` - `pour(el, options)`, presets, the SVG overlay and the carbonation canvas.
- `demo/index.html` - the CHEERS demo (`index.html` because GitHub Pages serves it).
- `test/physics.test.js` - stability and landing tests across glass shapes. `BEER_TEXT_SIM=<path>` points the suite at another copy of the sim (used to prove the stability case fails on the original).

## Commands
- Tests: `npm test`
- Demo: `python3 -m http.server` in the repo root, open `/demo/`. Claude in Chrome tabs run hidden, so animation frames pause until a screenshot is taken.

## Conventions
- The heading's real text is never replaced; overlays are `aria-hidden` and marked `data-beer-text`.
- Every SVG id is prefixed per instance; never add a fixed id.
- The physics stays bit-identical on shapes that already worked; compare against the previous copy before changing constants.

## Before public launch
- Making the repo public and publishing to npm are irreversible: confirm with David first.
- Real-device checks: Safari (macOS, iOS) and Firefox, wide letter-spacing, large headings for stutter.
- The SVG clip's `<text>` shows up in the heading's `innerText` (as on the Base Model site); decide whether to move it out.
- Base Model's homepage to switch to importing this package.
