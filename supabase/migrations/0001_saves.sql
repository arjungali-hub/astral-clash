-- Cloud saves for Astral Clash.
--
-- ONE ROW PER PLAYER, holding the whole progression blob. That blob is already
-- the unit the game reads and writes - `progression` goes into localStorage as
-- a single JSON string - so storing it as one jsonb keeps the cloud copy and
-- the local copy literally the same shape. Normalising coins, unlocks and
-- upgrades into columns would buy queries nobody runs and introduce a migration
-- every time a fighter is added.
--
-- The game stays playable with NO account and NO connection. This is a sync
-- target, not a source of truth: localStorage is still written first and read
-- first, so a flaky connection can never cost somebody their progress. That is
-- the whole reason the table is this boring.

create table if not exists public.saves (
    -- The primary key IS the user, which is what makes "one save per account"
    -- a database fact rather than something the client has to remember.
    user_id    uuid primary key references auth.users (id) on delete cascade,

    -- The progression blob, exactly as the game stores it: { p1: {...}, p2: {...} }.
    data       jsonb       not null,

    -- Which copy is newer. The client compares this against its own local
    -- stamp to decide pull-or-push, and shows BOTH to the player when they
    -- disagree rather than picking a winner quietly.
    updated_at timestamptz not null default now(),

    -- Free text, set by the client: "this device". Only ever shown back to the
    -- person it belongs to, to make "your other device has a newer save"
    -- mean something. Deliberately not a fingerprint.
    device     text
);

-- ROW LEVEL SECURITY. The anon key ships inside a static HTML page that anyone
-- can read, so it is public by construction and these policies are the entire
-- access control. Without them the key would be a key to everybody's save.
alter table public.saves enable row level security;

drop policy if exists "saves: read own" on public.saves;
create policy "saves: read own"
    on public.saves for select
    using (auth.uid() = user_id);

drop policy if exists "saves: insert own" on public.saves;
create policy "saves: insert own"
    on public.saves for insert
    with check (auth.uid() = user_id);

-- `using` AND `with check`: the first says which rows you may update, the
-- second says what you may change them into. Without the second, an update
-- could move a row to another user_id - which is a way of writing into
-- somebody else's save that passes the first check on the way out.
drop policy if exists "saves: update own" on public.saves;
create policy "saves: update own"
    on public.saves for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "saves: delete own" on public.saves;
create policy "saves: delete own"
    on public.saves for delete
    using (auth.uid() = user_id);

-- updated_at is maintained server-side so a client with a wrong clock - or one
-- that would rather its own copy won - cannot claim to be newer than it is.
create or replace function public.touch_saves_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists saves_touch_updated_at on public.saves;
create trigger saves_touch_updated_at
    before insert or update on public.saves
    for each row execute function public.touch_saves_updated_at();

-- ---------------------------------------------------------------------------
-- EXPOSURE, stated explicitly rather than inherited.
--
-- A table reaches supabase-js only if the Data API roles have privileges on it.
-- The project setting "Automatically expose new tables" would grant these for
-- us, but it is worth leaving OFF - it is Supabase's own recommendation, and it
-- means a table added later is invisible until somebody decides otherwise,
-- rather than public until somebody remembers.
--
-- So this table says so itself. Granted to `authenticated` ONLY: every policy
-- above is written against auth.uid(), so a signed-out caller could not pass
-- one anyway, and `anon` having no privileges at all makes that a fact about
-- the grant rather than a fact about the policies.
--
-- Harmless if the setting is left on - these are the privileges it would have
-- granted, and re-granting them changes nothing.
grant select, insert, update, delete on public.saves to authenticated;
