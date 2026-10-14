# beer-text

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
| `preset` | `'lager'` | `lager`, `wheat`, `ipa`, `amber` or `stout` |
| `colors` | | Override any preset color (`beer`, `band`, `foam`, `cream`, `bubble`, `bubbleDeep`, `highlight`, `haze`, `fizz`) |
| `empty` | the text color | The letters' color before the beer arrives |
| `head` | see note | The settled head, as a fraction of the letters' height. Default: `0.32` for one line, `0.22` for two, `0.20` for three or more |
| `autoplay` | `true` | Pour when the heading is mostly in view; `false` shows the full pint |
| `once` | `false` | `'session'` pours once per browser session (a reload pours again) |

`pour()` returns a controller: `finished` (a promise for the current pour), `replay()`, `finish()` (jump to the full pint) and `destroy()` (remove everything and restore the heading). Calling `replay()` or `finish()` before the heading is first drawn is remembered. Calling `pour()` again on the same heading replaces its controller.

Pour again on click:

```js
const pint = pour(title);
title.addEventListener('click', () => pint.replay());
```

## Accessibility

- With `prefers-reduced-motion`, the heading shows the full pint without pouring; switching it on mid-pour stops the pour.
- In forced-colors (high contrast) mode, nothing is drawn and the plain heading shows in system colors, including when the mode is switched on later.
- If the font never loads, the heading cannot be measured, or drawing throws, the plain heading stays.

## Notes

- Long titles wrap wherever the browser breaks them. For even line lengths, add `text-wrap: balance` to the heading's CSS.
- Put real spaces between words. Gaps made only with CSS margins or padding between inline elements are not reproduced in the beer.
- One font per heading. The heading's own font is used, so any web font or system font works.
- Animation runs only while the heading is on screen and the tab is visible.
- The letter shapes are cut with a hidden copy of the heading's text (hidden from screen readers too), kept at the end of the page rather than inside the heading, so the heading's own text is unchanged. Find-in-page may count the heading twice, and anything that reads the whole page's text may see the copy as well; how search engines treat it has not been tested.
- The physics module is exported on its own (`beer-text/physics`) and runs in Node. Its time is compressed: a real head settles over minutes, this one in about a second, with the same shape of decay.

## Develop

- Demo: serve the repo root (`python3 -m http.server`) and open `/demo/`.
- Tests: `npm test` (physics, in Node), and `test/lifecycle.html` and `test/text.html` in a foreground browser window (serve the repo root and open each page; the title reads ALL PASS or N FAIL).

## License

MIT
