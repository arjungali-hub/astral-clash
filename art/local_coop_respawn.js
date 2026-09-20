// Co-op down-and-respawn for the ARCHIVED split-screen build, inserted by
// art/sync_local.py ahead of resolveCoopMode.
//
// Hand-written rather than lifted out of index.html because the online version
// reasons about which client owns a fighter's respawn clock, and this build has
// no netcode at all: there is one machine, and it owns both. Everything else -
// the 25-second clock, the half-bar return, the wipe condition - is the same
// rule, and lives in the constants the port copies across verbatim.
//
// It lives in its own file rather than as a string inside the port script so
// that it is readable AS JavaScript: a 60-line JS function embedded in a Python
// string literal is where escaping mistakes come from.

// Split-screen owns both fighters, so both clocks run here.
function coopOwnsRespawn(f) { return true; }

// A KO in co-op. Everything in flight is dropped for the same reason respawn()
// drops it: a body that comes back already on fire or mid-swing is the classic
// shape of this bug.
function coopDown(f) {
    f.downed = true;
    f.respawnTimer = COOP_RESPAWN_FRAMES;
    f.hp = 0;
    f.vx = f.vy = 0;
    f.atkState = 'idle'; f.atkStateTimer = 0; f.atkKind = null; f.atkOpponent = null;
    f.hitstunTimer = 0; f.rootedFrames = 0;
    f.burnFrames = 0; f.burnDps = 0;
    f.shieldFrames = 0;
    f.projectiles.forEach(p => removeAndDispose(p.mesh));
    f.projectiles.length = 0;
    f.queue.length = 0;
}

function coopRevive(f) {
    // Back at your own spawn, not next to your teammate: dropping a half-health
    // fighter into the middle of the fight they just lost is a second death,
    // and the walk back is the rest of the cost of the first.
    f.respawn(f === player1 ? matchMap.spawn1 : matchMap.spawn2, COOP_RESPAWN_HP_FRAC);
    sfxRoundStart();
}

// The respawn clock, for both players: the one on the floor needs to know how
// long, and the one still standing needs to know how long they are alone.
function drawCoopDownHUD() {
    const down = [player1, player2].filter(f => f && f.downed);
    if (!down.length) return;
    hudCtx.textAlign = 'center';
    let y = coopEnemies.length ? 196 : 150;
    for (const f of down) {
        const secs = Math.max(1, Math.ceil(f.respawnTimer / 60));
        hudCtx.font = hudFont(17, true);
        hudCtx.fillStyle = '#fbbf24';
        hudCtx.fillText(f.name + ' is down — back in ' + secs + 's', VIRTUAL_W / 2, y);
        y += 22;
    }
    hudCtx.font = hudFont(12);
    hudCtx.fillStyle = '#94a3b8';
    hudCtx.fillText('If the last fighter standing falls, the run is over.', VIRTUAL_W / 2, y);
    hudCtx.textAlign = 'left';
}
