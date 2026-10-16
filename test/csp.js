// Runs in csp.html under a strict Content Security Policy (style-src 'self'): the overlay must be positioned by
// styles the policy allows, and no policy violation may fire.
import { pour } from '../src/beer-text.js';

var violations = [], results = [];
document.addEventListener('securitypolicyviolation', function (e) { violations.push(e.violatedDirective + ' ' + (e.sample || '')); });
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

var h = document.getElementById('h'), c = pour(h, { autoplay: false });
await sleep(600);
var svg = h.querySelector('svg[data-beer-text]'), defs = document.querySelector('svg[data-beer-text="defs"]');
var pos = svg ? getComputedStyle(svg).position : 'no overlay', defsPos = defs ? getComputedStyle(defs).position : 'no holder';
results.push((pos === 'absolute' ? 'PASS' : 'FAIL') + ' the overlay is positioned over the heading  (' + pos + ')');
results.push((defsPos === 'absolute' ? 'PASS' : 'FAIL') + ' the letter-shape holder is out of the page flow  (' + defsPos + ')');
results.push((violations.length ? 'FAIL' : 'PASS') + ' no policy violations' + (violations.length ? '  (' + violations.join(' | ') + ')' : ''));
c.destroy();

var fails = results.filter(function (l) { return l[0] === 'F'; }).length;
document.title = 'beer-text csp: ' + (fails ? fails + ' FAIL' : 'ALL PASS');
results.push('\n' + (fails ? fails + ' FAIL' : 'ALL PASS'));
document.getElementById('out').textContent = results.join('\n');
if (/report/.test(location.search)) fetch('/__report?' + encodeURIComponent(navigator.userAgent + '\n' + results.join('\n'))).catch(function () {});
