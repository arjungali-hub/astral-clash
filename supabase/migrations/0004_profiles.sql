-- Real accounts: a username, a display name, and a password.
--
-- WHAT CHANGED AND WHY. The first version signed in with an emailed link and
-- treated the cloud as a backup of a local save. Both halves are replaced: you
-- sign in with a username and password, and the server is the only place
-- progress lives.
--
-- NO EMAIL ANYWHERE. Supabase Auth is built around an email address, so each
-- account gets a synthetic one derived from its username
-- (`<username>@users.astral-clash.invalid`). `.invalid` is reserved by RFC 2606
-- precisely so it can never resolve, which is the point: nothing is ever sent
-- there, the address exists only because auth.users needs a unique key, and the
-- username is the real identity.
--
-- The cost, stated plainly: THERE IS NO PASSWORD RESET. With no address to mail,
-- a forgotten password cannot be recovered by the player. The honest fix later
-- is an OPTIONAL recovery email on the profile - optional because requiring one
-- would reintroduce exactly what this avoids.

create table if not exists public.profiles (
    -- Same key shape as `saves`: the user IS the row.
    user_id      uuid primary key references auth.users (id) on delete cascade,

    -- THE LOGIN NAME, stored lowercase so `Arjun` and `arjun` cannot both be
    -- taken. The constraint is on the stored value and the client lowercases
    -- before sending, so the uniqueness is a database fact rather than a
    -- convention two code paths have to remember.
    username     text not null unique
                 check (username = lower(username)
                        and char_length(username) between 3 and 20
                        and username ~ '^[a-z0-9_]+$'),

    -- WHAT OTHER PLAYERS SEE. Separate from the username on purpose: the login
    -- name has to be unique and typeable, a display name should be neither.
    -- Someone can be `arjun_g` to the database and `Arjun` in the lobby.
    display_name text not null
                 check (char_length(display_name) between 1 and 14),

    created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Own row only. A player's username is not secret, but there is no feature here
-- that needs to enumerate other people's - the opponent's display name already
-- travels over the game's own connection in the HELLO packet - so the narrow
-- policy is also the complete one.
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
-- A function returning one boolean is the whole exposure. The alternative, a
-- policy letting anonymous callers read the username column, hands out the
-- complete list of who has an account here.
--
-- SECURITY DEFINER so it can see past RLS, with search_path pinned - an
-- unpinned one is the finding Supabase's linter raised against 0001.
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

-- Callable before sign-up, which means anon needs it. Granting it explicitly
-- rather than relying on the default grant to PUBLIC, which 0002 and 0003 both
-- had to go back and remove.
revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- Same shape as `saves` in 0003: state the whole intended set.
revoke all on public.profiles from anon;
revoke all on public.profiles from authenticated;
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
