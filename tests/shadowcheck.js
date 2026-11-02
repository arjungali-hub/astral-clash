// Does any function shadow a name it also calls?
//
//   node tests/shadowcheck.js
//
// NO BROWSER. This is a text check, and it belongs with the guards for the
// same reason i18n_audit does: it catches a whole build failing, in a second,
// without launching anything.
//
// WHY IT EXISTS. drawIntroOverlay's punch-in animation opened with
//
//     const t = Math.min(1, introTimer / 12);
//
// and `t` is the translator the rest of that file calls a few hundred times.
// The moment one string in that block was passed through t(), the call hit a
// number: "TypeError: t is not a function", and the online build never reached
// FIGHT at all.
//
// bootcheck caught that one in ten seconds, and only because the shadowed call
// sat on the path to every match. A `const t` in a branch that runs on a
// rematch, in one game mode, or after a specific ability would behave
// identically and be found by a player. The shape is what is dangerous, not
// the instance - so the shape is what is checked.
//
// WHAT IT DOES NOT DO: parse JavaScript. It reads one function body at a time
// by brace depth, which is enough for this and cannot be fooled in the
// direction that matters - a missed body is a missed warning, never a false
// alarm about code that is fine.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
    'index.html',
    path.join('local', 'index.html'),
    path.join('shared', 'common.js'),
    path.join('shared', 'i18n.js'),
    path.join('shared', 'touch.js'),
    path.join('shared', 'account.js'),
    path.join('shared', 'challenges.js'),
];

// WHICH NAMES, DERIVED RATHER THAN LISTED. The first version of this was a
// hand-written list - ['t', 's', 'f', 'c', 'e'] - and it immediately reported
// _hslToHex's `const f = (n) => {...}`, which calls f(0) three lines later and
// means exactly that. There is no outer f() for it to shadow, so the report
// was true about the shape and wrong about the code.
//
// A name is only shadowable if something actually declares it as a top-level
// function, so that is the question asked. Short names only: a local called
// `displayName` is nobody's accident, and a long list of them would bury the
// one case that matters. This currently resolves to exactly `t`, which is the
// honest answer - t() is the only one-or-two-character function in the
// codebase - and it will pick up the next one on its own.
function guardedNames(sources) {
    const found = new Set();
    for (const src of sources) {
        const re = /(?:^|\n)\s*function\s+([A-Za-z_$][\w$]?)\s*\(/g;
        let m;
        while ((m = re.exec(src))) found.add(m[1]);
    }
    return [...found];
}

// `const t = ...`, `let t = ...`, `var t = ...` - and not `const to = ...`,
// which is why the boundary is explicit.
const declRe = (name) =>
    new RegExp('(?:^|[;{}\\s])(?:const|let|var)\\s+' + name + '\\s*=', 'm');
// `t(` but not `.t(`, `_t(`, `at(`.
const callRe = (name) =>
    new RegExp('(?:^|[^.\\w$])' + name + '\\s*\\(', 'm');

// Every brace-balanced block that opens with a `{`, paired with the line it
// started on. Strings and comments are stripped first, crudely but
// conservatively: a stripped character can only hide a problem.
function blocks(src) {
    const out = [];
    let i = 0;
    const stack = [];
    while (i < src.length) {
        const ch = src[i];
        if (ch === '{') { stack.push(i); i++; continue; }
        if (ch === '}') {
            const start = stack.pop();
            if (start != null) out.push([start, i]);
            i++;
            continue;
        }
        i++;
    }
    return out;
}

// Replace every string literal, template literal, regex and comment with
// spaces of the same length, so offsets stay true and nothing inside them is
// mistaken for code.
function blank(src) {
    const a = src.split('');
    let i = 0;
    const pad = (from, to) => {
        for (let k = from; k < to && k < a.length; k++) {
            if (a[k] !== '\n') a[k] = ' ';
        }
    };
    while (i < src.length) {
        const two = src.slice(i, i + 2);
        if (two === '//') {
            const end = src.indexOf('\n', i);
            pad(i, end === -1 ? src.length : end);
            i = end === -1 ? src.length : end;
            continue;
        }
        if (two === '/*') {
            const end = src.indexOf('*/', i + 2);
            pad(i, end === -1 ? src.length : end + 2);
            i = end === -1 ? src.length : end + 2;
            continue;
        }
        const q = src[i];
        if (q === '"' || q === "'" || q === '`') {
            let k = i + 1;
            while (k < src.length) {
                if (src[k] === '\\') { k += 2; continue; }
                if (src[k] === q) break;
                k++;
            }
            pad(i + 1, k);
            i = k + 1;
            continue;
        }
        i++;
    }
    return a.join('');
}

const lineOf = (src, off) => src.slice(0, off).split('\n').length;

const READ = FILES
    .map(rel => path.join(ROOT, rel))
    .filter(full => fs.existsSync(full))
    .map(full => fs.readFileSync(full, 'utf8'));
const GUARDED = guardedNames(READ);
console.log('  guarding: ' + (GUARDED.join(', ') || '(no short top-level functions)'));

let failures = 0;
for (const rel of FILES) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const raw = fs.readFileSync(full, 'utf8');
    const src = blank(raw);
    const seen = new Set();
    for (const [start, end] of blocks(src)) {
        const body = src.slice(start, end + 1);
        // A whole file or a huge module body will contain both a declaration
        // and a call without them shadowing each other, because the call sites
        // are in sibling functions. Only bodies small enough to be one
        // function are meaningful here.
        if (body.length > 4000) continue;
        for (const name of GUARDED) {
            if (!declRe(name).test(body)) continue;
            if (!callRe(name).test(body)) continue;
            const line = lineOf(src, start);
            const key = rel + ':' + line + ':' + name;
            if (seen.has(key)) continue;
            seen.add(key);
            failures++;
            console.log('  FAIL  ' + rel + ':' + line
                + '  declares `' + name + '` and also calls ' + name + '()');
            const snippet = raw.slice(start, Math.min(end + 1, start + 400));
            const decl = snippet.split('\n').find(l => declRe(name).test(l));
            if (decl) console.log('        ' + decl.trim());
        }
    }
}

if (failures) {
    console.log('\nFAILED (' + failures + '): a local shadows a function this'
        + ' block calls.\nRename the LOCAL - t() and friends are named in'
        + ' hundreds of places and the local in one.');
    process.exit(1);
}
console.log('  PASS  no block declares a name it also calls');
console.log('\nALL CHECKS PASSED');
process.exit(0);
