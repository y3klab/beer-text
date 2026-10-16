# beer-text

[![The words Beer Text filling with beer: the stream lands, a head builds and settles, and bubbles rise through the letters](https://y3klab.github.io/beer-text/demo/pour.gif)](https://y3klab.github.io/beer-text/demo/)

**[Try the demo](https://y3klab.github.io/beer-text/demo/)**

Fill your headings like a pint of beer. The stream lands, the surface sloshes, a head builds and settles, and carbonation rises through the letters. It is a small physics simulation, not a looping wave, in plain JS and SVG with no dependencies.

The heading stays real text: its own text is unchanged, so screen readers, copy and paste, and scripts that read the heading get the same heading as before.

## Use

```html
<h1 id="title">Beer Text</h1>
<script type="module">
  import { pour } from 'https://cdn.jsdelivr.net/npm/beer-text@0.1/+esm';
  pour(document.getElementById('title'), { preset: 'lager' });
</script>
```

Or `npm install beer-text` and `import { pour } from 'beer-text'`.

## Options

| Option | Default | What it does |
|---|---|---|
| `preset` | `'lager'` | `lager`, `wheat`, `ipa`, `amber` or `stout`; any other name pours lager |
| `colors` | | Override any preset color (`band`, `foam`, `cream`, `bubble`, `bubbleDeep`, `highlight`, `haze`, `fizz`) with a CSS color. `beer` is the gradient, surface to bottom: four colors in an array, or one color for all four. A value that is not a CSS color is ignored |
| `empty` | the text color | The letters' color before the beer arrives (a CSS color) |
| `head` | see note | The settled head, as a fraction of the letters' height. By default the head is 30% of the first line's letters, however many lines there are. Kept between `0.05` and `0.6` |
| `autoplay` | `true` | Pour when the heading is mostly in view; `false` shows the full pint |
| `once` | `false` | `'session'` pours once per browser tab session (a reload pours again). Remembered by the heading's text, so the same title on two pages pours once |

`pour(element, options)` takes the heading element itself (not a selector) and returns a controller: `finished` (a promise that settles when the current pour ends, is replaced, or is destroyed), `replay()`, `finish()` (jump to the full pint) and `destroy()` (remove everything and restore the heading). `replay()` and `finish()` return `finished`. Calling them before the heading is first drawn is remembered. Calling `pour()` again on the same heading replaces its controller, even from another copy of the library.

Pour again on click:

```js
const pint = pour(title);
title.addEventListener('click', () => pint.replay());
```

## Accessibility

- With `prefers-reduced-motion`, the heading shows the full pint without pouring; switching it on mid-pour stops the pour.
- In forced-colors (high contrast) mode, nothing is drawn and the plain heading shows in system colors, including when the mode is switched on later.
- If the font never loads, the heading cannot be measured, or drawing throws, the plain heading stays.
- It works under a strict Content Security Policy (no inline styles needed).

## Notes

- Long titles wrap wherever the browser breaks them. For even line lengths, add `text-wrap: balance` to the heading's CSS.
- Put real spaces between words. Gaps made only with CSS margins or padding between inline elements are not reproduced in the beer.
- One font per heading. The heading's own font is used, so any web font or system font works.
- Some typography keeps the plain heading instead of pouring: right-to-left text (Hebrew, Arabic), small caps, an inline heading (use `display: block` or `inline-block`), and a heading that is rotated, skewed, mirrored or 3D-transformed (on itself or an ancestor). Scaled headings, accents typed as separate characters, preserved spaces, `word-spacing` and justified text are drawn to match.
- One font, size and baseline per heading: a word raised or lowered with `vertical-align`, or set in another size, is not reproduced in the beer.
- Animation runs only while the heading is on screen and the tab is visible. Scrolling away or switching tabs mid-pour jumps to the full pint, and `replay()` on a heading that is off screen shows the full pint.
- Very long or very large headings stay plain: over 400 characters, or bigger than a 4096 x 4096 pixel canvas.
- The overlay is rebuilt whenever the heading's width or height changes. A change that leaves the heading's box the same size is not noticed: new text, a new font size under a fixed `line-height`, or a new text color (a theme switch). Call `destroy()` and `pour()` again.
- The beer is drawn in an `svg` and a `canvas` appended inside the heading, and while it shows, the heading's own text is made transparent (`color` and `-webkit-text-fill-color`, `!important`) and a static heading becomes `position: relative`. `destroy()` puts back the inline styles it found. Before changing the heading's text or re-rendering it (React, Vue, a translation switch), call `destroy()`, and `pour()` again after; when a single-page app removes a heading, call `destroy()` so nothing is left listening.
- The letter shapes are cut with a hidden copy of the heading's text (hidden from screen readers too), kept at the end of the page rather than inside the heading, so the heading's own text is unchanged. Find-in-page may count the heading twice, and anything that reads the whole page's text may see the copy as well; how search engines treat it has not been tested.
- The physics module is exported on its own (`beer-text/physics`) and runs in Node. Its time is compressed: a real head settles over minutes, this one in about a second, with the same shape of decay.

## Browser support

Tested in current Safari (macOS and iOS) and Firefox, and in Chrome on the site it was built for. It needs `document.fonts` and ES2018; without them the plain heading stays.

## Develop

- Demo: serve the repo root (`python3 -m http.server`) and open `/demo/`.
- The README's GIF and the share card: `node scripts/record-gif.mjs` (needs ffmpeg) and `node scripts/render-share-card.mjs`, with the repo root served on port 8830 and Google Chrome installed.
- Tests: `npm test` (physics, in Node), and `test/lifecycle.html`, `test/text.html` and `test/csp.html` in a foreground browser window (serve the repo root and open each page; the title reads ALL PASS or N FAIL).

## License

MIT
