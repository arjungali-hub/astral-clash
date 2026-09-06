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
// puppeteer-core is installed locally under tests/ (see tests/package.json) and
// git-ignored. It drives the system Chrome, so nothing is downloaded.
// Run `npm install` in tests/ once if node_modules is missing.
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = process.env.AC_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const GAME_URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/') + '?debug=1';

// Headless software rendering (swiftshader) runs this page at only ~3-4 fps, so
// anything measured in GAME FRAMES needs a far larger wall-clock budget than the
// frame count suggests. A 150-frame pause is >10 real seconds here.
const SLOW_MS = 40000;

async function launch(opts = {}) {
    return puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
        defaultViewport: { width: 1400, height: 1000 },
        ...opts,
    });
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
async function boot(page, { clearStorage = false } = {}) {
    await page.goto(GAME_URL, { waitUntil: 'load' });
    await sleep(900);
    if (clearStorage) {
        await page.evaluate(() => localStorage.clear());
        await page.goto(GAME_URL, { waitUntil: 'load' });
        await sleep(900);
    }
    await page.evaluate(() => { const c = document.querySelector('#btn-tutorial-close'); if (c) c.click(); });
    await sleep(200);
    const ok = await page.evaluate(() => !!window.ACDebug);
    if (!ok) throw new Error('window.ACDebug missing — the page failed to boot (check for a load-time exception)');
    return page;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Polls a predicate INSIDE the page until true or the budget expires.
async function waitInPage(page, fnBody, ms = SLOW_MS) {
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
        const errs = page ? page.errors : [];
        console.log('\nConsole/page errors: ' + JSON.stringify(errs));
        if (errs.length) fails.push('console errors');
        console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join(', ')}` : '\nALL CHECKS PASSED');
        if (browser) await browser.close();
        process.exit(fails.length ? 1 : 0);
    };
    return { check, section, finish, fails };
}

module.exports = { launch, newPage, boot, sleep, waitInPage, makeChecker, GAME_URL, SLOW_MS, path };
