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

// A FEW CHECKERS ARE HONESTLY SLOW, and a cap that kills them reports
// TIMED OUT for work that was proceeding correctly. botcheck steps ~1400
// FRAMES because the bot thinks in frames, and this machine renders a live
// match at 2.1fps through swiftshader - eleven minutes here, twenty-five
// seconds on a real display. netcheck drives two browsers; leakcheck plays
// ten matches to completion.
const LONG_MS = 30 * 60 * 1000;
const SLOW_TESTS = new Set(['botcheck', 'netcheck', 'leakcheck']);
const timeoutFor = (name) => (SLOW_TESTS.has(name) ? LONG_MS : PER_TEST_MS);

// Not checkers: the harness itself, the mop, and this file.
const NOT_TESTS = new Set(['harness.js', 'cleanup.js', 'run.js']);

// FREE MEMORY, because contention does not announce itself.
//
// netcheck launches TWO Chrome instances, each software-rendering a 3D match.
// With 684MB free one of them died mid-run - `Target closed` - and the watchdog
// then burned 900 seconds before reporting TIMED OUT, which reads exactly like a
// hang in the game. Seven of its assertions had already passed.
//
// Same lesson as the lockfile: say what the machine is doing, rather than
// letting the machine corrupt the result and blaming the code.
const TWO_BROWSER_TESTS = new Set(['netcheck']);
const NEED_MB = 1200;          // one browser rendering an arena
const NEED_MB_TWO = 2200;      // two of them

function freeMB() {
    try { return Math.round(require('os').freemem() / 1048576); }
    catch (e) { return null; }
}

function memoryWarning(name) {
    const free = freeMB();
    if (free === null) return null;
    const need = TWO_BROWSER_TESTS.has(name) ? NEED_MB_TWO : NEED_MB;
    if (free >= need) return null;
    return free + 'MB free, ' + name + ' wants ~' + need + 'MB'
        + (TWO_BROWSER_TESTS.has(name) ? ' (it runs two browsers)' : '');
}

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
// GITHUB ANNOTATIONS. stdout goes to a log; an annotation goes to the run
// summary and into the failure email. Without this a red CI says only "some
// jobs were not successful", which is the position this repo was in for several
// days while nobody could see why from outside.
//
// Workflow commands are one line, so newlines are escaped as %0A - that is the
// documented encoding, not a workaround.
const ON_ACTIONS = !!process.env.GITHUB_ACTIONS;

function annotate(name, verdict, detail, out) {
    if (!ON_ACTIONS) return;
    // Newlines and percent signs only. Colons were escaped too, which is
    // required in a workflow command's PROPERTIES but not in its message - so
    // the first annotations to actually carry a diagnosis delivered it as
    // "Error%3A Uncaught Error%3A Error creating WebGL context."
    const esc = (s) => String(s).replace(/%/g, '%25')
        .replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    const escTitle = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
    let body = detail.map(d => d.trim()).join(chr10());
    // NO VERDICT means the checker died before printing one, and then the only
    // useful thing is its tail - typically a stack.
    if (!body) body = out.split(chr10()).slice(-12).join(chr10());
    console.log('::error title=' + escTitle(name + ' ' + verdict) + '::'
        + esc(body.slice(0, 1800)));
}

function chr10() { return String.fromCharCode(10); }

const t0 = Date.now();
for (const name of names) {
    const file = path.join(DIR, name + '.js');
    if (!fs.existsSync(file)) {
        // Annotated too: a checker named in the workflow but not in the repo is
        // a rename nobody finished, and it should say so rather than scroll past.
        console.log('%s  NO SUCH CHECKER', name.padEnd(22));
        annotate(name, 'NO SUCH CHECKER', ['tests/' + name + '.js does not exist'], '');
        failed.push(name);
        continue;
    }
    const started = Date.now();
    const memWarn = memoryWarning(name);
    if (memWarn) console.log('%s %s', ''.padEnd(22), 'LOW MEMORY: ' + memWarn);
    const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: timeoutFor(name) });
    const secs = ((Date.now() - started) / 1000).toFixed(0) + 's';
    const out = (r.stdout || '') + (r.stderr || '');
    let verdict;
    if (r.error && r.error.code === 'ETIMEDOUT') verdict = 'TIMED OUT';
    else if (/ALL CHECKS PASSED/.test(out)) verdict = 'pass';
    else if (/FAILED \(/.test(out)) verdict = (out.match(/FAILED \([^)]*\)/) || ['FAILED'])[0];
    else verdict = 'NO VERDICT';
    if (verdict !== 'pass' && memWarn) {
        console.log('%s %s', ''.padEnd(22), '^ ran with ' + memWarn
            + ' - confirm on a quieter machine before believing this');
    }
    if (verdict !== 'pass') {
        failed.push(name);
        const detail = out.split('\n').filter(l => /FAIL|Error|error:/.test(l)).slice(0, 3);
        console.log('%s %s  %s', name.padEnd(22), secs.padStart(5), verdict);
        for (const d of detail) console.log('      ' + d.trim().slice(0, 150));
        annotate(name, verdict, detail, out);
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
