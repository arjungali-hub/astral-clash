// The only supported way to run these checks.
//
// WHY THIS EXISTS. Every checker here launches headless Chrome, which renders
// the 3D game through swiftshader - software rasterisation, no GPU, so the CPU
// does all of it. One is expensive. Several at once is a different machine.
//
// Running suites in the background while doing other work, and layering them,
// put 35 chrome and 12 node processes on this machine at once; `tasklist`
// itself timed out at 120 seconds and the desktop stopped responding. Orphans
// are the worst part: a run killed by a timeout never reaches browser.close(),
// and the orphaned Chrome keeps software-rendering an arena forever.
//
// It also quietly corrupted the RESULTS, which is how it went unnoticed for so
// long: maptimecheck swung 18s to 35s for the same arena, three checkers
// returned no verdict at all, and charcheck looked like it was hanging. Every
// one of those was contention, diagnosed correctly and then recreated.
//
// So this runner enforces what good intentions did not:
//
//   * ONE AT A TIME. A lockfile naming the live process; a second runner
//     refuses to start rather than doubling the load.
//   * CLEAN BEFORE AND AFTER, every test, so one timeout cannot poison the
//     rest of the run.
//   * A TIMEOUT PER TEST, with the browsers reaped on the way out - an orphan
//     that outlives its own test is the thing that does the lasting damage.
//
//     node tests/run.js                 every checker
//     node tests/run.js smoke mapscheck just these
//     node tests/run.js --list          names only
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const LOCK = path.join(DIR, '.run.lock');
const PER_TEST_MS = 10 * 60 * 1000;

// Not checkers: the harness itself, the mop, and this file.
const NOT_TESTS = new Set(['harness.js', 'cleanup.js', 'run.js']);

function allTests() {
    return fs.readdirSync(DIR)
        .filter(f => f.endsWith('.js') && !NOT_TESTS.has(f))
        .map(f => f.replace(/\.js$/, ''))
        .sort();
}

function alive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

function takeLock() {
    if (fs.existsSync(LOCK)) {
        const held = parseInt(fs.readFileSync(LOCK, 'utf8').trim(), 10);
        if (held && held !== process.pid && alive(held)) {
            console.error('\nREFUSING TO START: tests are already running (pid ' + held + ').');
            console.error('Two runs at once is what made the machine unusable; wait for it,');
            console.error('or stop it and delete tests/.run.lock if it is dead.\n');
            process.exit(2);
        }
        fs.unlinkSync(LOCK);   // stale: the holder is gone
    }
    fs.writeFileSync(LOCK, String(process.pid));
}

function dropLock() {
    try { if (fs.existsSync(LOCK)) fs.unlinkSync(LOCK); } catch (e) { /* going away anyway */ }
}

function sweep(label) {
    const r = spawnSync(process.execPath, [path.join(DIR, 'cleanup.js')],
        { encoding: 'utf8', timeout: 120000 });
    const out = (r.stdout || '').trim().split('\n')[0] || '';
    if (label && /killed [1-9]/.test(out)) console.log('    [' + label + '] ' + out);
}

const args = process.argv.slice(2);
if (args.includes('--list')) { console.log(allTests().join('\n')); process.exit(0); }
const names = args.length ? args : allTests();

takeLock();
// However this ends - finished, failed, Ctrl+C, an uncaught throw - the
// browsers get reaped and the lock goes. Leaving either behind is the failure
// this file exists to prevent.
let done = false;
const finish = (code) => {
    if (done) return;
    done = true;
    sweep('final');
    dropLock();
    process.exit(code);
};
process.on('SIGINT', () => finish(130));
process.on('SIGTERM', () => finish(143));
process.on('uncaughtException', (e) => { console.error(e); finish(1); });

console.log('Running %d checker(s), one at a time.\n', names.length);
sweep('before');

const failed = [];
const t0 = Date.now();
for (const name of names) {
    const file = path.join(DIR, name + '.js');
    if (!fs.existsSync(file)) { console.log('%s  NO SUCH CHECKER', name.padEnd(22)); failed.push(name); continue; }
    const started = Date.now();
    const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: PER_TEST_MS });
    const secs = ((Date.now() - started) / 1000).toFixed(0) + 's';
    const out = (r.stdout || '') + (r.stderr || '');
    let verdict;
    if (r.error && r.error.code === 'ETIMEDOUT') verdict = 'TIMED OUT';
    else if (/ALL CHECKS PASSED/.test(out)) verdict = 'pass';
    else if (/FAILED \(/.test(out)) verdict = (out.match(/FAILED \([^)]*\)/) || ['FAILED'])[0];
    else verdict = 'NO VERDICT';
    if (verdict !== 'pass') {
        failed.push(name);
        const detail = out.split('\n').filter(l => /FAIL|Error|error:/.test(l)).slice(0, 3);
        console.log('%s %s  %s', name.padEnd(22), secs.padStart(5), verdict);
        for (const d of detail) console.log('      ' + d.trim().slice(0, 150));
    } else {
        console.log('%s %s  pass', name.padEnd(22), secs.padStart(5));
    }
    // Between every test, not just at the end: one timeout must not leave a
    // software-rendering Chrome competing with everything after it.
    sweep(name);
}

console.log('\n%d/%d passed in %ds%s', names.length - failed.length, names.length,
    Math.round((Date.now() - t0) / 1000),
    failed.length ? '   FAILED: ' + failed.join(', ') : '');
finish(failed.length ? 1 : 0);
