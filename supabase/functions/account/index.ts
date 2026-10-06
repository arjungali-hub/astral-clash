// Sign-up, sign-in and password-reset, by USERNAME, without ever telling the
// browser which email address is behind one.
//
// This file is the source for the deployed `account` Edge Function. Keep them
// identical: a copy that differs from what is actually running is worse than no
// copy at all.
//
// WHY SIGN-IN IS HERE. The game lets people sign in with a username; Supabase
// authenticates with an email. Something must map one to the other, and if the
// BROWSER does that mapping the mapping is public - guess a username, learn the
// address. So the lookup and the auth call both happen here and only a session
// goes back.
//
// WHY SIGN-UP IS HERE, which was learned the hard way. The client used to call
// supabase.auth.signUp() and then insert the profile row itself. That works only
// when sign-up returns a SESSION - and with email confirmation on, which is the
// right setting, it does not. The client was still anonymous at the moment it
// tried to write, `anon` has no insert grant on profiles, and the whole thing
// failed with "permission denied for table profiles" after having already
// created the auth user. Every attempt left an account with no profile behind
// it, which can neither sign in nor sign up again with the same address.
//
// Doing it here makes the two halves one operation: the user and the profile
// are created together with the service role, and if the profile cannot be
// written the user is deleted again rather than left orphaned.
//
// WHAT THIS IS CAREFUL ABOUT:
//  * it never says whether a username exists - an unknown username and a wrong
//    password return the same error, and an unknown username still performs a
//    real password check so the two take comparably long. Replying faster for
//    "no such user" is the same leak, measured with a stopwatch.
//  * it never says whether an email is registered - reset always reports
//    success.
//  * the service role key is used only to read an address the browser may not
//    read, and to write rows the browser cannot write. It is never returned.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// The game is served from Vercel, so every call here is cross-origin and the
// preflight has to be answered or the browser never sends the real request.
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
    });

const SIGNIN_FAILED = 'That username and password do not match';
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Expected JSON' }, 400);
    }

    const action = String(body.action || '');
    const username = String(body.username || '').trim().toLowerCase();

    const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } },
    );
    // A SEPARATE client per auth call, on the anon key: those hold a user
    // session and must never be the service-role client.
    const anonClient = () => createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const emailFor = async (name: string): Promise<string | null> => {
        if (!name) return null;
        const { data, error } = await admin
            .from('profiles').select('user_id').eq('username', name).maybeSingle();
        if (error || !data) return null;
        const { data: u, error: uErr } = await admin.auth.admin.getUserById(data.user_id);
        if (uErr || !u || !u.user) return null;
        return u.user.email ?? null;
    };

    // --------------------------------------------------------------- signup
    if (action === 'signup') {
        const display = String(body.displayName || '').trim();
        const email = String(body.email || '').trim();
        const password = String(body.password || '');
        const redirectTo = typeof body.redirectTo === 'string' ? body.redirectTo : undefined;

        // Checked here as well as in the client and in the table's CHECK
        // constraints. The client's copy is for speed, the constraint is what
        // makes it true, and this is what stops a caller that is not the game.
        if (!USERNAME_RE.test(username)) {
            return json({ error: 'Letters, numbers and underscores only, 3-20 characters' }, 400);
        }
        if (!display || display.length > 14) {
            return json({ error: 'Pick a display name of 14 characters or fewer' }, 400);
        }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return json({ error: 'That does not look like an email address' }, 400);
        }
        if (password.length < 8) {
            return json({ error: 'Passwords are at least 8 characters' }, 400);
        }

        const { data: taken } = await admin
            .from('profiles').select('user_id').eq('username', username).maybeSingle();
        if (taken) return json({ error: 'That username is taken' }, 409);

        // The auth user first, because the profile references it.
        const { data: made, error: upErr } = await anonClient().auth.signUp({
            email, password, options: { emailRedirectTo: redirectTo },
        });
        if (upErr || !made.user) {
            const m = String(upErr?.message || '');
            return json({
                error: /already registered|already been registered/i.test(m)
                    ? 'There is already an account with that email'
                    : (m || 'Could not create the account'),
            }, 400);
        }

        const { error: pErr } = await admin.from('profiles')
            .insert({ user_id: made.user.id, username, display_name: display });
        if (pErr) {
            // ROLL BACK. An auth user with no profile cannot sign in and cannot
            // be signed up again with the same address - a dead end only an
            // administrator can clear. Better to undo it here.
            try { await admin.auth.admin.deleteUser(made.user.id); } catch (_e) { /* best effort */ }
            return json({
                error: /duplicate|unique/i.test(String(pErr.message))
                    ? 'That username is taken'
                    : 'Could not finish creating the account',
            }, 400);
        }

        // With confirmation on there is no session yet, and saying so is the
        // point - otherwise the next sign-in fails for a reason nobody gave.
        if (made.session) {
            return json({
                access_token: made.session.access_token,
                refresh_token: made.session.refresh_token,
            });
        }
        return json({ confirm: true, email });
    }

    // ---------------------------------------------------------------- login
    if (action === 'login') {
        const password = String(body.password || '');
        if (!username || !password) return json({ error: SIGNIN_FAILED }, 400);

        const email = await emailFor(username);

        // An unknown username still performs a sign-in attempt against an
        // address that cannot exist. It fails, as it must - but after doing the
        // same work, so the reply does not arrive sooner for a username nobody
        // has.
        const { data, error } = await anonClient().auth.signInWithPassword({
            email: email ?? `unknown-${crypto.randomUUID()}@users.astral-clash.invalid`,
            password,
        });

        if (error || !data.session) {
            // The one case worth separating, because the fix is in their inbox.
            const msg = String(error?.message || '');
            if (/not confirmed|confirm/i.test(msg)) {
                return json({ error: 'Confirm your email address first - check your inbox' }, 401);
            }
            return json({ error: SIGNIN_FAILED }, 401);
        }

        // Only the session. Nothing the caller did not earn by knowing the
        // password.
        return json({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
        });
    }

    // ---------------------------------------------------------------- reset
    if (action === 'reset') {
        // BY USERNAME, and the address is never revealed - the whole point of
        // doing it here. The player types the name they remember and the link
        // goes to the address on file.
        const email = await emailFor(username);
        if (email) {
            const redirectTo = typeof body.redirectTo === 'string' ? body.redirectTo : undefined;
            // Failures are swallowed on purpose: the reply below is the same
            // either way, so there is nothing to report that would not also
            // answer "does this username exist".
            try {
                await admin.auth.resetPasswordForEmail(email, { redirectTo });
            } catch (_e) { /* same reply either way */ }
        }
        return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
});
