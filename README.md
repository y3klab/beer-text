# beer-text

Fill your headings like a pint of beer. The stream lands, the surface sloshes, a head builds and settles, and carbonation rises through the letters. It is a small physics simulation, not a looping wave, in plain JS and SVG with no dependencies.

The heading stays real text: screen readers, copy and paste, find-in-page and search engines see the same heading as before.

## Use

```html
<h1 id="title">Cheers</h1>
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
| `head` | `0.27` | The settled head, as a fraction of the letters' height |
| `autoplay` | `true` | Pour when the heading is mostly in view; `false` shows the full pint |
| `once` | `false` | `'session'` pours once per browser session (a reload pours again) |

`pour()` returns a controller: `finished` (a promise for the current pour), `replay()`, `finish()` (jump to the full pint) and `destroy()` (remove everything and restore the heading).

Pour again on click:

```js
const pint = pour(title);
title.addEventListener('click', () => pint.replay());
```

## Accessibility

- With `prefers-reduced-motion`, the heading shows the full pint without pouring.
- In forced-colors (high contrast) mode, nothing is drawn and the plain heading shows in system colors.
- If the font never loads, or the heading cannot be measured, the plain heading stays.

## Notes

- One font per heading. The heading's own font is used, so any web font or system font works.
- Animation runs only while the heading is on screen and the tab is visible.
- The physics module is exported on its own (`beer-text/physics`) and runs in Node. Its time is compressed: a real head settles over minutes, this one in about a second, with the same shape of decay.

## Develop

- Demo: serve the repo root (`python3 -m http.server`) and open `/demo/`.
- Tests: `npm test` (physics, in Node).

## License

MIT
