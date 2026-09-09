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

const CHROME = process.env.AC_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');

// Headless software rendering (swiftshader) runs this page at only ~3-4 fps, so
// anything measured in GAME FRAMES needs a far larger wall-clock budget than the
// frame count suggests. A 150-frame pause is >10 real seconds here.
const SLOW_MS = 40000;

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
function gameUrl() { return baseUrl + '/index.html?debug=1'; }

async function launch(opts = {}) {
    return puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: [
            '--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
            // Multi-page tests (netcheck runs a host and a joiner side by side)
            // need BOTH pages to keep animating. Chrome throttles
            // requestAnimationFrame in background tabs to near-zero, and only
            // the last-created page is foreground - which showed up as the
            // host silently never sending a single state packet while the
            // joiner sent fine. Not a game bug: in real use each player has
            // their own foreground window.
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=CalculateNativeWinOcclusion',
        ],
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
// `models: true` additionally waits for the character GLBs to finish loading.
async function boot(page, { clearStorage = false, models = false } = {}) {
    await startServer();
    await page.goto(gameUrl(), { waitUntil: 'load' });
    await sleep(900);
    if (clearStorage) {
        await page.evaluate(() => localStorage.clear());
        await page.goto(gameUrl(), { waitUntil: 'load' });
        await sleep(900);
    }
    await page.evaluate(() => { const c = document.querySelector('#btn-tutorial-close'); if (c) c.click(); });
    await sleep(200);
    const ok = await page.evaluate(() => !!window.ACDebug);
    if (!ok) throw new Error('window.ACDebug missing — the page failed to boot (check for a load-time exception)');
    // Model loading is deliberately not awaited by the game (it stays playable
    // while in flight), so a checker that cares about the rigged art must wait
    // for it explicitly or it races the procedural fallback.
    if (models) await page.evaluate(() => window.ACDebug.modelsReady);
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
        stopServer();
        const errs = page ? page.errors : [];
        console.log('\nConsole/page errors: ' + JSON.stringify(errs));
        if (errs.length) fails.push('console errors');
        console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join(', ')}` : '\nALL CHECKS PASSED');
        if (browser) await browser.close();
        process.exit(fails.length ? 1 : 0);
    };
    return { check, section, finish, fails };
}

module.exports = {
    launch, newPage, boot, sleep, waitInPage, makeChecker, SLOW_MS, path,
    startServer, stopServer, gameUrl,
    get GAME_URL() { return gameUrl(); },
};
