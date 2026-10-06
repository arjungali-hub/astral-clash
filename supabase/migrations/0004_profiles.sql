-- Accounts: a username, a display name, an email, and a password.
--
-- THE EMAIL IS THE AUTH IDENTITY, and that is a deliberate reversal.
--
-- An earlier draft gave every account a synthetic address derived from its
-- username (`<username>@users.astral-clash.invalid`) so that no real address
-- was ever collected. That worked, and it made password reset IMPOSSIBLE:
-- Supabase mails a recovery link to the address on auth.users, and that address
-- could never receive anything. Asking for a real one is the price of being
-- able to recover an account, and it is worth paying.
--
-- So: auth.users.email holds the player's real address, and
-- resetPasswordForEmail() works with no custom machinery at all.
--
-- WHICH LEAVES ONE PROBLEM. Signing in needs the email, and the player types a
-- USERNAME. Something has to map one to the other before the auth call, and
-- there is no server of ours to do it in - this is a static page talking
-- straight to Supabase.
--
-- login_email_for() below is that mapping, and it DOES let anyone who guesses a
-- username learn the address behind it. That is a real cost and it is taken
-- knowingly:
--
--   * usernames are not published anywhere in this game. There are no profiles,
--     no leaderboards and no player list; an opponent sees your DISPLAY name,
--     never your username. So there is nothing to enumerate from.
--   * the alternative is email-only sign-in, which removes the function
--     entirely. If that trade ever looks wrong, deleting login_email_for and
--     the one branch that calls it is the whole change.
--
-- Every real site that offers username login either does it server-side or
-- accepts this. With no server, those are the two options.

create table if not exists public.profiles (
    -- Same key shape as `saves`: the user IS the row.
    user_id      uuid primary key references auth.users (id) on delete cascade,

    -- THE LOGIN NAME, stored lowercase so `Arjun` and `arjun` cannot both be
    -- taken. The constraint is on the stored value and the client lowercases
    -- before sending, so uniqueness is a database fact rather than a convention
    -- two code paths have to remember.
    username     text not null unique
                 check (username = lower(username)
                        and char_length(username) between 3 and 20
                        and username ~ '^[a-z0-9_]+$'),

    -- WHAT OTHER PLAYERS SEE. Separate from the username on purpose: the login
    -- name has to be unique and typeable, a display name should be neither.
    -- Someone can be `arjun_g` to the database and `Arjun` in the lobby, and so
    -- can somebody else.
    display_name text not null
                 check (char_length(display_name) between 1 and 14),

    created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Own row only. Nothing in this game needs to read anyone else's profile - an
-- opponent's display name already travels over the game's own connection in the
-- HELLO packet - so the narrow policy is also the complete one.
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
    on public.profiles for select using (auth.uid() = user_id);

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
    on public.profiles for insert with check (auth.uid() = user_id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
    on public.profiles for update
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- IS THIS USERNAME FREE. Needed BEFORE signing up, so by definition by somebody
-- with no session - and the select policy above (rightly) shows them nothing.
--
-- One boolean is the whole exposure. The alternative, a policy letting
-- anonymous callers read the username column, hands out the complete list of
-- who has an account here.
create or replace function public.username_available(candidate text)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
    select not exists (
        select 1 from public.profiles p where p.username = lower(candidate)
    );
$$;

-- THE USERNAME -> EMAIL MAPPING signing in needs. See the header for why this
-- exists and what it costs.
--
-- Returns null for an unknown username rather than raising: "no such user" and
-- "wrong password" must be indistinguishable to the caller, and the client
-- reports one message for both.
create or replace function public.login_email_for(candidate text)
returns text
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
    select u.email
    from public.profiles p
    join auth.users u on u.id = p.user_id
    where p.username = lower(candidate);
$$;

-- Both are called before sign-up and sign-in, so anon needs them. Granted
-- explicitly rather than relying on the default grant to PUBLIC, which 0002 and
-- 0003 both had to go back and remove.
revoke execute on function public.username_available(text) from public;
revoke execute on function public.login_email_for(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.login_email_for(text) to anon, authenticated;

-- Same shape as `saves` in 0003: state the whole intended set rather than
-- subtracting from whatever Postgres' defaults happened to hand out.
revoke all on public.profiles from anon;
revoke all on public.profiles from authenticated;
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
