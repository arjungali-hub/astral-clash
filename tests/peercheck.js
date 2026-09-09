// The REAL PeerJS handshake, two real browsers, no fake transport.
//
// This is the gap that let a reported bug survive two batches: netcheck
// installs a loopback DataConnection so it can test the protocol without
// depending on the public broker, and it RAISES the drop timeout because a
// CDP relay cannot sustain 30Hz. Between them, those two entirely reasonable
// decisions meant nothing ever exercised:
//   - `new Peer()` reaching the broker and getting an id
//   - an incoming connection on the HOST firing 'open'
//   - the 30Hz keepalive actually keeping a real link alive past 6 seconds
//
// The symptom was "less than 10 seconds after you join a room it says
// disconnected - connection timed out", which is precisely the silence
// timeout with the real default in place.
//
// This test talks to the public PeerJS broker, so it can fail for reasons
// that are nothing to do with this code. It says so loudly rather than
// pretending to be a unit test.
const H = require('./harness');

const LIVE_BUDGET_MS = 45000;

(async () => {
    const hostBrowser = await H.launch({ keepAnimating: true });
    const joinBrowser = await H.launch({ keepAnimating: true });
    await H.startServer();
    const { check, section, finish } = H.makeChecker();

    const host = await H.boot(await H.newPage(hostBrowser), { clearStorage: true });
    const join = await H.boot(await H.newPage(joinBrowser), { clearStorage: true });

    section('PeerJS loads and the broker is reachable:');
    const peerOk = await host.evaluate(() => typeof Peer === 'function');
    check('the PeerJS library loaded from the CDN', peerOk === true, String(peerOk));
    if (!peerOk) { await finish(hostBrowser, host); return; }

    // ---- host ------------------------------------------------------------
    await host.evaluate(() => window.ACDebug.netHost());
    const gotId = await H.waitInPage(host,
        "window.ACDebug.net.peer && window.ACDebug.net.peer.id", LIVE_BUDGET_MS);
    const roomId = gotId ? await host.evaluate(() => window.ACDebug.net.peer.id) : null;
    check('hosting gets a room id from the broker', !!roomId,
        roomId || 'no id within ' + LIVE_BUDGET_MS + 'ms (broker unreachable?)');
    if (!roomId) {
        console.log('\nNOTE: the public PeerJS broker was unreachable, so the rest of');
        console.log('this check could not run. That is an environment failure, not a');
        console.log('code failure - but it also means the real transport is UNTESTED.');
        await finish(hostBrowser, host);
        return;
    }

    // ---- joiner ----------------------------------------------------------
    await join.evaluate(id => window.ACDebug.netJoin(id), roomId);
    const joinUp = await H.waitInPage(join, "window.ACDebug.netActive()", LIVE_BUDGET_MS);
    const hostUp = await H.waitInPage(host, "window.ACDebug.netActive()", LIVE_BUDGET_MS);
    check('the joiner reports an open connection', joinUp, String(joinUp));
    check('the HOST reports an open connection too', hostUp, String(hostUp));

    section('Both sides enter the room (not just the joiner):');
    const screens = {
        host: await host.evaluate(() => window.ACDebug.currentScreen),
        join: await join.evaluate(() => window.ACDebug.currentScreen),
    };
    check('host is in the room', screens.host === 'select', screens.host);
    check('joiner is in the room', screens.join === 'select', screens.join);

    section('The keepalive holds the link open past the drop timeout:');
    // THE assertion this file exists for. The default timeout is 6s, so
    // sitting on the character-select screen for 12 seconds must not drop.
    // Nothing is done here on purpose: this is exactly what two players
    // reading fighter descriptions look like to the netcode.
    const liveness = await host.evaluate(() => ({
        timeoutMs: window.ACDebug.net.timeoutMs,
        onTimer: !!window.ACDebug.net.pingTimer,
    }));
    // `window` does not exist out here in Node - this runs in the checker, not
    // in the page. Compare against the value the page reports instead.
    check('the drop timeout is generous enough for a throttled tab',
        liveness.timeoutMs >= 10000, String(liveness.timeoutMs));
    // THE structural guard. The keepalive used to be sent from netTick, which
    // gameLoop drives from requestAnimationFrame - and Chrome STOPS rAF in a
    // background tab. So the instant a host switched away to paste the room
    // code into a chat, its keepalive stopped and the joiner was dropped for
    // silence about six seconds later. Timers are throttled in a background
    // tab but not stopped, so liveness must live on one. This assertion is the
    // thing that stops that regressing; the symptom is impossible to reproduce
    // in headless, because a lone page is never actually backgrounded.
    check('liveness runs on a timer, NOT on the render loop', liveness.onTimer === true,
        JSON.stringify(liveness));

    const before = {
        host: await host.evaluate(() => window.ACDebug.net.lastRecvAt),
        join: await join.evaluate(() => window.ACDebug.net.lastRecvAt),
    };
    await H.sleep(12000);
    const after = await Promise.all([
        host.evaluate(() => ({
            active: window.ACDebug.netActive(), status: window.ACDebug.net.status,
            detail: window.ACDebug.net.detail, lastRecvAt: window.ACDebug.net.lastRecvAt,
            screen: window.ACDebug.currentScreen, fps: window.ACDebug.fpsSmoothed,
        })),
        join.evaluate(() => ({
            active: window.ACDebug.netActive(), status: window.ACDebug.net.status,
            detail: window.ACDebug.net.detail, lastRecvAt: window.ACDebug.net.lastRecvAt,
            screen: window.ACDebug.currentScreen, fps: window.ACDebug.fpsSmoothed,
        })),
    ]);
    const [h2, j2] = after;
    check('the host is still connected after 12 idle seconds',
        h2.active === true, JSON.stringify(h2));
    check('the joiner is still connected after 12 idle seconds',
        j2.active === true, JSON.stringify(j2));
    check('the host kept RECEIVING (the keepalive is two-way)',
        h2.lastRecvAt > before.host, `${before.host} -> ${h2.lastRecvAt}`);
    check('the joiner kept receiving',
        j2.lastRecvAt > before.join, `${before.join} -> ${j2.lastRecvAt}`);
    // A dead render loop is the other way the keepalive stops, and it looks
    // identical from the outside.
    check('both game loops are still running', h2.fps > 1 && j2.fps > 1,
        `host fps ${h2.fps && h2.fps.toFixed(1)}, joiner fps ${j2.fps && j2.fps.toFixed(1)}`);

    section('A pick crosses the real link:');
    await join.evaluate(() => {
        const D = window.ACDebug;
        D.previewPick('p2', 'Lyra');
        D.confirmPick('p2');
    });
    const sawPick = await H.waitInPage(host, "window.ACDebug.p2Choice === 'Lyra'", 20000);
    check("the host sees the joiner's fighter", sawPick, String(sawPick));

    await host.evaluate(() => { if (window.ACDebug.netActive()) window.ACDebug.netSend({ t: 'BYE' }); });
    await finish(hostBrowser, host);
})();
