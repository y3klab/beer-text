// beer-text: fill a heading's letters like a pint of beer. The heading keeps its real text (screen
// readers, copy, find-in-page); an aria-hidden SVG overlay draws the beer through the letter shapes,
// and a canvas draws the carbonation. Physics in physics.js. Any failure leaves the plain heading.
import { createPourSim, calibratePour } from './physics.js';

// Colors per style. beer: four gradient stops, surface to bottom. band: the darker line under the
// head (meniscus). cream: where the head meets the beer. bubble/bubbleDeep/highlight: the head's
// texture. haze: air clouding the beer while it pours. fizz: rising bubbles.
export var presets = {
  lager: { beer: ['#E8A638', '#ECA93C', '#E39F33', '#D4932A'], band: '#B5781F', foam: '#F3EAD3', cream: '#E2B866', bubble: '#E5D7B5', bubbleDeep: '#E3C88E', highlight: '#FFFDF5', haze: '#FBE3A6', fizz: '#FFF6E0' },
  wheat: { beer: ['#F6D27A', '#F4CC6C', '#EFC362', '#E5B655'], band: '#C99A3C', foam: '#FFFBF2', cream: '#F4DC9A', bubble: '#F2EADA', bubbleDeep: '#EBDDB8', highlight: '#FFFFFF', haze: '#FFF0C8', fizz: '#FFF8E6' },
  ipa: { beer: ['#EE9636', '#EA8F30', '#E0852A', '#CF7822'], band: '#A65E18', foam: '#FAF1DC', cream: '#EBB06A', bubble: '#EEDFC0', bubbleDeep: '#E8C994', highlight: '#FFFFFA', haze: '#F7CF94', fizz: '#FFF0D6' },
  amber: { beer: ['#D87A32', '#D3732D', '#C86A28', '#B65D22'], band: '#8A4416', foam: '#F1E2C6', cream: '#D69A5E', bubble: '#E4D1AE', bubbleDeep: '#D9BC8E', highlight: '#FFF9EE', haze: '#F0AA74', fizz: '#F6DCC0' },
  stout: { beer: ['#2A1810', '#22130C', '#1A0E09', '#120905'], band: '#0A0503', foam: '#E9D8B8', cream: '#C9A374', bubble: '#DCC7A0', bubbleDeep: '#C9AE82', highlight: '#FFF8EA', haze: '#6B4A2E', fizz: '#D9C2A0' }
};

var NS = 'http://www.w3.org/2000/svg';
var HOLD = 350, LAND_START = 1.9, LAND_END = 2.5;   // ms before the pour starts; landing, in s after it stops
var COUNT = typeof Symbol === 'function' ? Symbol.for('beer-text.count') : '__beerTextCount';   // shared by every copy of the library on the page, so SVG ids never repeat
var OWNERS = typeof Symbol === 'function' ? Symbol.for('beer-text.owners') : '__beerTextOwners';   // heading -> its controller, shared by every copy: a second pour() on a heading replaces the first
var MAX_TEXT = 400, MAX_PIXELS = 4096 * 4096;   // beyond these the heading stays plain: per-character measuring and canvas memory grow with them

// The letter shapes are a clipPath of <text>, which reads as text to anything that reads the heading
// (search engines, link previews, innerText). So they live in one hidden SVG at the end of the body,
// not inside the heading. Never display:none: some browsers then drop the clipPath.
function holder() {
  var h = document.querySelector('svg[data-beer-text="defs"]');
  if (!h) {
    h = el('svg', { 'data-beer-text': 'defs', 'aria-hidden': 'true', focusable: 'false', width: 0, height: 0, style: 'position:absolute;width:0;height:0;overflow:hidden' });
    document.body.appendChild(h);
  }
  return h;
}
function el(n, a, p) {   // style goes through the CSSOM: a strict Content Security Policy blocks style attributes
  var e = document.createElementNS(NS, n);
  for (var k in a) { if (k === 'style') e.style.cssText = a[k]; else e.setAttribute(k, a[k]); }
  if (p) p.appendChild(e); return e;
}
// Only real CSS colors reach the SVG: a paint value like url(...) could load an outside resource.
function isColor(v) { return typeof v === 'string' && !!window.CSS && CSS.supports('color', v); }
function pickColors(o) {
  var base = Object.prototype.hasOwnProperty.call(presets, o.preset) ? presets[o.preset] : presets.lager, over = o.colors || {}, c = {};
  Object.keys(base).forEach(function (k) {
    var v = Object.prototype.hasOwnProperty.call(over, k) ? over[k] : null;
    if (k !== 'beer') { c[k] = isColor(v) ? v : base[k]; return; }
    var stops = typeof v === 'string' ? [v, v, v, v] : v;   // one color fills all four stops
    c.beer = Array.isArray(stops) && stops.length === 4 && stops.every(isColor) ? stops.slice() : base.beer;
  });
  return c;
}
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var r = Math.imul(seed ^ seed >>> 15, 1 | seed); r = r + Math.imul(r ^ r >>> 7, 61 | r) ^ r; return ((r ^ r >>> 14) >>> 0) / 4294967296; }; }
function smoothstep(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function f1(n) { return Math.round(n * 10) / 10; }
function smooth(pts, lead) {   // Catmull-Rom through the samples, as cubic Beziers
  var d = lead + f1(pts[0][0]) + ',' + f1(pts[0][1]);
  for (var i = 0; i < pts.length - 1; i++) {
    var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += 'C' + f1(p1[0] + (p2[0] - p0[0]) / 6) + ',' + f1(p1[1] + (p2[1] - p0[1]) / 6) + ' ' +
      f1(p2[0] - (p3[0] - p1[0]) / 6) + ',' + f1(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + f1(p2[0]) + ',' + f1(p2[1]);
  }
  return d;
}
function rev(a) { return a.slice().reverse(); }
// Draw one measured line on a canvas. Where the line's spacing isn't the font's own (letter-spacing, word-spacing,
// preserved or justified spaces), each character or word goes where the browser laid it out: canvas letterSpacing
// is missing in some browsers, and drawn whole the shapes would bunch up.
function fillLine(cx, l, m, dy) {
  if (!m.each) { cx.fillText(l.text, l.x, l.base - dy); return; }
  l.units.forEach(function (u) { cx.fillText(u.t, u.x, l.base - dy); });
}
function transform(text, tt) {
  if (tt === 'uppercase') return text.toUpperCase();
  if (tt === 'lowercase') return text.toLowerCase();
  if (tt === 'capitalize') return text.replace(/(^|\s)(\S)/g, function (m, s, c) { return s + c.toUpperCase(); });
  return text;
}

// The text in user-perceived characters, so an accent typed as its own code point stays on its letter.
var segmenter;
function clusters(s) {
  if (segmenter === undefined) segmenter = window.Intl && Intl.Segmenter ? new Intl.Segmenter() : null;
  if (segmenter) return Array.from(segmenter.segment(s), function (x) { return [x.index, x.segment.length]; });
  var out = [], re = /\P{M}\p{M}*|\p{M}+/gu, mm;
  while ((mm = re.exec(s))) out.push([mm.index, mm[0].length]);
  return out;
}

// Typography the overlay can't reproduce, where the plain heading is kept instead: right-to-left text (lines are
// read left to right), small caps (canvas and SVG text can't be relied on to draw them), an inline heading (no box
// to draw in), and a rotated, skewed, mirrored or 3D-transformed heading or ancestor. Scale and translation are
// fine: measure() corrects for scale.
var RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
function unsupported(target, cs) {
  if (cs.direction === 'rtl' || RTL.test(target.textContent) || !target.clientWidth || !target.clientHeight) return true;
  if (cs.fontVariantCaps && cs.fontVariantCaps !== 'normal') return true;
  for (var e = target; e && e.nodeType === 1; e = e.parentElement) {
    var st = getComputedStyle(e), tf = st.transform;
    if (st.rotate && st.rotate !== 'none' && parseFloat(st.rotate.split(' ').pop()) !== 0 || st.scale && /-/.test(st.scale)) return true;   // the angle is the last part (x 30deg, 0 1 0 30deg)
    if (!tf || tf === 'none') continue;
    var mx = /^matrix(3d)?\((.*)\)$/.exec(tf), v = mx && mx[2].split(',').map(parseFloat);
    if (v && mx[1]) v = v[2] || v[3] || v[6] || v[7] || v[8] || v[9] || v[10] !== 1 || v[11] || v[15] !== 1 ? null : [v[0], v[1], v[4], v[5]];   // 3D: translation only
    if (!v || v[1] || v[2] || !(v[0] > 0) || !(v[3] > 0)) return true;   // rotation, skew, a flip or real 3D
  }
  return false;
}

// Wait for the heading's own font. fonts.ready can resolve before a display=swap face is even requested,
// so ask for the face and poll check(); a system font passes check() at once. Both get the heading's own
// characters as shown, so a font split into character subsets loads the subsets the heading uses. Gives up after 2.5 s even if
// a load never settles, and a font API that throws counts as no font.
function fontReady(spec, text) {   // spec: a function, read on every attempt
  return new Promise(function (done) {
    var ended = false, poll = 0, deadline = setTimeout(function () { end(false); }, 2500);
    function end(ok) { if (ended) return; ended = true; clearTimeout(deadline); clearTimeout(poll); done(ok); }
    (function attempt() {
      Promise.resolve().then(function () { return document.fonts.load(spec(), text); }).then(function () {
        if (ended) return;
        if (document.fonts.check(spec(), text)) return end(true);
        poll = setTimeout(attempt, 100);
      }).catch(function () { end(false); });
    })();
  });
}

/**
 * Pour beer into a heading.
 * @param {Element} target - the heading; its text stays in place, made transparent under the overlay.
 * @param {object} [options]
 * @param {string} [options.preset='lager'] - lager, wheat, ipa, amber or stout.
 * @param {object} [options.colors] - overrides for any preset color (see presets).
 * @param {string} [options.empty] - the letters' color before the beer arrives; defaults to the text color.
 * @param {number} [options.head] - the settled head, as a fraction of the letters' height. By default the head
 *   is 30% of the first line's letters, however many lines there are.
 * @param {boolean} [options.autoplay=true] - pour when the heading is mostly in view; false shows the full pint.
 * @param {false|'session'} [options.once=false] - 'session' pours once per browser session (a reload pours again).
 * @returns {{ finished: Promise<void>, replay: function, finish: function, destroy: function }}
 */
export function pour(target, options) {
  var o = options || {};
  if (target != null && target.nodeType !== 1) throw new TypeError('beer-text: pour() takes an element, not ' + (typeof target === 'string' ? 'the string "' + target + '"' : typeof target));
  var colors = pickColors(o), emptyOpt = isColor(o.empty) ? o.empty : null;
  var head = o.head == null || !isFinite(+o.head) ? null : clamp(+o.head, 0.05, 0.6);
  var autoplay = o.autoplay !== false;
  var id = 'beer-text-' + (window[COUNT] = (window[COUNT] || 0) + 1) + '-';
  var G = null, lastW = 0, lastH = 0, raf = 0, t0 = 0, playing = false, sim = null, dead = false;
  var fizzRaf = 0, fizzLast = 0, fizzAcc = 0, onScreen = true, ro = null, io = null, waiter = null;
  var saved = null, resolveFinished = null, mountRaf = 0, mountPlay = false;
  var mqReduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
  var mqForced = window.matchMedia && matchMedia('(forced-colors: active)');   // system colors win: no overlay
  var reduce = !!mqReduce && mqReduce.matches;
  var started = false, ready = false, want = null;   // want: a replay() or finish() that came before the first draw
  var ctl = { finished: Promise.resolve(), replay: function () { safe(replay)(); return ctl.finished; },
              finish: function () { safe(finish)(); return ctl.finished; }, destroy: destroy };

  function settle() { if (resolveFinished) { resolveFinished(); resolveFinished = null; } }
  function newPour() { settle(); ctl.finished = new Promise(function (r) { resolveFinished = r; }); }
  newPour();

  var owners = window[OWNERS] || (window[OWNERS] = new WeakMap());
  if (target && owners.has(target)) owners.get(target).destroy();
  if (!target || !document.fonts || !window.requestAnimationFrame || (mqForced && mqForced.matches)) { dead = true; settle(); return ctl; }
  owners.set(target, ctl);

  // An error in any later callback gives the plain heading back: overlays, observers and loops go, the text's
  // own color returns and finished settles. Frames, observers, media and visibility listeners, the font check's
  // result and the public controls all go through it.
  function safe(fn) {
    return function () {
      if (dead) return;
      try { return fn.apply(this, arguments); } catch (e) { destroy(); if (window.console) console.error('beer-text:', e); }
    };
  }
  var cs = getComputedStyle(target), emptyColor = emptyOpt;

  // The heading's own inline styles, value and priority, so destroy() puts back exactly what was there.
  function grab(p) { return [target.style.getPropertyValue(p), target.style.getPropertyPriority(p)]; }
  function put(p, v) { target.style.setProperty(p, v[0], v[1]); }
  function hide() { target.style.setProperty('color', 'transparent', 'important'); target.style.setProperty('-webkit-text-fill-color', 'transparent', 'important'); }

  function font(size) { return cs.fontStyle + ' ' + cs.fontWeight + ' ' + size + 'px ' + cs.fontFamily; }

  // Lines as laid out: one Range per character, grouped where the top jumps; the baseline from one probe.
  // Positions come back in the heading's own CSS pixels: a scaled heading or ancestor is divided back out.
  function measure() {
    cs = getComputedStyle(target);
    if (target.textContent.length > MAX_TEXT) return null;
    // The empty letters take the text color as styled now, not when pour() ran: a page's stylesheet can
    // arrive after its scripts (Safari, uncached). Once the text is transparent, the author's inline color
    // goes back for the read, in the same task, so nothing paints in between.
    if (!emptyOpt) {
      if (saved) { put('color', saved.color); put('-webkit-text-fill-color', saved.fill); }
      emptyColor = cs.color;
      if (saved) hide();
    }
    if (unsupported(target, cs)) return null;
    var hr = target.getBoundingClientRect();
    var sx = target.offsetWidth && Math.abs(hr.width - target.offsetWidth) > 1 ? hr.width / target.offsetWidth : 1;
    var sy = target.offsetHeight && Math.abs(hr.height - target.offsetHeight) > 1 ? hr.height / target.offsetHeight : 1;
    var ox = hr.left + target.clientLeft * sx, oy = hr.top + target.clientTop * sy;
    var fs = parseFloat(cs.fontSize), ws = cs.whiteSpaceCollapse || cs.whiteSpace;
    // each: how a line is placed when the browser's spacing isn't the font's own. Letter-spacing moves every
    // character ('char'; browsers drop ligatures there too); word-spacing, preserved spaces and justify only move
    // words ('word': each word whole, so ligatures and contextual shapes survive).
    var each = parseFloat(cs.letterSpacing) ? 'char' : parseFloat(cs.wordSpacing) || /^(pre|pre-wrap|break-spaces|preserve|preserve-spaces)$/.test(ws) ||
               cs.textAlign === 'justify' || cs.textAlignLast === 'justify' ? 'word' : '';
    var walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) { return (n.nodeType === 1 ? n : n.parentNode).closest('[data-beer-text]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    // t: the character as shown, for the letter-spaced path, which draws one character at a time. Capitalize
    // depends on the character before it (a space or a <br> starts a word), so it is decided here in reading order.
    var range = document.createRange(), lines = [], cur = null, n, prevSpace = true, lastText = null;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 1) { if (n.tagName === 'BR') prevSpace = true; continue; }
      var s = n.nodeValue;
      clusters(s).forEach(function (k) {
        range.setStart(n, k[0]); range.setEnd(n, k[0] + k[1]);
        var r = range.getClientRects()[0];
        var ch0 = /\s/.test(s[k[0]]) ? ' ' : s.substr(k[0], k[1]);
        var t = cs.textTransform === 'capitalize' ? (prevSpace ? ch0.toUpperCase() : ch0) : transform(ch0, cs.textTransform);
        prevSpace = ch0 === ' ';
        if (r && r.width > 0 && r.height > 0) {
          if (!cur || r.top > cur.top + 0.5 * r.height) lines.push(cur = { top: r.top, chars: [] });
          cur.chars.push({ c: ch0, t: t, l: r.left, r: r.right });
          lastText = n;
        }
      });
    }
    // The pieces a line is drawn in: one per character, or one per word.
    function units(ch) {
      var out = [], u = null;
      ch.forEach(function (c) {
        if (c.c === ' ') { u = null; return; }
        if (each === 'char' || !u) out.push(u = { t: '', x: (c.l - ox) / sx });
        u.t += c.t;
      });
      return out;
    }
    lines = lines.map(function (ln) {
      var ch = ln.chars;
      while (ch.length && ch[0].c === ' ') ch.shift();
      while (ch.length && ch[ch.length - 1].c === ' ') ch.pop();
      if (!ch.length) return null;
      // Upper and lowercase transform the whole line at once, so letters whose case depends on their neighbors
      // (a Greek final sigma) come out right; capitalize comes from the words as read above, so a word broken
      // across lines is capitalized once.
      var cap = cs.textTransform === 'capitalize';
      if (!cap) {   // the per-character path takes its letters from the whole line too, when the lengths line up
        var whole = transform(ch.map(function (c) { return c.c; }).join(''), cs.textTransform), at = 0;
        if (whole.length === ch.reduce(function (a, c) { return a + c.t.length; }, 0)) ch.forEach(function (c) { c.t = whole.substr(at, c.t.length); at += c.t.length; });
      }
      var raw = ch.map(function (c) { return cap ? c.t : c.c; }).join('').replace(/ +/g, ' ');
      return { text: cap ? raw : transform(raw, cs.textTransform), x: (ch[0].l - ox) / sx, w: (ch[ch.length - 1].r - ch[0].l) / sx, top: ln.top,
               chars: ch.map(function (c) { return { c: c.c, t: c.t, x: (c.l - ox) / sx }; }), units: units(ch) };
    }).filter(Boolean);
    if (!lines.length) return null;
    // The probe goes right after the last text, on its line: appended to the heading, it would land below a block child.
    var probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    lastText.parentNode.insertBefore(probe, lastText.nextSibling);
    var pr = probe.getBoundingClientRect(), near = lines[lines.length - 1];
    lines.forEach(function (ln) { if (Math.abs(ln.top - pr.top) < Math.abs(near.top - pr.top)) near = ln; });
    var off = pr.bottom - near.top;
    probe.remove();
    lines.forEach(function (ln) { ln.base = (ln.top + off - oy) / sy; });
    var ctx = document.createElement('canvas').getContext('2d');
    ctx.font = font(fs);
    var W = target.clientWidth, H = target.clientHeight;
    // bodyH: the height the head is measured against. The capital height, not the line's tallest mark, so an
    // accent or a tall ascender doesn't squeeze the head; for mostly lowercase text in a font with short
    // lowercase (x-height under 0.8 of the capitals, as in most text faces), the lowercase height instead.
    var asc = function (t) { return ctx.measureText(t).actualBoundingBoxAscent; };
    var capH = asc(lines[0].text), hH = asc('H'), xH = asc('x');
    var letters = lines[0].text.replace(/[^\p{L}]/gu, ''), lower = letters.replace(/[^\p{Ll}]/gu, '').length;
    var bodyH = Math.min(capH, lower > letters.length / 2 && xH < 0.8 * hH ? xH : hH) || capH;
    return { W: W, H: H, fs: fs, each: each, lines: lines, capH: capH, bodyH: bodyH };
  }

  function build(m) {
    var L = m.lines, g = {};
    var last = L[L.length - 1];
    g.top = L[0].base - m.capH; g.bottom = last.base; g.H = g.bottom - g.top;
    // Default head: 30% of the first line's letters, however many lines follow, so a stacked title's head
    // looks the same as a one-line title's (David, 2026-10-16; it was a share of the whole title, too deep on two lines).
    var vt = L[0].base - m.bodyH;   // the top the eye reads as the glass
    g.surf = head != null ? g.top + head * g.H : vt + 0.30 * m.bodyH;
    g.headT = g.surf - g.top; g.hFinal = g.bottom - g.surf;
    g.minX = Math.min.apply(null, L.map(function (l) { return l.x; })) - 2;
    g.maxX = Math.max.apply(null, L.map(function (l) { return l.x + l.w; })) + 2;
    g.Wg = g.maxX - g.minX; g.Hsvg = m.H; g.ceiling = g.top - 2;
    g.geo = { H: g.H, Wg: g.Wg, hFinal: g.hFinal, headT: g.headT };
    g.tune = null;                                // calibrated in play(); the still frame never needs it
    g.foamTarget = g.headT + 0.05 * g.H;          // the settled head reaches past the glyph tops
    var R = rng(20261007);
    // A real head is lumpy on top: fixed per-column roughness, smoothed so the lumps are a few columns wide.
    var raw = [], lumps = [];
    for (var q = 0; q < 48; q++) raw.push(R() * 2 - 1);
    for (q = 0; q < 48; q++) lumps.push((raw[Math.max(0, q - 1)] + 2 * raw[q] + raw[Math.min(47, q + 1)]) / 4);
    g.lumps = lumps;

    var overlay = 'position:absolute;left:0;top:0;pointer-events:none;-webkit-user-select:none;user-select:none;text-transform:none';
    var s = g.svg = el('svg', { 'data-beer-text': '', width: m.W, height: m.H, viewBox: '0 0 ' + m.W + ' ' + m.H, 'aria-hidden': 'true', focusable: 'false', style: overlay + ';overflow:visible' });
    var defs = el('defs', {}, s);
    var clip = g.clip = el('clipPath', { id: id + 'glyphs', clipPathUnits: 'userSpaceOnUse' });   // attached to holder() on mount
    // Placed like fillLine, never stretched to the measured width: iOS Safari reports the last letter's right
    // edge too far out (Anton: 5.8px at 54px) and ignores letter-spacing on SVG text, so a textLength stretch
    // pulled the beer letters off the real ones. With other spacing, each character or word at its measured left.
    L.forEach(function (l) {
      var t = el('text', { x: l.x, y: l.base, 'font-family': cs.fontFamily, 'font-size': m.fs, 'font-weight': cs.fontWeight, 'font-style': cs.fontStyle }, clip);
      if (!m.each) { t.textContent = l.text; return; }
      l.units.forEach(function (u) { el('tspan', { x: u.x }, t).textContent = u.t; });
    });
    var beer = el('linearGradient', { id: id + 'beer', gradientUnits: 'userSpaceOnUse', x1: 0, y1: g.surf, x2: 0, y2: g.bottom }, defs);
    ['0', '0.30', '0.65', '1'].forEach(function (off, i) { el('stop', { offset: off, 'stop-color': colors.beer[i] }, beer); });
    g.shade = el('linearGradient', { id: id + 'shade', gradientUnits: 'userSpaceOnUse', x1: 0, y1: g.surf, x2: 0, y2: g.surf + 0.05 * g.H }, defs);
    el('stop', { offset: '0', 'stop-color': colors.band, 'stop-opacity': 0.5 }, g.shade);
    el('stop', { offset: '1', 'stop-color': colors.band, 'stop-opacity': 0 }, g.shade);
    g.cream = el('linearGradient', { id: id + 'cream', gradientUnits: 'userSpaceOnUse', x1: 0, y1: g.surf, x2: 0, y2: g.surf - 0.14 * g.headT }, defs);
    el('stop', { offset: '0', 'stop-color': colors.cream, 'stop-opacity': 0.85 }, g.cream);
    el('stop', { offset: '1', 'stop-color': colors.foam, 'stop-opacity': 0 }, g.cream);
    var haze = el('radialGradient', { id: id + 'haze' }, defs);
    el('stop', { offset: '0', 'stop-color': colors.haze, 'stop-opacity': 0.6 }, haze);
    el('stop', { offset: '1', 'stop-color': colors.haze, 'stop-opacity': 0 }, haze);
    var foamClip = el('clipPath', { id: id + 'foamclip', clipPathUnits: 'userSpaceOnUse' }, defs);
    g.foamClipPath = el('path', {}, foamClip);
    var beerClip = el('clipPath', { id: id + 'beerclip', clipPathUnits: 'userSpaceOnUse' }, defs);
    g.beerClipPath = el('path', {}, beerClip);

    var root = el('g', { 'clip-path': 'url(#' + id + 'glyphs)' }, s);
    el('rect', { x: 0, y: 0, width: m.W, height: m.H, fill: emptyColor }, root);   // the empty glass
    g.beer = el('path', { fill: 'url(#' + id + 'beer)' }, root);
    g.haze = el('ellipse', { fill: 'url(#' + id + 'haze)', 'clip-path': 'url(#' + id + 'beerclip)', opacity: 0 }, root);
    g.shadeBand = el('path', { fill: 'url(#' + id + 'shade)' }, root);
    g.foam = el('path', { fill: colors.foam }, root);
    g.creamBand = el('path', { fill: 'url(#' + id + 'cream)' }, root);
    var tex = el('g', { 'clip-path': 'url(#' + id + 'foamclip)' }, root);
    // Foam bubbles in foam-local coordinates: u across, d down through the head (0 top, 1 the beer).
    g.bubbles = [];
    var nb = Math.round(clamp(g.Wg / 9, 40, 120));
    for (var i = 0; i < nb; i++) {
      var d = R(), big = Math.pow(1 - d, 1.5);
      var b = {
        u: R(), d: d, r0: g.headT * (0.010 + 0.045 * big),
        pop: d < 0.35 && R() < 0.35 ? 0.3 + 1.5 * R() : Infinity,   // seconds after the pour stops
        el: el('circle', { fill: d > 0.75 ? colors.bubbleDeep : colors.bubble, 'fill-opacity': 0.55 }, tex)
      };
      if (R() < 0.3) b.hi = el('circle', { fill: colors.highlight, 'fill-opacity': 0.7 }, tex);
      g.bubbles.push(b);
    }
    g.meniscus = el('path', { fill: 'none', stroke: colors.band, 'stroke-opacity': 0.75, 'stroke-width': clamp(2 + (m.fs - 54) / (192 - 54), 1, 3) }, root);
    // Carbonation: streams rise from points where the last line's strokes sit on the baseline, so every
    // stream starts inside solid beer. Pooled circles; bubbles vanish between lines (the glyph clip)
    // and reappear in the next, and pop into the head at the surface.
    g.fs = m.fs;
    // Streams: one per 75px of glass, at least 3 so a short word never goes bare on one side while a stream pauses.
    g.sites = findSites(m, last, Math.round(clamp(g.Wg / 75, 3, 4)), g);
    // Bubbles per second in the opening wall, scaled to the glass width.
    g.wall0 = 150 * Math.min(1, Math.sqrt(g.Wg / 1108));
    // Bubbles are drawn on one canvas over the heading (hundreds of SVG circles cost too much to repaint
    // on phones), masked to the letter shapes in a single composite per frame.
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    g.canvas = document.createElement('canvas');
    g.canvas.setAttribute('data-beer-text', '');
    g.canvas.setAttribute('aria-hidden', 'true');
    g.canvas.style.cssText = overlay;
    g.canvas.width = Math.ceil(m.W * dpr); g.canvas.height = Math.ceil(m.H * dpr);
    g.canvas.style.width = m.W + 'px'; g.canvas.style.height = m.H + 'px';
    g.ctx = g.canvas.getContext('2d');
    g.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.mask = document.createElement('canvas');
    g.mask.width = g.canvas.width; g.mask.height = g.canvas.height;
    var mc = g.mask.getContext('2d');
    mc.setTransform(dpr, 0, 0, dpr, 0, 0);
    mc.font = font(m.fs);
    mc.fillStyle = '#000';
    L.forEach(function (l) { fillLine(mc, l, m, 0); });
    g.fizz = []; g.pops = []; g.drawn = false;
    // Pool large enough that the wall never hits it: a full pool stalls new bubbles and the wall breaks into waves.
    for (var q2 = 0; q2 < Math.round(clamp(g.Wg * 1.5, 600, 1600)); q2++) { g.fizz.push({ live: false }); g.pops.push({ age: 1 }); }
    return g;
  }

  // Where the bottom of a line's strokes is solid: draw the line on a one-pixel-tall canvas row just
  // above its baseline and take the centers of the inked runs, spread across the word.
  function findSites(m, line, n, g) {
    var y = line.base - 0.05 * m.capH, w = Math.ceil(m.W), sites = [];
    // The bottom of the line, drawn once: the row just above the baseline gives the feet, and the lowest
    // ink in every column (round bottoms and descenders included) is where bubbles start. Reading pixels
    // back is the slow part, so each canvas is read once and kept off the GPU (willReadFrequently).
    // Measured as if the letters were at most 80px (k): this is setup, run before the pour, and full
    // resolution on a big heading costs tens of milliseconds even on a fast machine. Positions come out
    // within a couple of pixels, well inside each bubble's own random start.
    var k = Math.min(1, 80 / m.fs), kw = Math.ceil(w * k);
    var top = Math.floor(line.base - 0.3 * m.capH), hh = Math.ceil(0.3 * m.capH + 0.5 * m.fs), kh = Math.ceil(hh * k);
    var cb = document.createElement('canvas'); cb.width = kw; cb.height = kh;
    var ctx = cb.getContext('2d', { willReadFrequently: true });
    ctx.scale(k, k);
    ctx.font = font(m.fs);
    fillLine(ctx, line, m, top);
    var col = ctx.getImageData(0, 0, kw, kh).data, ro = Math.min(kh - 1, Math.max(0, Math.round((y - top) * k))) * kw * 4;
    var a = col.subarray(ro, ro + kw * 4), runs = [], start = -1;
    for (var x = 0; x <= kw; x++) {
      var ink = x < kw && a[x * 4 + 3] > 128;
      if (ink && start < 0) start = x;
      if (!ink && start >= 0) { if (x - start >= 0.035 * m.fs * k) runs.push({ x: (start + x) / 2 / k, w: (x - start) / k }); start = -1; }
    }
    if (!runs.length) runs = [{ x: line.x + line.w * 0.3, w: 4 }, { x: line.x + line.w * 0.7, w: 4 }];
    var kb = new Float32Array(kw).fill(NaN), found = new Uint8Array(kw);
    for (var by = kh - 1; by >= 0; by--) {        // row by row from the bottom: memory order, so it stays fast
      for (var bx = 0, bo = by * kw * 4 + 3; bx < kw; bx++, bo += 4) if (!found[bx] && col[bo] > 128) { found[bx] = 1; kb[bx] = top + (by + 0.5) / k; }
    }
    g.inkBottom = new Float32Array(w);
    g.inkXs = [];                                  // every solid point along the bottom: where the wall of bubbles rises from
    for (var ix = 0; ix < w; ix++) {
      var kx = Math.min(kw - 1, Math.floor(ix * k));
      g.inkBottom[ix] = kb[kx];
      if (a[kx * 4 + 3] > 128 && kb[kx] === kb[kx]) g.inkXs.push(ix);
    }
    if (!g.inkXs.length) runs.forEach(function (r0) { g.inkXs.push(r0.x); });

    // Streams start where a bubble stays visible on its way up: score every column by how much of it is
    // letter rather than gap (a stem scores high, the bar under a C's opening low), mostly within its own
    // line and partly from the surface down, averaged across the width a stream wobbles over.
    var y0 = Math.floor(g.surf), y1 = Math.ceil(line.base + 0.5 * m.fs);
    var cw = Math.ceil(w * k), ch = Math.max(1, Math.ceil((y1 - y0) * k));
    var cc = document.createElement('canvas'); cc.width = cw; cc.height = ch;
    var ccx = cc.getContext('2d', { willReadFrequently: true });
    ccx.scale(k, k);
    ccx.font = font(m.fs);
    m.lines.forEach(function (l) { fillLine(ccx, l, m, y0); });
    var all = ccx.getImageData(0, 0, cw, ch).data, cover = new Float32Array(cw);
    var own = Math.max(0, Math.round((line.base - m.capH - y0) * k));       // the row where the stream's own line starts
    // Ink only counts with a little stroke on both sides of it, so a stream sits inside its letters
    // rather than on a sliver where two lines' strokes barely overlap.
    var margin = Math.max(1, Math.round(0.03 * m.fs * k)), edge = new Int16Array(cw * ch);
    for (var ry = 0; ry < ch; ry++) {
      var run = 0, o = ry * cw;
      for (var rx = 0; rx < cw; rx++) { run = all[(o + rx) * 4 + 3] > 128 ? run + 1 : 0; edge[o + rx] = run; }
      for (run = 0, rx = cw - 1; rx >= 0; rx--) { run = edge[o + rx] ? run + 1 : 0; edge[o + rx] = Math.min(edge[o + rx], run); }
    }
    for (var sx = 0; sx < cw; sx++) {
      var ib = g.inkBottom[Math.min(w - 1, Math.floor((sx + 0.5) / k))], bot = ib === ib ? ib : line.base;
      var rows = Math.max(1, Math.min(ch, Math.round((bot - y0) * k))), inked = 0, mine = 0;
      for (var sy = 0; sy < rows; sy++) if (edge[sy * cw + sx] > margin) { inked++; if (sy >= own) mine++; }
      cover[sx] = 0.7 * mine / Math.max(1, rows - own) + 0.3 * inked / rows;
    }
    var hw = Math.max(1, Math.round(0.02 * m.fs * k));
    function score(x) {
      var t = 0, n0 = 0;
      for (var d = -hw; d <= hw; d++) { var xx = Math.round(x * k) + d; t += xx >= 0 && xx < cw ? cover[xx] : 0; n0++; }
      return t / n0;
    }
    // One candidate per letter foot.
    function letterAt(x) {                         // which letter of the line a foot belongs to, from where each was laid out
      var r = '';
      line.chars.forEach(function (c) { if (c.c !== ' ' && x >= c.x) r = c.c.toLowerCase(); });
      return r;
    }
    var cands = runs.map(function (r0) {
      var xa = Math.ceil(r0.x - r0.w / 2), xb = Math.floor(r0.x + r0.w / 2), bs = -1, x1, sc = [];
      for (x1 = xa; x1 <= xb; x1++) { sc.push(score(x1)); bs = Math.max(bs, sc[sc.length - 1]); }
      // The middle of the widest stretch that scores near the best, so a stream sits inside its stroke, not on the edge.
      var best = r0.x, len = 0, start = -1;
      for (x1 = 0; x1 <= sc.length; x1++) {
        if (x1 < sc.length && sc[x1] >= bs - 0.02) { if (start < 0) start = x1; }
        else if (start >= 0) { if (x1 - start > len) { len = x1 - start; best = xa + (start + x1 - 1) / 2; } start = -1; }
      }
      // The middle of the letter's foot, as on the original site: a curve or a slant there lets bubbles slip
      // in and out of view, which reads as natural. A foot that would hide most of its stream (under a C's
      // opening, a D's hollow) falls back to the letter's most solid column.
      var cs = score(r0.x);
      return cs >= 0.45 ? { x: r0.x, w: r0.w, s: cs, ch: letterAt(r0.x) } : { x: best, w: r0.w, s: bs, ch: letterAt(r0.x) };
    });
    // Feet spaced evenly along the line, as the original picks them. A foot that is still mostly hidden, sits
    // too close to a stream, or is in a letter that already has one (a repeated letter repeats its pattern)
    // gives way to its nearest neighbor. A slot left empty that way tries again allowing a repeated letter,
    // so a word like WWW still gets its streams.
    var gap = g.Wg / (2 * n), empty = [];
    function pick(si, distinct) {
      var at = n > 1 ? Math.round(si * (cands.length - 1) / (n - 1)) : Math.floor(cands.length / 2);
      for (var off = 0; off < cands.length; off++) {
        var c0 = cands[at + (off % 2 ? (off + 1) / 2 : -off / 2)];
        if (!c0 || c0.s < 0.45 || sites.some(function (s0) { return Math.abs(s0.x - c0.x) < gap || (distinct && c0.ch && s0.ch === c0.ch); })) continue;
        var by0 = g.inkBottom[Math.round(c0.x)];
        sites.push({ x: c0.x, w: c0.w, y: by0 === by0 ? by0 : y, next: Math.random() * 0.4, k: 1, s: c0.s, ch: c0.ch });
        return true;
      }
      return false;
    }
    for (var si = 0; si < n; si++) if (!pick(si, true)) empty.push(si);
    empty.forEach(function (si) { pick(si, false); });
    if (!sites.length && runs.length) sites.push({ x: runs[0].x, w: runs[0].w, y: y, next: 0, k: 1, s: 0 });
    sites.sort(function (p, q) { return p.x - q.x; });
    // The middle streams run calmer than the outer ones.
    sites.forEach(function (s1, i1) { if (i1 > 0 && i1 < sites.length - 1) s1.k = 0.6; });
    return sites;
  }

  function surfaceAt(g, x) {   // the liquid surface as last drawn
    var pts = g.surfPts, n = pts.length, f = Math.max(0, Math.min(n - 1, (x - g.minX) / g.Wg * (n - 1)));
    var j = Math.floor(f), k = Math.min(n - 1, j + 1);
    return pts[j][1] + (pts[k][1] - pts[j][1]) * (f - j);
  }

  // Bubble physics in font-size units: start slow, accelerate, wobble, fan out a little.
  function spawn(g, x, y, r) {
    for (var k = 0; k < g.fizz.length; k++) if (!g.fizz[k].live) {
      var b = g.fizz[k], fs = g.fs;
      // Each bubble starts a little higher or lower; bubbles released in the same frame would otherwise
      // rise in perfectly level rows.
      y -= Math.random() * 0.04 * fs;
      b.live = true; b.x0 = x; b.x = x; b.y = y; b.y0 = y; b.r = r; b.v = 0;
      b.drift = (Math.random() - 0.5) * 0.08 * fs; b.amp = 0.004 * fs; b.f = 0.8 + 1.4 * Math.random(); b.ph = Math.random() * 6.28;
      return true;
    }
    return false;
  }

  // Bubble physics, in font-size units with the pour's compressed time. A beer bubble is coated in
  // proteins, so it rises like a small rigid sphere: terminal speed grows with the square of its radius
  // (Stokes), reached almost at once. Dissolved CO2 diffuses in on the way up, so its radius grows at a
  // steady rate, and it speeds up as it rises: a stream's bubbles spread apart toward the top, and in the
  // pour's cloud the big ones race ahead of the fine ones.
  var GROW = 0.0008, V_REF = 1.0, R_REF = 0.009, V_MAX = 2.5;
  var WALL_K = 2.1;
  // Going flat: once the pour stops, CO2 leaks out through the surface and feeds the bubbles, so less is
  // left to make new ones. Carbonation falls exponentially toward a floor; streams release less often and
  // bubbles grow more slowly. A real beer takes 20-30 minutes; like the head, this is compressed (time
  // constant three minutes), and it never goes fully flat, so a page left open stays alive but calmer.
  var FLAT_TAU = 180, FLAT_FLOOR = 0.35;
  // A stream comes from a microscopic speck in the glass; now and then a speck stalls for a few seconds
  // and restarts (on average once every 40 s, for 2-8 s, and never two streams at once). A stream alone on
  // its half of the heading never stalls, so neither side goes bare.
  var STALL_EVERY = 40;
  // Drawn larger than modeled: at true proportions a newborn bubble is under a pixel and all but vanishes.
  // Only the picture is scaled; speed and growth still come from the modeled size.
  // Sizes are kept to scale with the letters for the physics (speed comes from size relative to the font);
  // only the drawing has a floor, so small text gets the same slow, dense streams as large text.
  function shown(r) { return Math.max(1, 1.5 * r); }
  function fizzStep(g, dt, rate, wall) {
    var fs = g.fs, i, b;
    if (!(playing && sim && sim.pouring)) g.flatT = (g.flatT || 0) + dt;
    var co2 = FLAT_FLOOR + (1 - FLAT_FLOOR) * Math.exp(-(g.flatT || 0) / FLAT_TAU);
    // The wall: air dragged in by the pour rises as fine bubbles from all across the bottom.
    if (wall > 0 && g.sites.length && surfaceAt(g, g.inkXs[0]) < g.sites[0].y - 2) {
      var due = wall * dt, n = Math.floor(due) + (Math.random() < due % 1 ? 1 : 0);
      for (var w0 = 0; w0 < n; w0++) {
        var wx = g.inkXs[Math.floor(Math.random() * g.inkXs.length)], wr = fs * (0.003 + 0.005 * Math.random());
        var wy = g.inkBottom[Math.round(wx)];
        // From the bottom of the stroke; a small spread still keeps the first bubbles out of level rows.
        if (!spawn(g, wx, (wy === wy ? wy : g.sites[0].y) - wr, wr)) break;
      }
    }
    for (i = 0; i < g.sites.length; i++) {
      var st = g.sites[i];
      if (surfaceAt(g, st.x) > st.y - 2) continue;            // no beer above this point yet
      if (st.off > 0) { st.off -= dt; continue; }
      if (Math.random() < dt / STALL_EVERY && !g.sites.some(function (s0) { return s0.off > 0; }) &&
          g.sites.some(function (s0) { return s0 !== st && (s0.x < g.minX + g.Wg / 2) === (st.x < g.minX + g.Wg / 2); })) { st.off = 2 + 6 * Math.random(); continue; }
      st.next -= dt * rate * st.k * co2;
      // Each stream comes from one speck in the glass with a beat of its own, steady but not exact,
      // and now and then it stutters.
      if (!st.period) st.period = 0.3 + 0.4 * Math.random();
      while (st.next <= 0) {
        st.next += st.period * (0.85 + 0.3 * Math.random()) + (Math.random() < 0.06 ? 0.4 + 0.8 * Math.random() : 0);
        // Real nucleation is untidy: bubbles leave anywhere across the bottom of the stroke and wander as
        // they rise. A neat single file reads as machined, so keep the scatter and only aim its middle.
        var sr = fs * (0.003 + 0.003 * Math.random()), sx0 = st.x + (Math.random() - 0.5) * 0.4 * st.w;
        var sb = g.inkBottom[Math.round(sx0)];
        spawn(g, sx0, (sb > 0 ? sb : st.y) - sr, sr);
      }
    }
    for (i = 0; i < g.fizz.length; i++) {
      b = g.fizz[i];
      if (!b.live) continue;
      b.r = Math.min(0.03 * fs, b.r + GROW * co2 * fs * dt);
      var vt = Math.min(V_MAX, V_REF * Math.pow(b.r / (R_REF * fs), 2)) * fs;
      b.v += (vt - b.v) * Math.min(1, dt / 0.05);
      b.y -= b.v * dt; b.ph += b.f * dt;
      // The slow drift stands in for the convection currents of a real glass, which the simulation doesn't model.
      b.x0 += b.drift * dt * Math.min(1, (b.y0 - b.y) / (2 * fs));
      b.x = b.x0 + Math.sin(b.ph) * b.amp;
      var sY = surfaceAt(g, b.x);
      if (b.y - b.r <= sY) {                                      // reached the surface: it joins the head
        b.live = false;
        for (var q = 0; q < g.pops.length; q++) if (g.pops[q].age >= 0.24) { var pp = g.pops[q]; pp.age = 0; pp.x = b.x; pp.y = sY; pp.r = 1.6 * shown(b.r); break; }
      }
    }
    for (i = 0; i < g.pops.length; i++) if (g.pops[i].age < 0.24) g.pops[i].age += dt;
  }

  function fizzDraw(g) {
    var ctx = g.ctx, i, any = false;
    ctx.clearRect(0, 0, g.canvas.width, g.canvas.height);
    ctx.beginPath();                                       // all live bubbles in one path, one fill
    for (i = 0; i < g.fizz.length; i++) {
      var b = g.fizz[i];
      if (!b.live) continue;
      var rd = shown(b.r); ctx.moveTo(b.x + rd, b.y); ctx.arc(b.x, b.y, rd, 0, 6.2832); any = true;
    }
    ctx.fillStyle = colors.fizz;
    ctx.globalAlpha = 0.8;
    if (any) ctx.fill();
    for (i = 0; i < g.pops.length; i++) {                  // pops fade as they join the head
      var p = g.pops[i];
      if (p.age >= 0.24) continue;
      ctx.globalAlpha = 0.8 * (1 - p.age / 0.24);
      ctx.fillStyle = colors.foam;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill(); any = true;
    }
    ctx.globalAlpha = 1;
    if (any) {                                             // keep only what lies inside the letters
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(g.mask, 0, 0);
      ctx.restore();
    }
  }

  function fizzReset(g) { g.flatT = 0; g.sites.forEach(function (s0) { s0.off = 0; }); g.fizz.forEach(function (b) { b.live = false; }); g.pops.forEach(function (p) { p.age = 1; }); fizzDraw(g); }

  // After the pour the fizz runs alone at 30 fps, only while the heading is on screen and the tab visible.
  function canFizz() { return !!G && !dead && !reduce && !document.hidden && onScreen; }
  function startFizz() { if (fizzRaf || playing || !canFizz()) return; fizzLast = 0; fizzRaf = requestAnimationFrame(fizzTick); }
  function stopFizz() { cancelAnimationFrame(fizzRaf); fizzRaf = 0; }
  var fizzTick = safe(function (now) {
    fizzRaf = 0;
    if (playing || !canFizz()) return;
    var dt = fizzLast ? Math.min(0.1, (now - fizzLast) / 1000) : 0;
    fizzLast = now; fizzAcc += dt;
    if (fizzAcc >= 1 / 30) { fizzStep(G, fizzAcc, 1.4, 0); fizzDraw(G); fizzAcc = 0; }
    fizzRaf = requestAnimationFrame(fizzTick);
  });

  // What to draw at a moment: the simulation, blended onto the exact still frame as it lands.
  function frameState(g, simState, done) {
    var N = 48, st = { cols: [] };
    if (done) {
      st.level = g.hFinal; st.haze = 0; st.since = Infinity; st.blend = 1;
    } else {
      st.since = simState.pouring ? -1 : simState.t - simState.stopT;
      st.blend = simState.pouring ? 0 : smoothstep(LAND_START, LAND_END, st.since);
      st.level = simState.hl + (g.hFinal - simState.hl) * st.blend;
      st.haze = simState.haze * (1 - st.blend);
    }
    for (var j = 0; j < N; j++) {
      var wave = done ? 0 : simState.h[j] * (1 - st.blend);
      var foam = done ? g.foamTarget : (simState.wet[j] + simState.dry[j]) * (1 - st.blend) + g.foamTarget * st.blend;
      st.cols.push({ x: g.minX + g.Wg * j / (N - 1), y: g.bottom - st.level + wave, foam: foam });
    }
    st.ip = done ? 0 : simState.ip;
    return st;
  }

  function draw(g, st) {
    var cols = st.cols, n = cols.length, surf = [], top = [], low = [], creamTop = [];
    for (var i = 0; i < n; i++) {
      var c = cols[i];
      var ys = (cols[Math.max(0, i - 1)].y + 2 * c.y + cols[Math.min(n - 1, i + 1)].y) / 4;   // foam rides a smoothed surface
      surf.push([c.x, c.y]);
      top.push([c.x, Math.max(g.ceiling, ys - c.foam - g.lumps[i] * 0.07 * Math.min(c.foam, g.headT))]);
      low.push([c.x, c.y + 0.05 * g.H]);
      creamTop.push([c.x, c.y - Math.min(0.14 * g.headT, 0.35 * c.foam)]);
    }
    g.surfPts = surf;
    var mean = g.bottom - st.level, xL = f1(g.minX), xR = f1(g.maxX), floor = f1(g.Hsvg + 2);
    var surfD = smooth(surf, 'M');
    var beerD = surfD + 'L' + xR + ',' + floor + 'L' + xL + ',' + floor + 'Z';
    g.beer.setAttribute('d', beerD);
    g.beerClipPath.setAttribute('d', beerD);
    g.shadeBand.setAttribute('d', surfD + smooth(rev(low), 'L') + 'Z');
    var foamD = smooth(top, 'M') + smooth(rev(surf), 'L') + 'Z';
    g.foam.setAttribute('d', foamD);
    g.foamClipPath.setAttribute('d', foamD);
    g.creamBand.setAttribute('d', smooth(creamTop, 'M') + smooth(rev(surf), 'L') + 'Z');
    g.meniscus.setAttribute('d', surfD);
    g.shade.setAttribute('y1', f1(mean)); g.shade.setAttribute('y2', f1(mean + 0.05 * g.H));
    g.cream.setAttribute('y1', f1(mean)); g.cream.setAttribute('y2', f1(mean - 0.14 * g.headT));

    // Haze of entrained air below the impact.
    if (st.haze > 0.01) {
      var depth = g.bottom - mean, ix = cols[st.ip].x;
      g.haze.setAttribute('cx', f1(ix)); g.haze.setAttribute('cy', f1(mean + 0.4 * depth));
      g.haze.setAttribute('rx', f1(0.16 * g.Wg)); g.haze.setAttribute('ry', f1(0.5 * depth + 2));
      g.haze.setAttribute('opacity', st.haze.toFixed(3));
    } else g.haze.setAttribute('opacity', 0);

    // Foam bubbles ride the head; they shrink where it is thin, coarsen a little with age, and some pop as it settles.
    var age = st.since === Infinity ? 1 : Math.max(0, Math.min(1, (st.since + 2) / 4));
    for (var b = 0; b < g.bubbles.length; b++) {
      var bu = g.bubbles[b], fx = bu.u * (n - 1), j0 = Math.floor(fx), j1 = Math.min(n - 1, j0 + 1), w = fx - j0;
      var x = cols[j0].x + (cols[j1].x - cols[j0].x) * w;
      var tY = top[j0][1] + (top[j1][1] - top[j0][1]) * w, sY = surf[j0][1] + (surf[j1][1] - surf[j0][1]) * w;
      // Never-popping bubbles have pop = Infinity; in the still frame since is Infinity too, and Infinity - Infinity is NaN.
      var thick = sY - tY, popped = bu.pop !== Infinity && st.since >= bu.pop ? Math.max(0, 1 - (st.since - bu.pop) / 0.18) : 1;
      // A foam bubble under a 2px radius reads as a grey speck, not a bubble (a small heading on a
      // phone makes most of them that small), so it isn't drawn: a real head that size looks smooth too.
      var r = thick < 2 || bu.r0 < 2 ? 0 : bu.r0 * Math.sqrt(Math.min(1, thick / g.headT)) * (0.8 + 0.2 * age) * popped;
      var y = tY + bu.d * thick;
      bu.el.setAttribute('cx', f1(x)); bu.el.setAttribute('cy', f1(y)); bu.el.setAttribute('r', f1(r));
      if (bu.hi) { bu.hi.setAttribute('cx', f1(x - r * 0.35)); bu.hi.setAttribute('cy', f1(y - r * 0.35)); bu.hi.setAttribute('r', f1(r * 0.28)); }
    }
  }

  function stillFrame() {
    cancelAnimationFrame(raf); raf = 0; playing = false;
    if (G) { draw(G, frameState(G, null, true)); startFizz(); }
    settle();
  }

  var frame = safe(function (now) {
    if (!playing) return;
    var T = (now - t0 - HOLD) / 1000;                 // the simulation steps on elapsed time, never frame count
    if (T < 0) { raf = requestAnimationFrame(frame); return; }
    // A stall over 2 s (system sleep, a frozen tab that sent no visibilitychange) is not a frame gap:
    // cut to the still frame instead of simulating hours of catch-up on one frame.
    if (T - sim.t > 2) { stillFrame(); return; }
    var before = sim.t;
    sim.advanceTo(T);
    if (!sim.pouring && sim.t - sim.stopT >= LAND_END) { stillFrame(); return; }
    draw(G, frameState(G, sim, false));
    // Carbonation: the wall is air the falling stream drags under. It scales with how much beer is
    // arriving and with the stream's impact energy, which grows with how far it falls (from just above
    // the rim to the surface), so it is strongest early, tapers as the glass fills and the pour eases,
    // and stops the moment the stream does. What lingers is the cloud already in the beer, clearing at
    // each bubble's own speed.
    var fall = Math.max(0, 1.15 * G.H - sim.hl);
    fizzStep(G, sim.t - before, 1.4, G.wall0 * WALL_K * (sim.Q / sim.QMAX) * (fall / (1.15 * G.H)));
    fizzDraw(G);
    raf = requestAnimationFrame(frame);
  });

  function play() {
    if (!G || reduce || !onScreen || document.hidden) { stillFrame(); return; }   // nobody would see it: the full pint
    cancelAnimationFrame(raf);
    if (!G.tune) G.tune = calibratePour(G.geo);
    sim = createPourSim(G.geo, G.tune);
    stopFizz(); fizzReset(G);
    draw(G, frameState(G, sim, false));                 // the empty glass
    if (o.once === 'session') markPlayed();             // only once a pour has really begun
    playing = true; t0 = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // One queued draw at a time: a newer one replaces it, keeping a queued pour.
  function mount(andPlay) {
    if (mountRaf) { cancelAnimationFrame(mountRaf); mountRaf = 0; andPlay = andPlay || mountPlay; }
    var m = measure();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!m || !(m.capH > 0) || m.W * m.H * dpr * dpr > MAX_PIXELS) { if (G) destroy(); else { want = null; settle(); } return; }   // no usable metrics or unsupported typography: the plain heading, never a broken overlay
    var next = build(m);
    mountPlay = andPlay;
    mountRaf = requestAnimationFrame(safe(function () {
      mountRaf = 0;
      // Swap rule: the overlay appears and the HTML text goes transparent in the same frame.
      if (G) { G.svg.remove(); G.canvas.remove(); G.clip.remove(); }   // the old clip goes first: the new one reuses its id
      G = next;
      holder().appendChild(G.clip);
      if (!saved) {
        saved = { position: grab('position'), color: grab('color'), fill: grab('-webkit-text-fill-color') };
        if (cs.position === 'static') target.style.position = 'relative';
        hide();
      }
      target.appendChild(G.svg);
      target.appendChild(G.canvas);
      if (want) { andPlay = want === 'play'; want = null; }
      if (andPlay) play(); else stillFrame();
    }));
  }

  function key() { return 'beer-text:' + target.textContent.trim(); }
  function playedThisSession() { try { return sessionStorage.getItem(key()) === '1'; } catch (e) { return false; } }
  function markPlayed() { try { sessionStorage.setItem(key(), '1'); } catch (e) { /* storage blocked: it may replay, harmless */ } }

  var onVisibility = safe(function () { if (document.hidden) { if (playing) stillFrame(); stopFizz(); } else startFizz(); });
  var onReduce = safe(function () { reduce = mqReduce.matches; if (reduce) { finish(); stopFizz(); } else startFizz(); });
  var onForced = safe(function () { if (mqForced.matches) destroy(); });

  // Public controls.
  // Before the first draw, or while a draw is queued, a replay() or finish() is remembered and honored then.
  function replay() {
    newPour(); want = null;
    if (mountRaf) want = 'play';
    else if (G) play(); else if (started) mount(true); else { want = 'play'; if (ready) start(true); }
  }
  function finish() {
    if (mountRaf || !G) { want = 'still'; if (G) stillFrame(); if (ready && !started) start(false); } else stillFrame();
  }
  function destroy() {
    if (dead) return;
    dead = true; playing = false;
    try {
      cancelAnimationFrame(raf); cancelAnimationFrame(mountRaf); stopFizz();
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      if (waiter) waiter.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      listen('removeEventListener');
      if (owners.get(target) === ctl) owners.delete(target);
      if (G) {
        G.svg.remove(); G.canvas.remove(); G.clip.remove(); G = null;
        var h = document.querySelector('svg[data-beer-text="defs"]');
        if (h && !h.firstChild) h.remove();
      }
    } finally {   // whatever else fails, the text comes back and finished settles
      if (saved) {
        put('position', saved.position); put('color', saved.color); put('-webkit-text-fill-color', saved.fill);
        saved = null;
      }
      settle();
    }
  }

  function listen(how) {
    if (mqReduce && mqReduce[how]) mqReduce[how]('change', onReduce);
    if (mqForced && mqForced[how]) mqForced[how]('change', onForced);
  }
  document.addEventListener('visibilitychange', onVisibility);
  listen('addEventListener');
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(safe(function (e) {
      onScreen = e[0].isIntersecting;
      if (!onScreen) { if (playing) stillFrame(); stopFizz(); } else startFizz();
    }));
    io.observe(target);
  }

  function start(andPlay) {
    if (waiter) { waiter.disconnect(); waiter = null; }
    if (started) return;
    started = true;
    mount(andPlay);
    lastW = target.clientWidth; lastH = target.clientHeight;
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(safe(function () {
        // A new width rewraps the lines; a new height means the font size or line height changed.
        var w = target.clientWidth, hh = target.clientHeight;
        if (Math.abs(w - lastW) > 0.5 || Math.abs(hh - lastH) > 0.5) { lastW = w; lastH = hh; mount(false); }   // re-measure and redraw the still frame, never replay
      }));
      ro.observe(target);
    }
  }

  var txt = target.textContent;
  // Capitalize's capitals can follow a <br> that textContent doesn't show, so it asks for both cases.
  fontReady(function () { return font(10); }, cs.textTransform === 'capitalize' ? txt + txt.toUpperCase() : transform(txt, cs.textTransform)).then(safe(function (ok) {
    if (!ok) { destroy(); return; }      // the font never arrived: the plain heading stays
    ready = true;
    if (want) { start(want === 'play'); return; }
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    var reloaded = !!nav && nav.type === 'reload';
    var wantPour = autoplay && !reduce && (o.once !== 'session' || reloaded || !playedThisSession());
    // A pour waits until the heading is mostly in view; the plain heading shows until then.
    if (wantPour && 'IntersectionObserver' in window) {
      waiter = new IntersectionObserver(safe(function (e) {
        if (e[0].intersectionRatio >= 0.6 || (e[0].isIntersecting && e[0].intersectionRect.height >= 0.6 * innerHeight)) start(true);
      }), { threshold: [0, 0.6, 1] });
      waiter.observe(target);
    } else start(wantPour);
  }));

  return ctl;
}
