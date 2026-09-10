// Batch 34: the online-only front page and the redesigned room.
//
// The complaint this verifies against: "the UI looks exactly the same as
// before so it is very confusing. It still has 2 players showing all of the
// time, and you have to select both players to start a match, but then it
// disconnects and you can't play."
//
// So the assertions are deliberately about SHAPE, not just absence of errors:
// how many rosters are visible, who can start, who owns the arena, and what
// each screen says is blocking progress. Most of these would pass a
// "nothing threw" test while still being the broken UI that was reported.
const H = require('./harness');
const DIR = H.path.resolve(__dirname, 'screenshots') + '/';

(async () => {
    const b = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(b), { clearStorage: true });

    const D = fn => page.evaluate(fn);

    // =====================================================================
    section('Front page: online is the only thing on offer:');
    const home = await D(() => {
        // getClientRects() is empty when an element is not rendered for ANY
        // reason - including a hidden ancestor, which a computed-display check
        // on the element itself misses entirely. That mattered here: the roster
        // grids are display:grid inside a wrapper that gets hidden, so the
        // naive check reported both rosters visible when neither was on screen.
        // It also behaves correctly for the position:fixed modals.
        const vis = id => {
            const el = document.getElementById(id);
            return !!el && el.getClientRects().length > 0;
        };
        return {
            screen: window.ACDebug.currentScreen,
            homeVisible: vis('home-screen'),
            roomVisible: vis('select-screen'),
            hasPlay: !!document.getElementById('btn-home-play'),
            hasArmory: !!document.getElementById('btn-home-armory'),
            hasSettings: !!document.getElementById('btn-open-settings'),
            // things that must NOT exist any more
            botToggles: document.querySelectorAll('.bot-toggle').length,
            difficulty: !!document.getElementById('btn-difficulty'),
            sandbox: !!document.getElementById('chk-unlock-all'),
            oldFooterShop: !!document.getElementById('btn-open-shop'),
            perSideShops: document.querySelectorAll('[data-shop-side]').length,
            coins: (document.getElementById('home-coins') || {}).textContent,
        };
    });
    check('the page opens on the home screen', home.screen === 'home' && home.homeVisible, JSON.stringify(home));
    check('the room is not shown until there is a connection', !home.roomVisible, String(home.roomVisible));
    check('home offers Play Online, Armory and Settings',
        home.hasPlay && home.hasArmory && home.hasSettings, JSON.stringify(home));
    check('no bot toggles anywhere', home.botToggles === 0, String(home.botToggles));
    check('no difficulty cycler - nothing to scale without bots', !home.difficulty, String(home.difficulty));
    check('no sandbox / unlock-everything switch', !home.sandbox, String(home.sandbox));
    check('no per-side shop buttons', home.perSideShops === 0, String(home.perSideShops));
    await page.screenshot({ path: DIR + 'b34-home.png' });

    section('Only the modes that can actually run online are offered:');
    const modes = await D(() => {
        window.ACDebug.buildModeSelect && window.ACDebug.buildModeSelect();
        return {
            ids: window.ACDebug.onlineModes(),
            all: window.ACDebug.MATCH_MODES ? window.ACDebug.MATCH_MODES.length : null,
        };
    });
    check('three versus modes, no co-op',
        modes.ids.length === 3 && !modes.ids.includes('boss') && !modes.ids.includes('survival'),
        JSON.stringify(modes));

    // =====================================================================
    section('Host joins a room: one roster, and it is yours:');
    const asHost = await D(() => {
        window.ACDebug.netFakeConnect('host');
        // getClientRects() is empty when an element is not rendered for ANY
        // reason - including a hidden ancestor, which a computed-display check
        // on the element itself misses entirely. That mattered here: the roster
        // grids are display:grid inside a wrapper that gets hidden, so the
        // naive check reported both rosters visible when neither was on screen.
        // It also behaves correctly for the position:fixed modals.
        const vis = id => {
            const el = document.getElementById(id);
            return !!el && el.getClientRects().length > 0;
        };
        return {
            screen: window.ACDebug.currentScreen,
            roomVisible: vis('select-screen'),
            homeVisible: vis('home-screen'),
            localSide: window.ACDebug.LOCAL_SIDE,
            p1GridVisible: vis('p1-grid'),
            p2GridVisible: vis('p2-grid'),
            youRole: (document.getElementById('slot-you-role') || {}).textContent,
            foeRole: (document.getElementById('slot-foe-role') || {}).textContent,
            foeName: (document.getElementById('slot-foe-name') || {}).textContent,
            hostControls: vis('host-controls'),
            guestSetup: vis('guest-setup'),
            startVisible: vis('btn-start-match'),
            note: (document.getElementById('setup-note') || {}).textContent,
            pill: (document.getElementById('room-status-pill') || {}).textContent,
            codeChip: vis('room-code-chip'),
        };
    });
    check('connecting lands you in the room, not on a modal over the front page',
        asHost.screen === 'select' && asHost.roomVisible && !asHost.homeVisible, JSON.stringify(asHost));
    check('the host drives p1', asHost.localSide === 'p1', asHost.localSide);
    check('EXACTLY ONE roster is visible, and it is the local side\'s',
        asHost.p1GridVisible && !asHost.p2GridVisible, JSON.stringify(asHost));
    // Batch 36: the slots lead with the player's NAME, and fall back to a slot
    // number only for someone who has not named themselves. With no name set
    // this is "Player 1 - you" / "Player 2 - opponent"; with one set it is the
    // name. Asserting the fallback shape here, and the named shape below.
    check('your slot identifies you, with the host badge',
        /you/i.test(asHost.youRole) && /Player 1/.test(asHost.youRole) && /Host/.test(asHost.youRole),
        asHost.youRole);
    check('the opponent slot is an observed person, not a second roster',
        /opponent/i.test(asHost.foeRole), asHost.foeRole);
    check('the host gets the match-setup controls', asHost.hostControls && !asHost.guestSetup, JSON.stringify(asHost));
    check('Start is hidden until both are ready', !asHost.startVisible, String(asHost.startVisible));
    check('the note says both still need a fighter', /both of you/i.test(asHost.note), asHost.note);
    check('the status pill says Hosting', /hosting/i.test(asHost.pill), asHost.pill);
    await page.screenshot({ path: DIR + 'b34-room-host.png' });

    section('You can pick only your own fighter:');
    const picking = await D(() => {
        const D2 = window.ACDebug;
        D2.previewPick('p2', 'Kaelen');          // the REMOTE side - must be refused
        const foeAfter = D2.p2Preview;
        D2.previewPick('p1', 'Kaelen');
        D2.confirmPick('p1');
        return {
            foePreviewAfterIllegalPick: foeAfter,
            myChoice: D2.p1Choice,
            youName: (document.getElementById('slot-you-name') || {}).textContent,
            youState: (document.getElementById('slot-you-state') || {}).textContent,
            note: (document.getElementById('setup-note') || {}).textContent,
            startVisible: document.getElementById('btn-start-match').getClientRects().length > 0,
            // confirming must NOT have started anything
            screen: D2.currentScreen,
            state: D2.gameState,
        };
    });
    check('picking for the opponent is refused', !picking.foePreviewAfterIllegalPick, String(picking.foePreviewAfterIllegalPick));
    check('your own pick lands', picking.myChoice === 'Kaelen', picking.myChoice);
    // Batch 36: "Ready", not "Locked in" - right click backs out, so "locked"
    // overstated it.
    check('your slot shows your fighter and Ready',
        picking.youName === 'Kaelen' && /ready/i.test(picking.youState), JSON.stringify(picking));
    check('the note now waits on the opponent', /waiting for your opponent/i.test(picking.note), picking.note);
    check('confirming does NOT start a match on its own',
        picking.screen === 'select' && picking.state === 'MENU', JSON.stringify(picking));
    check('Start is still hidden with only one side ready', !picking.startVisible, String(picking.startVisible));

    section('The opponent locking in is reflected, and only then can the host start:');
    const bothReady = await D(() => {
        window.ACDebug.netFeed({ t: 'PICK', side: 'p2', name: 'Lyra' });
        return {
            foeName: (document.getElementById('slot-foe-name') || {}).textContent,
            foeState: (document.getElementById('slot-foe-state') || {}).textContent,
            note: (document.getElementById('setup-note') || {}).textContent,
            startVisible: document.getElementById('btn-start-match').getClientRects().length > 0,
            screen: window.ACDebug.currentScreen,
            state: window.ACDebug.gameState,
        };
    });
    check('their pick shows in their slot', bothReady.foeName === 'Lyra', bothReady.foeName);
    check('their slot says Ready', /ready/i.test(bothReady.foeState), bothReady.foeState);
    check('both ready still does not auto-start',
        bothReady.screen === 'select' && bothReady.state === 'MENU', JSON.stringify(bothReady));
    check('NOW the host sees Start Match', bothReady.startVisible, String(bothReady.startVisible));
    check('the note tells the host to choose an arena and start',
        /choose an arena/i.test(bothReady.note), bothReady.note);
    await page.screenshot({ path: DIR + 'b34-room-both-ready.png' });

    section('You can watch your opponent browse, and see them back out:');
    const watching = await D(() => {
        const D2 = window.ACDebug;
        // A PREVIEW from them - not a confirm. Before Batch 36 this crossed no
        // wire at all, so their slot said "Choosing..." until they committed.
        D2.netFeed({ t: 'PICK', side: 'p2', name: 'Draven', stage: 'preview' });
        const previewing = {
            name: (document.getElementById('slot-foe-name') || {}).textContent,
            state: (document.getElementById('slot-foe-state') || {}).textContent,
            ready: D2.sideReady('p2'),
        };
        D2.netFeed({ t: 'PICK', side: 'p2', name: 'Draven', stage: 'confirmed' });
        const confirmed = { ready: D2.sideReady('p2'), choice: D2.p2Choice };
        // ...and backing out again must CLEAR on our screen.
        D2.netFeed({ t: 'PICK', side: 'p2', name: null, stage: 'pick' });
        const backedOut = {
            ready: D2.sideReady('p2'), choice: D2.p2Choice,
            name: (document.getElementById('slot-foe-name') || {}).textContent,
        };
        // put them back for the sections that follow
        D2.netFeed({ t: 'PICK', side: 'p2', name: 'Lyra', stage: 'confirmed' });
        return { previewing, confirmed, backedOut };
    });
    check('their slot shows the fighter they are LOOKING at',
        watching.previewing.name === 'Draven' && /looking at/i.test(watching.previewing.state),
        JSON.stringify(watching.previewing));
    check('a preview does not count as ready', watching.previewing.ready === false,
        JSON.stringify(watching.previewing));
    check('their confirm does', watching.confirmed.ready === true && watching.confirmed.choice === 'Draven',
        JSON.stringify(watching.confirmed));
    check('and backing out clears their pick on OUR screen',
        watching.backedOut.ready === false && !watching.backedOut.choice
        && watching.backedOut.name === 'Choosing...', JSON.stringify(watching.backedOut));

    section('Named players show their name instead of a slot number:');
    const named = await D(() => {
        const D2 = window.ACDebug;
        const both = {};
        both.neither = [D2.playerLabel('p1'), D2.playerLabel('p2')];
        D2.setMyName('Arjun');
        both.mineOnly = [D2.playerLabel('p1'), D2.playerLabel('p2')];
        D2.netFeed({ t: 'NAME', name: 'Sam' });
        both.bothNamed = [D2.playerLabel('p1'), D2.playerLabel('p2')];
        D2.setMyName('');
        both.theirsOnly = [D2.playerLabel('p1'), D2.playerLabel('p2')];
        both.sanitised = D2.sanitizeName('  <b>Ar</b>jun  ');
        return both;
    });
    check('neither named: the HOST is Player 1',
        named.neither.join() === 'Player 1,Player 2', JSON.stringify(named.neither));
    check('both named: no slot numbers at all',
        named.bothNamed.join() === 'Arjun,Sam', JSON.stringify(named.bothNamed));
    check('only mine named: the anonymous one is Player 1',
        named.mineOnly.join() === 'Arjun,Player 1', JSON.stringify(named.mineOnly));
    check('only theirs named: the anonymous one is Player 1',
        named.theirsOnly.join() === 'Player 1,Sam', JSON.stringify(named.theirsOnly));
    check('markup is stripped from a name', named.sanitised === 'bArb jun'
        || !/[<>]/.test(named.sanitised), named.sanitised);

    section('The host owns the arena, and choosing one does not start the match:');
    const arena = await D(() => {
        const D2 = window.ACDebug;
        const before = D2.selectedMap;
        D2.chooseMap(window.ACDebug.MAPS ? window.ACDebug.MAPS[1] : null);
        return {
            before,
            after: D2.selectedMap,
            arenaBtn: (document.getElementById('btn-open-mapselect') || {}).textContent,
            state: D2.gameState,
            screen: D2.currentScreen,
        };
    });
    check('the arena starts as Random', !arena.before, String(arena.before));
    check('choosing an arena RECORDS it instead of starting the match',
        !!arena.after && arena.state === 'MENU' && arena.screen === 'select', JSON.stringify(arena));
    check('the arena button shows the choice', arena.arenaBtn.includes(arena.after), arena.arenaBtn);

    section('Starting broadcasts one concrete arena:');
    const started = await D(() => {
        const D2 = window.ACDebug;
        D2.netDrainOutbox();
        D2.startOnline();
        const out = D2.netDrainOutbox();
        const start = out.find(m => m.t === 'START');
        return { start, state: D2.gameState, sent: out.map(m => m.t) };
    });
    check('a START is sent', !!started.start, JSON.stringify(started.sent));
    check('START names a CONCRETE arena, not "random"',
        !!started.start && typeof started.start.map === 'string' && started.start.map.length > 0,
        JSON.stringify(started.start));
    check('START carries both fighters',
        !!started.start && started.start.p1 === 'Kaelen' && started.start.p2 === 'Lyra',
        JSON.stringify(started.start));

    // =====================================================================
    section('As the JOINER: no arena, no mode, no start button:');
    const asGuest = await D(() => {
        const D2 = window.ACDebug;
        D2.goHome();
        D2.netFakeConnect('joiner');
        // getClientRects() is empty when an element is not rendered for ANY
        // reason - including a hidden ancestor, which a computed-display check
        // on the element itself misses entirely. That mattered here: the roster
        // grids are display:grid inside a wrapper that gets hidden, so the
        // naive check reported both rosters visible when neither was on screen.
        // It also behaves correctly for the position:fixed modals.
        const vis = id => {
            const el = document.getElementById(id);
            return !!el && el.getClientRects().length > 0;
        };
        // A STARTER - previewPick correctly refuses a locked character, and
        // using one here made this read as a UI bug when it was the test buying
        // nothing first. STARTER_CHARS = Kaelen, Lyra, Draven.
        D2.previewPick('p2', 'Draven');
        D2.confirmPick('p2');
        D2.netFeed({ t: 'PICK', side: 'p1', name: 'Kaelen' });
        return {
            localSide: D2.LOCAL_SIDE,
            p1GridVisible: vis('p1-grid'),
            p2GridVisible: vis('p2-grid'),
            hostControls: vis('host-controls'),
            guestSetup: vis('guest-setup'),
            startVisible: vis('btn-start-match'),
            note: (document.getElementById('setup-note') || {}).textContent,
            youRole: (document.getElementById('slot-you-role') || {}).textContent,
            foeRole: (document.getElementById('slot-foe-role') || {}).textContent,
            codeChip: vis('room-code-chip'),
            guestArena: (document.getElementById('guest-arena') || {}).textContent,
        };
    });
    check('the joiner drives p2', asGuest.localSide === 'p2', asGuest.localSide);
    check('the joiner sees only ITS OWN roster',
        asGuest.p2GridVisible && !asGuest.p1GridVisible, JSON.stringify(asGuest));
    check('the joiner gets a read-only setup summary, not the host controls',
        !asGuest.hostControls && asGuest.guestSetup, JSON.stringify(asGuest));
    check('the joiner never sees a Start button, even with both ready',
        !asGuest.startVisible, String(asGuest.startVisible));
    check('the joiner is told it is waiting for the host',
        /waiting for the host/i.test(asGuest.note), asGuest.note);
    check('the joiner slot labels the opponent as the host', /Host/.test(asGuest.foeRole), asGuest.foeRole);
    check('the room code is not shown back to the joiner - they typed it',
        !asGuest.codeChip, String(asGuest.codeChip));
    await page.screenshot({ path: DIR + 'b34-room-guest.png' });

    section('One account, whichever slot you drive:');
    // This was a real bug: progression is keyed p1/p2, so hosting spent p1's
    // coins and joining spent p2's - your roster changed with the button you
    // pressed in the lobby.
    const account = await D(() => {
        const D2 = window.ACDebug;
        // as the joiner (LOCAL_SIDE === 'p2') right now
        const asJoiner = { side: D2.LOCAL_SIDE, coins: D2.myProg().coins, owned: D2.myProg().unlockedChars.length };
        D2.addCoins(D2.LOCAL_SIDE, 500);
        const afterEarn = D2.myProg().coins;
        D2.goHome();
        D2.netFakeConnect('host');
        const asHost2 = { side: D2.LOCAL_SIDE, coins: D2.myProg().coins, owned: D2.myProg().unlockedChars.length };
        return { asJoiner, afterEarn, asHost2, account: D2.ACCOUNT };
    });
    check('coins earned as the joiner are there when you host',
        account.asHost2.coins === account.afterEarn,
        JSON.stringify(account));
    check('the roster is the same account in both roles',
        account.asJoiner.owned === account.asHost2.owned, JSON.stringify(account));

    section('Losing the opponent on a menu returns you to the front page:');
    const lost = await D(() => {
        const D2 = window.ACDebug;
        // Explicitly on a menu: the previous section started a real match, and
        // onNetLost's in-match branch (pause + say so) is a different case,
        // covered by netcheck.
        D2.goHome();
        D2.netFakeConnect('host');
        D2.netTeardown('Opponent disconnected');
        D2.onNetLost();
        // getClientRects() is empty when an element is not rendered for ANY
        // reason - including a hidden ancestor, which a computed-display check
        // on the element itself misses entirely. That mattered here: the roster
        // grids are display:grid inside a wrapper that gets hidden, so the
        // naive check reported both rosters visible when neither was on screen.
        // It also behaves correctly for the position:fixed modals.
        const vis = id => {
            const el = document.getElementById(id);
            return !!el && el.getClientRects().length > 0;
        };
        return {
            screen: D2.currentScreen,
            homeVisible: vis('home-screen'),
            lobbyVisible: vis('lobby-screen'),
            status: (document.getElementById('lobby-status') || {}).textContent,
        };
    });
    check('a dropped connection on a menu goes home, not to a dead room',
        lost.screen === 'home' && lost.homeVisible, JSON.stringify(lost));
    check('and it says why, with the lobby open to try again',
        lost.lobbyVisible && /disconnect/i.test(lost.status), JSON.stringify(lost));

    await finish(b, page);
})();
