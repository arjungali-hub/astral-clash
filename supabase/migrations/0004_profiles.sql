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
-- SIGNING IN DOES NOT HAPPEN HERE. The player types a username and Supabase
-- wants an address, so something must map one to the other - and if the browser
-- does that mapping, the mapping is public. It happens in the `account` Edge
-- Function instead, which looks the address up with the service role, performs
-- the sign-in, and returns only a session. See supabase/functions/account.

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

-- THERE IS NO USERNAME -> EMAIL FUNCTION HERE, and that is the point.
--
-- An earlier draft had `login_email_for(username)`, which the browser called
-- before signing in. It worked, and it handed the mapping to anyone who asked:
-- guess a username, learn the address behind it. The defence was that usernames
-- are published nowhere in this game - true, and a defence that rests on a fact
-- about today's features rather than on anything structural.
--
-- The sign-in moved off the browser instead. supabase/functions/account does
-- the lookup and the auth call server-side with the service role and returns
-- only a session, so the address never reaches a client at all.
--
-- Dropped rather than merely omitted, in case the earlier version was ever run.
drop function if exists public.login_email_for(text);

-- Called before sign-up, so anon needs it. Granted explicitly rather than
-- relying on the default grant to PUBLIC, which 0002 and 0003 both had to go
-- back and remove.
revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- Same shape as `saves` in 0003: state the whole intended set rather than
-- subtracting from whatever Postgres' defaults happened to hand out.
revoke all on public.profiles from anon;
revoke all on public.profiles from authenticated;
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
