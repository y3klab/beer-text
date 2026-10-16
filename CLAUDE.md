# CLAUDE.md

## Project
Open-source JS library that fills a heading's letters like a pint of beer - simulated surface, foam and carbonation - extracted from the BaseModelBrewing.com hero pour. David owns the code and the lager colors. Package and repo: `beer-text` (`y3klab/beer-text`). Beer only by design: no cola, champagne or other drinks (David, 2026-10-08).

## Structure
- `src/physics.js` - the pour simulation: pure math, no DOM, tested in Node.
- `src/beer-text.js` - `pour(el, options)`, presets, the SVG overlay and the carbonation canvas.
- `demo/index.html` - the demo page (word: Beer Text) (`index.html` because GitHub Pages serves it).
- `demo/pour.gif` - the README's animation, recorded from the demo by `scripts/record-gif.mjs`. `demo/share-card.png` - the link preview image, rendered from `demo/share-card.html` by `scripts/render-share-card.mjs`. Both need the repo root on 127.0.0.1:8830; re-run them when the demo's look changes.
- `test/lifecycle.html` - browser tests for the controller: failure recovery, early `replay()`/`finish()`, one controller per heading, accessibility settings changing live. Run it in a foreground window (background tabs pause animation frames); `?report` sends the results to the server log.
- `test/text.html` - browser tests for reading the heading: text-transform with letter-spacing, a final sigma, capitalize after a `<br>`, rebuilding on a font-size change, the font check's characters, bubble streams on repeated letters (WWW), two copies of the library on one page, and the typography it reproduces or declines (decomposed accents, right-to-left, scaled/rotated/mirrored ancestors, preserved spaces, word-spacing, justify, small caps, a block child's effect on the baseline, the empty letters' color when the stylesheet arrives after the script or changes with a resize). Errors from browser extensions are ignored; any other uncaught error fails a case. Same foreground and `?report` rules.
- `test/csp.html` - the library under a strict Content Security Policy: positioned with no style attributes and no policy violations (script in `test/csp.js`, since inline scripts are blocked).
- `test/physics.test.js` - stability and landing tests across glass shapes. `BEER_TEXT_SIM=<path>` points the suite at another copy of the sim (used to prove the stability case fails on the original).

## Commands
- Tests: `npm test`
- Demo: `python3 -m http.server` in the repo root, open `/demo/`. Claude in Chrome tabs run hidden, so animation frames pause until a screenshot is taken.

## Conventions
- The heading's real text is never replaced; overlays are `aria-hidden` and marked `data-beer-text`.
- Every SVG id is prefixed per instance; never add a fixed id.
- The letter-shape clip (a `<text>` copy of the heading) lives in one hidden `svg[data-beer-text="defs"]` at the end of the body, never inside the heading, so the heading's own `textContent` and `innerText` stay unchanged (David, 2026-10-09). Find-in-page still counts it twice, and page-wide text extraction can see the copy; search engines are untested, so the README promises only the heading-level guarantee.
- The physics stays bit-identical on shapes that already worked; compare against the previous copy before changing constants.

## Releasing
- A version published to npm can never be reused or changed: confirm with David before every publish.
- Before a release: all three browser test pages pass in a foreground Safari and Firefox, and `npm test` passes.
