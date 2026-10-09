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
var count = 0;

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
function el(n, a, p) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
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
function transform(text, tt) {
  if (tt === 'uppercase') return text.toUpperCase();
  if (tt === 'lowercase') return text.toLowerCase();
  if (tt === 'capitalize') return text.replace(/(^|\s)(\S)/g, function (m, s, c) { return s + c.toUpperCase(); });
  return text;
}

// Wait for the heading's own font. fonts.ready can resolve before a display=swap face is even requested,
// so ask for the face and poll check(); a system font passes check() at once.
function fontReady(spec) {
  var start = performance.now();
  return new Promise(function (done) {
    (function attempt() {
      document.fonts.load(spec).then(function () {
        if (document.fonts.check(spec)) return done(true);
        if (performance.now() - start > 2500) return done(false);
        setTimeout(attempt, 100);
      }, function () { done(false); });
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
 * @param {number} [options.head] - the settled head, as a fraction of the letters' height. By default a one-line
 *   heading gets 0.27; a longer one gets a head that fills the top two-thirds of its first line, so the beer
 *   shows in that line as well as the ones below.
 * @param {boolean} [options.autoplay=true] - pour when the heading is mostly in view; false shows the full pint.
 * @param {false|'session'} [options.once=false] - 'session' pours once per browser session (a reload pours again).
 * @returns {{ finished: Promise<void>, replay: function, finish: function, destroy: function }}
 */
export function pour(target, options) {
  var o = options || {};
  var colors = Object.assign({}, presets[o.preset] || presets.lager, o.colors || {});
  var head = o.head == null ? null : clamp(+o.head, 0.05, 0.6);
  var autoplay = o.autoplay !== false;
  var id = 'beer-text-' + (++count) + '-';
  var G = null, lastW = 0, raf = 0, t0 = 0, playing = false, sim = null, dead = false;
  var fizzRaf = 0, fizzLast = 0, fizzAcc = 0, onScreen = true, ro = null, io = null, waiter = null;
  var saved = null, resolveFinished = null;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ctl = { finished: Promise.resolve(), replay: replay, finish: finish, destroy: destroy };

  function settle() { if (resolveFinished) { resolveFinished(); resolveFinished = null; } }
  function newPour() { settle(); ctl.finished = new Promise(function (r) { resolveFinished = r; }); }
  newPour();

  var forced = window.matchMedia && matchMedia('(forced-colors: active)').matches;   // system colors win: no overlay
  if (!target || !document.fonts || !window.requestAnimationFrame || forced) { settle(); return ctl; }
  var cs = getComputedStyle(target), emptyColor = o.empty || cs.color;   // read before the text goes transparent

  function font(size) { return cs.fontStyle + ' ' + cs.fontWeight + ' ' + size + 'px ' + cs.fontFamily; }

  // Lines as laid out: one Range per character, grouped where the top jumps; the baseline from one probe.
  function measure() {
    cs = getComputedStyle(target);
    var hr = target.getBoundingClientRect(), ox = hr.left + target.clientLeft, oy = hr.top + target.clientTop;
    var fs = parseFloat(cs.fontSize), ls = parseFloat(cs.letterSpacing) || 0;
    var walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentNode.closest('[data-beer-text]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var range = document.createRange(), lines = [], cur = null, n;
    while ((n = walker.nextNode())) {
      var s = n.nodeValue;
      for (var i = 0; i < s.length; i++) {
        var len = s.codePointAt(i) > 0xFFFF ? 2 : 1;
        range.setStart(n, i); range.setEnd(n, i + len);
        var r = range.getClientRects()[0];
        if (r && r.width > 0 && r.height > 0) {
          if (!cur || r.top > cur.top + 0.5 * r.height) lines.push(cur = { top: r.top, chars: [] });
          cur.chars.push({ c: /\s/.test(s[i]) ? ' ' : s.substr(i, len), l: r.left, r: r.right });
        }
        i += len - 1;
      }
    }
    lines = lines.map(function (ln) {
      var ch = ln.chars;
      while (ch.length && ch[0].c === ' ') ch.shift();
      while (ch.length && ch[ch.length - 1].c === ' ') ch.pop();
      if (!ch.length) return null;
      return { text: transform(ch.map(function (c) { return c.c; }).join('').replace(/ +/g, ' '), cs.textTransform), x: ch[0].l - ox, w: ch[ch.length - 1].r - ch[0].l, top: ln.top };
    }).filter(Boolean);
    if (!lines.length) return null;
    var probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    target.appendChild(probe);
    var pr = probe.getBoundingClientRect(), near = lines[lines.length - 1];
    lines.forEach(function (ln) { if (Math.abs(ln.top - pr.top) < Math.abs(near.top - pr.top)) near = ln; });
    var off = pr.bottom - near.top;
    probe.remove();
    lines.forEach(function (ln) { ln.base = ln.top + off - oy; });
    var ctx = document.createElement('canvas').getContext('2d');
    ctx.font = font(fs);
    var W = target.clientWidth, H = target.clientHeight;
    return { W: W, H: H, fs: fs, ls: ls, lines: lines, capH: ctx.measureText(lines[0].text).actualBoundingBoxAscent };
  }

  function build(m) {
    var L = m.lines, g = {};
    var last = L[L.length - 1];
    g.top = L[0].base - m.capH; g.bottom = last.base; g.H = g.bottom - g.top;
    g.surf = head != null ? g.top + head * g.H : L.length > 1 ? L[0].base - 0.32 * m.capH : g.top + 0.27 * g.H;
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
    L.forEach(function (l) {
      var t = el('text', { x: l.x, y: l.base, 'font-family': cs.fontFamily, 'font-size': m.fs, 'font-weight': cs.fontWeight, 'font-style': cs.fontStyle, 'letter-spacing': m.ls, textLength: l.w, lengthAdjust: 'spacing' }, clip);
      t.textContent = l.text;
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
    g.sites = findSites(m, last, Math.round(clamp(g.Wg / 75, 2, 4)), g);
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
    if ('letterSpacing' in mc) mc.letterSpacing = m.ls + 'px';
    mc.fillStyle = '#000';
    L.forEach(function (l) { mc.fillText(l.text, l.x, l.base); });
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
    if ('letterSpacing' in ctx) ctx.letterSpacing = m.ls + 'px';
    ctx.fillText(line.text, line.x, line.base - top);
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
    if ('letterSpacing' in ccx) ccx.letterSpacing = m.ls + 'px';
    m.lines.forEach(function (l) { ccx.fillText(l.text, l.x, l.base - y0); });
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
    function letterAt(x) {                         // which letter of the line a foot belongs to
      for (var li = 0; li < line.text.length; li++) if (x < line.x + ctx.measureText(line.text.slice(0, li + 1)).width) return line.text[li].toLowerCase();
      return '';
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
    // gives way to its nearest neighbor.
    var gap = g.Wg / (2 * n);
    for (var si = 0; si < n; si++) {
      var at = n > 1 ? Math.round(si * (cands.length - 1) / (n - 1)) : Math.floor(cands.length / 2);
      for (var off = 0; off < cands.length; off++) {
        var c0 = cands[at + (off % 2 ? (off + 1) / 2 : -off / 2)];
        if (!c0 || c0.s < 0.45 || sites.some(function (s0) { return Math.abs(s0.x - c0.x) < gap || (c0.ch && s0.ch === c0.ch); })) continue;
        var by0 = g.inkBottom[Math.round(c0.x)];
        sites.push({ x: c0.x, w: c0.w, y: by0 === by0 ? by0 : y, next: Math.random() * 0.4, k: 1, s: c0.s, ch: c0.ch });
        break;
      }
    }
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
  // and restarts (on average once every 40 s, for 2-8 s, and never two streams at once).
  var STALL_EVERY = 40;
  // Drawn larger than modeled: at true proportions a newborn bubble is under a pixel and all but vanishes.
  // Only the picture is scaled; speed and growth still come from the modeled size.
  function shown(r) { return Math.max(1, 1.5 * r); }
  function fizzStep(g, dt, rate, wall) {
    var fs = g.fs, i, b;
    if (!(playing && sim && sim.pouring)) g.flatT = (g.flatT || 0) + dt;
    var co2 = FLAT_FLOOR + (1 - FLAT_FLOOR) * Math.exp(-(g.flatT || 0) / FLAT_TAU);
    // The wall: air dragged in by the pour rises as fine bubbles from all across the bottom.
    if (wall > 0 && g.sites.length && surfaceAt(g, g.inkXs[0]) < g.sites[0].y - 2) {
      var due = wall * dt, n = Math.floor(due) + (Math.random() < due % 1 ? 1 : 0);
      for (var w0 = 0; w0 < n; w0++) {
        var wx = g.inkXs[Math.floor(Math.random() * g.inkXs.length)], wr = Math.max(0.8, fs * (0.003 + 0.005 * Math.random()));
        var wy = g.inkBottom[Math.round(wx)];
        // From the bottom of the stroke; a small spread still keeps the first bubbles out of level rows.
        if (!spawn(g, wx, (wy === wy ? wy : g.sites[0].y) - wr, wr)) break;
      }
    }
    for (i = 0; i < g.sites.length; i++) {
      var st = g.sites[i];
      if (surfaceAt(g, st.x) > st.y - 2) continue;            // no beer above this point yet
      if (st.off > 0) { st.off -= dt; continue; }
      if (Math.random() < dt / STALL_EVERY && !g.sites.some(function (s0) { return s0.off > 0; })) { st.off = 2 + 6 * Math.random(); continue; }
      st.next -= dt * rate * st.k * co2;
      // Each stream comes from one speck in the glass with a beat of its own, steady but not exact,
      // and now and then it stutters.
      if (!st.period) st.period = 0.3 + 0.4 * Math.random();
      while (st.next <= 0) {
        st.next += st.period * (0.85 + 0.3 * Math.random()) + (Math.random() < 0.06 ? 0.4 + 0.8 * Math.random() : 0);
        // Real nucleation is untidy: bubbles leave anywhere across the bottom of the stroke and wander as
        // they rise. A neat single file reads as machined, so keep the scatter and only aim its middle.
        var sr = Math.max(0.6, fs * (0.003 + 0.003 * Math.random())), sx0 = st.x + (Math.random() - 0.5) * 0.4 * st.w;
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
  function fizzTick(now) {
    fizzRaf = 0;
    if (playing || !canFizz()) return;
    var dt = fizzLast ? Math.min(0.1, (now - fizzLast) / 1000) : 0;
    fizzLast = now; fizzAcc += dt;
    if (fizzAcc >= 1 / 30) { fizzStep(G, fizzAcc, 1.4, 0); fizzDraw(G); fizzAcc = 0; }
    fizzRaf = requestAnimationFrame(fizzTick);
  }

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

  function frame(now) {
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
  }

  function play() {
    if (!G || reduce) { stillFrame(); return; }
    cancelAnimationFrame(raf);
    if (!G.tune) G.tune = calibratePour(G.geo);
    sim = createPourSim(G.geo, G.tune);
    stopFizz(); fizzReset(G);
    draw(G, frameState(G, sim, false));                 // the empty glass
    playing = true; t0 = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function mount(andPlay) {
    var m = measure();
    if (!m || !(m.capH > 0)) { settle(); return; }   // no usable metrics: never swap the text out for a broken overlay
    var next = build(m);
    requestAnimationFrame(function () {
      if (dead) return;
      // Swap rule: the overlay appears and the HTML text goes transparent in the same frame.
      if (G) { G.svg.remove(); G.canvas.remove(); G.clip.remove(); }   // the old clip goes first: the new one reuses its id
      G = next;
      holder().appendChild(G.clip);
      if (!saved) {
        saved = { position: target.style.position, color: target.style.color, fill: target.style.webkitTextFillColor };
        if (cs.position === 'static') target.style.position = 'relative';
        target.style.color = 'transparent';
        target.style.webkitTextFillColor = 'transparent';
      }
      target.appendChild(G.svg);
      target.appendChild(G.canvas);
      if (andPlay) play(); else stillFrame();
    });
  }

  function key() { return 'beer-text:' + target.textContent.trim(); }
  function playedThisSession() { try { return sessionStorage.getItem(key()) === '1'; } catch (e) { return false; } }
  function markPlayed() { try { sessionStorage.setItem(key(), '1'); } catch (e) { /* storage blocked: it may replay, harmless */ } }

  function onVisibility() { if (document.hidden) { if (playing) stillFrame(); stopFizz(); } else startFizz(); }

  // Public controls.
  function replay() { if (dead) return ctl.finished; newPour(); if (G) play(); else mount(true); return ctl.finished; }
  function finish() { if (!dead && G) stillFrame(); return ctl.finished; }
  function destroy() {
    if (dead) return;
    dead = true; playing = false;
    cancelAnimationFrame(raf); stopFizz();
    if (ro) ro.disconnect();
    if (io) io.disconnect();
    if (waiter) waiter.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    if (G) {
      G.svg.remove(); G.canvas.remove(); G.clip.remove(); G = null;
      var h = document.querySelector('svg[data-beer-text="defs"]');
      if (h && !h.firstChild) h.remove();
    }
    if (saved) {
      target.style.position = saved.position; target.style.color = saved.color; target.style.webkitTextFillColor = saved.fill;
      saved = null;
    }
    settle();
  }

  document.addEventListener('visibilitychange', onVisibility);
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(function (e) {
      onScreen = e[0].isIntersecting;
      if (!onScreen) { if (playing) stillFrame(); stopFizz(); } else startFizz();
    });
    io.observe(target);
  }

  fontReady(font(10)).then(function (ok) {
    if (dead) return;
    if (!ok) { settle(); return; }      // the font never arrived: the plain heading stays
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    var reloaded = !!nav && nav.type === 'reload';
    var wantPour = autoplay && !reduce && (o.once !== 'session' || reloaded || !playedThisSession());
    var start = function (andPlay) {
      if (andPlay && o.once === 'session') markPlayed();
      mount(andPlay);
      lastW = target.clientWidth;
      if ('ResizeObserver' in window) {
        ro = new ResizeObserver(function () {
          var w = target.clientWidth;
          if (Math.abs(w - lastW) > 0.5) { lastW = w; mount(false); }   // re-measure and redraw the still frame, never replay
        });
        ro.observe(target);
      }
    };
    // A pour waits until the heading is mostly in view; the plain heading shows until then.
    if (wantPour && 'IntersectionObserver' in window) {
      waiter = new IntersectionObserver(function (e) {
        if (e[0].intersectionRatio >= 0.6 || (e[0].isIntersecting && e[0].intersectionRect.height >= 0.6 * innerHeight)) {
          waiter.disconnect(); waiter = null; start(true);
        }
      }, { threshold: [0, 0.6, 1] });
      waiter.observe(target);
    } else start(wantPour);
  });

  return ctl;
}
