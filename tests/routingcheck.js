// vercel.json's rewrites actually resolve to files that will exist on Vercel.
//
// Reported as "switch to local version resulted in [404]". The rewrite was
// there and the file was there, and /local still 404'd:
//
//     /local                        -> 404
//     /local/index     -> 200
//     /local/index.html -> 308
//
// `cleanUrls: true` serves every .html file at its EXTENSIONLESS path and
// 308-redirects the .html one. A rewrite destination ending in .html therefore
// points at a path that is not an output of the deployment, and Vercel answers
// 404 - locally it looks fine, because a plain static server has no cleanUrls.
//
// No browser needed: this is a config-vs-filesystem check, and it runs in
// milliseconds.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    if (ok) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
};

console.log('\nvercel.json routing:');
const rewrites = cfg.rewrites || [];
check('there is a /local rewrite', rewrites.some(r => r.source === '/local'),
    JSON.stringify(rewrites));

for (const r of rewrites) {
    const dest = r.destination;
    if (cfg.cleanUrls) {
        check(`${r.source} -> ${dest} has no .html extension (cleanUrls strips it)`,
            !/\.html$/i.test(dest), 'cleanUrls is on');
    }
    // The destination must correspond to a real file: either exactly, or as the
    // clean form of one.
    const rel = dest.replace(/^\//, '');
    const exists = fs.existsSync(path.join(ROOT, rel))
        || fs.existsSync(path.join(ROOT, rel + '.html'));
    check(`${dest} corresponds to a file in the repo`, exists, rel);
}

console.log('\nThe in-game button uses the routed URL, not the file path:');
check('it navigates to /local', /location\.href = '\/local'/.test(html));
check('and not to the file path directly',
    !/location\.href = '\/?legacy\//.test(html));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
