// Shared test harness for Astral Clash.
//
// These checkers live IN THE REPO deliberately. They used to be written to a
// scratch directory, and that directory was wiped mid-project, losing ten
// checker scripts that had collectively caught a dozen real bugs (an impossible
// jump gap, a boss telegraph that made the boss less readable than a normal
// fighter, a co-op mode that was unwinnable by construction, several mesh
// leaks). Rebuilding them from scratch cost far more than committing them would
// have. They are dev-only and ship no runtime weight — index.html doesn't
// reference them.
//
// They drive the REAL page in a real (headless) Chrome and assert against real
// game state via the `?debug=1`-gated `window.ACDebug` handle, rather than
// checking only that nothing threw.
//
// puppeteer-core is installed locally under tests/ (see tests/package.json) and
// git-ignored. It drives the system Chrome, so nothing is downloaded.
// Run `npm install` in tests/ once if node_modules is missing.
const puppeteer = require('puppeteer-core');
const path = require('path');
const http = require('http');
const fs = require('fs');

// WHERE CHROME IS. This used to be `process.env.AC_CHROME || <a Windows
// path>`, which has a trap in it: an AC_CHROME that is set but EMPTY - which is
// what a CI expression yields when the step it reads produced no output - is
// falsy, so the fallback fires and a Linux runner goes looking in Program
// Files. Every checker then fails in about four seconds for a reason none of
// them mention.
//
// Now: an explicit AC_CHROME always wins, a blank one is ignored rather than
// obeyed, and the fallbacks match the platform.
const CHROME = (function () {
    const env = (process.env.AC_CHROME || '').trim();
    if (env) return env;
    const candidates = process.platform === 'win32'
        ? ['C:' + '\\' + 'Program Files' + '\\' + 'Google' + '\\' + 'Chrome'
           + '\\' + 'Application' + '\\' + 'chrome.exe',
           'C:' + '\\' + 'Program Files (x86)' + '\\' + 'Google' + '\\' + 'Chrome'
           + '\\' + 'Application' + '\\' + 'chrome.exe']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
           '/usr/bin/chromium-browser', '/usr/bin/chromium',
           '/snap/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    for (const c of candidates) {
        try { if (fs.existsSync(c)) return c; } catch (e) { /* keep looking */ }
    }
    // Returned anyway so the launch failure names a real path rather than
    // undefined; chromeCheck() below is what turns this into a sentence.
    return candidates[0];
})();

// Does the browser we are about to drive actually exist. Called by the CI
// preflight, because one clear message beats twenty-five identical launch
// failures that each blame something else.
function chromeCheck() {
    const ok = (function () { try { return fs.existsSync(CHROME); } catch (e) { return false; } })();
    return { path: CHROME, exists: ok, fromEnv: !!(process.env.AC_CHROME || '').trim(),
             platform: process.platform };
}
const ROOT = path.resolve(__dirname, '..');

// Headless software rendering (swiftshader) runs this page at only ~3-4 fps, so
// anything measured in GAME FRAMES needs a far larger wall-clock budget than the
// frame count suggests. A 150-frame pause is >10 real seconds here.
// HOW MUCH SLOWER THIS MACHINE IS than the one the budgets were written on.
//
// Every "wait until the fight starts" number in this suite was chosen by
// watching it work here. A GitHub runner software-renders the same scene at a
// different speed, and the first CI run that got far enough to measure anything
// failed six checkers purely on elapsed time while every assertion about actual
// behaviour passed.
//
// One multiplier rather than dozens of edited literals: tuning each number
// until it stops failing fits them to today's runner and has to be redone for
// the next one. AC_TIME_SCALE overrides it anywhere - including here, for the
// checkers this machine has never had the memory to finish.
const TIME_SCALE = Number(process.env.AC_TIME_SCALE)
    || (process.env.GITHUB_ACTIONS ? 3 : 1);

// Scale a budget. Exported so a checker with its own watchdog uses the same
// number rather than inventing a second opinion.
const budget = (ms) => Math.round(ms * TIME_SCALE);

const SLOW_MS = budget(40000);

// Batch 25: the game is served over HTTP now instead of being opened as a
// file://. The Blender-authored characters are fetched with GLTFLoader (XHR),
// and Chrome treats XHR to a file:// URL as cross-origin and blocks it — so
// under file:// every model silently fails to load and the game falls back to
// its procedural meshes. Any art assertion would then quietly be testing the
// fallback instead of the thing it names. A throwaway static server fixes it.
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
    '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream',
    '.css': 'text/css', '.svg': 'image/svg+xml',
};
let server = null;
let baseUrl = null;

function startServer() {
    if (baseUrl) return Promise.resolve(baseUrl);
    return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
            const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
            const file = path.resolve(ROOT, rel);
            if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
            fs.readFile(file, (err, buf) => {
                if (err) { res.writeHead(404); return res.end('not found'); }
                res.writeHead(200, {
                    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
                });
                res.end(buf);
            });
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            baseUrl = 'http://127.0.0.1:' + server.address().port;
            resolve(baseUrl);
        });
    });
}
function stopServer() {
    if (server) { server.close(); server = null; baseUrl = null; }
}
function gameUrl(path) {
    // `path` lets a checker boot the LOCAL build (localshopcheck) without
    // duplicating the server + boot dance. It is generated by
    // art/sync_local.py, and the failure mode of a porting script is a page
    // that dies at load - so it needs a checker of its own.
    return baseUrl + (path || '/index.html') + '?debug=1';
}

// EVERY browser this harness launches, so it can be closed no matter how the
// script ends.
//
// This exists because of a real and painful incident: a run killed by a
// timeout never reaches browser.close(), which orphans a full headless Chrome
// - renderer, GPU and utility children included - and each one keeps
// software-rendering the game's 3D scene through swiftshader at full tilt,
// forever. Eight of those on an 8-core machine made the whole desktop
// unusable and started failing browser launches outright.
const launched = new Set();
let cleanupArmed = false;

function closeAllBrowsers() {
    for (const b of launched) {
        // Kill the process rather than await close(): these paths run during
        // exit, where there is no time for a graceful protocol shutdown.
        try { const proc = b.process && b.process(); if (proc) proc.kill('SIGKILL'); } catch (e) {}
    }
    launched.clear();
}
// A hard deadline for the whole run.
//
// Twice in one session a checker hung indefinitely - once for 5 hours, once for
// 12 - holding its browsers and the HTTP port, which then made the NEXT run of
// the same checker fail for reasons that had nothing to do with the code. A
// hung test is worse than a failing one: it reports nothing at all, and the
// only symptom is everything else getting slower. So every run now has a
// ceiling, and blowing it is a loud failure with a distinct exit code.
const RUN_BUDGET_MS = Number(process.env.AC_TEST_BUDGET_MS || 15 * 60 * 1000);
function armWatchdog() {
    const t = setTimeout(() => {
        console.error('WATCHDOG: run exceeded ' + Math.round(RUN_BUDGET_MS / 1000)
            + 's and was killed. Nothing hung silently.');
        closeAllBrowsers();
        stopServer();
        process.exit(3);
    }, RUN_BUDGET_MS);
    // Do NOT unref: the point is to fire even when the process would otherwise
    // sit idle waiting on something that never arrives.
    t;
}

function armCleanup() {
    if (cleanupArmed) return;
    cleanupArmed = true;
    armWatchdog();
    // 'exit' is the whole job. Node emits it when the process ends for an
    // uncaught exception or an unhandled rejection too (verified, not assumed),
    // so this one handler covers every crash path.
    process.on('exit', closeAllBrowsers);
    // Signals do NOT emit 'exit' on their own, so they need their own handler.
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
        try { process.on(sig, () => { closeAllBrowsers(); process.exit(130); }); } catch (e) {}
    }
    // Deliberately NO uncaughtException/unhandledRejection handlers here.
    // They would be redundant given 'exit', and actively harmful: netcheck
    // installs its own unhandledRejection handler to IGNORE the late
    // "Target closed" rejection that a deliberately-closed page produces after
    // the summary is printed. Node runs every listener, so a handler here
    // calling process.exit(1) overrode that policy and failed an otherwise
    // green run. A shared harness must not decide a checker's exit code.
}

// Chrome will not run requestAnimationFrame in a background tab, and only the
// last-created page is foreground - which is why netcheck's host silently never
// sent a state packet. These flags lift that.
//
// They are OPT-IN (`keepAnimating: true`) and NOT the default, deliberately. As
// a blanket default they turn every orphaned test browser into one that renders
// a 3D scene at full speed instead of idling, which is exactly how this harness
// brought a desktop to its knees. Only netcheck genuinely needs them, and only
// because it drives two clients at once.
const NO_THROTTLE_ARGS = [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
];

async function launch(opts = {}) {
    armCleanup();
    // tests/screenshots/ is git-ignored, so it does not exist on a fresh
    // checkout - and page.screenshot({path}) into a missing directory throws
    // ENOENT, failing a checker for a reason that has nothing to do with the
    // game. Created here because every checker that screenshots launches first.
    try { fs.mkdirSync(path.resolve(__dirname, 'screenshots'), { recursive: true }); }
    catch (e) { /* a read-only checkout is not a reason to fail a test */ }
    const { keepAnimating = false, ...rest } = opts;
    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        // SOFTWARE WEBGL, ASKED FOR BY NAME.
        //
        // There is no GPU on a CI runner and none worth using in headless
        // Chrome anywhere, so every one of these checkers renders the 3D scene
        // through SwiftShader. Chrome used to fall back to it on its own.
        // Since roughly version 128 it does not: software rendering for WebGL
        // has to be requested with --enable-unsafe-swiftshader, and without it
        // the context creation simply fails.
        //
        // This game builds a THREE.WebGLRenderer at load time, so that failure
        // threw inside bootGame(), ACDebug never appeared, and all twenty-six
        // browser checkers reported the same unhelpful "page failed to boot" in
        // three seconds each. It could not be reproduced here because this
        // machine's Chrome is old enough to still allow the fallback - which is
        // the whole argument for CI pinning nothing and the local machine
        // pinning nothing either: they disagree, and that is the point.
        //
        // --use-gl=angle with --use-angle=swiftshader is the current spelling;
        // the bare --use-gl=swiftshader this used to pass is the retired one.
        args: [
            '--no-sandbox',
            '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
            '--enable-webgl', '--ignore-gpu-blocklist',
            ...(keepAnimating ? NO_THROTTLE_ARGS : []),
        ],
        // PUPPETEER'S OWN TIMEOUT, which is separate from every budget in this
        // file and was the one nothing scaled. It defaults to 180s and applies
        // to a single CDP call - so one long page.evaluate() on a machine
        // software-rendering a 3D scene blows it and the checker dies with
        // "Runtime.callFunctionOn timed out" instead of failing an assertion.
        // That is what crushcheck reported here while CI, on faster hardware,
        // got far enough to report real assertions instead.
        protocolTimeout: budget(180000),
        defaultViewport: { width: 1400, height: 1000 },
        ...rest,
    });
    launched.add(browser);
    browser.on('disconnected', () => launched.delete(browser));
    return browser;
}

// Kills any headless Chrome left over from an earlier interrupted run, matched
// on its command line so a real browser is never touched. Called by cleanup.js.
function killStrays() {
    const { execSync } = require('child_process');
    const ps = [
        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" -ErrorAction SilentlyContinue",
        "| Where-Object { $_.CommandLine -like '*swiftshader*' }",
        "| ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; 'killed ' + $_.ProcessId } catch {} }",
    ].join(' ');
    try {
        const out = execSync('powershell -NoProfile -Command "' + ps.replace(/"/g, '\\"') + '"',
            { encoding: 'utf8', timeout: 60000 });
        return out.trim();
    } catch (e) {
        return 'stray sweep failed: ' + (e.message || '').slice(0, 80);
    }
}

// Creates a page that records console errors and page exceptions.
async function newPage(browser) {
    const page = await browser.newPage();
    page.errors = [];
    page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.on('pageerror', e => page.errors.push('PAGEERROR: ' + e.message));
    return page;
}

// Loads the game and dismisses the auto-opening tutorial.
// `models: true` additionally waits for the character GLBs to finish loading.
async function boot(page, { clearStorage = false, models = false, path = null } = {}) {
    await startServer();
    await page.goto(gameUrl(path), { waitUntil: 'load' });
    await sleep(900);
    if (clearStorage) {
        await page.evaluate(() => localStorage.clear());
        await page.goto(gameUrl(path), { waitUntil: 'load' });
        await sleep(900);
    }
    await page.evaluate(() => { const c = document.querySelector('#btn-tutorial-close'); if (c) c.click(); });
    await sleep(200);
    const ok = await page.evaluate(() => !!window.ACDebug);
    if (!ok) {
        // SAY WHY. newPage() has been collecting console and page errors all
        // along and this threw without consulting them, so a load-time
        // exception arrived as "check for a load-time exception" - advice, not
        // information.
        //
        // It cost a full round trip through CI. Forty-seven checkers failed
        // with this identical sentence; only bootcheck, which captures console
        // output itself, carried the line that actually mattered
        // ("THREE.WebGLRenderer: Error creating WebGL context"). Every one of
        // the other forty-six had it in hand and discarded it.
        const why = (page.errors || []).slice(0, 3).join(' | ');
        throw new Error('window.ACDebug missing — the page failed to boot'
            + (why ? ': ' + why : ' (and the page logged nothing, which is its own clue)'));
    }
    // Model loading is deliberately not awaited by the game (it stays playable
    // while in flight), so a checker that cares about the rigged art must wait
    // for it explicitly or it races the procedural fallback.
    if (models) await page.evaluate(() => window.ACDebug.modelsReady);
    return page;
}

// SCALED, like every other budget here, and for the same reason. A sleep in a
// checker always means "give the machine time to finish what I just asked for"
// - repaint the menu, settle a transition, run a few frames - so on a machine
// three times slower it should be three times longer. There is no case in this
// suite where a sleep wants to stay the same length on slower hardware.
//
// This was the last unscaled budget, and it was the one that mattered.
// framerateccheck does its menu steps with sleeps between them precisely
// BECAUSE doing them in one tick was a bug it already fixed once - its own
// comment says so - and on a CI runner those fixed 500ms gaps put the same race
// straight back. Both arms then reported "never reached FIGHT", which reads as
// a frame-cap failure and is nothing of the kind.
const sleep = ms => new Promise(r => setTimeout(r, budget(ms)));

// Polls a predicate INSIDE the page until true or the budget expires.
// `ms` is scaled here, so a checker that passes an explicit budget gets the
// same treatment as one that takes the default - netcheck's hand-written 30000
// was the budget that failed first on CI.
async function waitInPage(page, fnBody, ms = SLOW_MS) {
    ms = budget(ms);
    try {
        await page.waitForFunction(fnBody, { timeout: ms, polling: 100 });
        return true;
    } catch (e) {
        return false;
    }
}

// Minimal assertion recorder.
function makeChecker() {
    const fails = [];
    const check = (name, cond, detail) => {
        if (cond) console.log(`  PASS  ${name}`);
        else { console.log(`  FAIL  ${name}${detail ? ' -- ' + detail : ''}`); fails.push(name); }
    };
    const section = title => console.log(`\n${title}`);
    const finish = async (browser, page) => {
        stopServer();
        const errs = page ? page.errors : [];
        console.log('\nConsole/page errors: ' + JSON.stringify(errs));
        if (errs.length) fails.push('console errors');
        console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join(', ')}` : '\nALL CHECKS PASSED');
        if (browser) { try { await browser.close(); } catch (e) {} }
        closeAllBrowsers();   // and any sibling browser the checker opened
        process.exit(fails.length ? 1 : 0);
    };
    return { check, section, finish, fails };
}

module.exports = {
    launch, newPage, boot, sleep, waitInPage, makeChecker, SLOW_MS, path,
    TIME_SCALE, budget,
    startServer, stopServer, gameUrl,
    closeAllBrowsers, killStrays, chromeCheck, CHROME,
    get GAME_URL() { return gameUrl(); },
};
