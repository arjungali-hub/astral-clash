-- Roadmap 11 and 21: balance data, and knowing when it breaks.
--
-- ============================================================================
-- THE RULE: NOTHING HERE CAN BE TRACED TO A PERSON
-- ============================================================================
--
-- The game's own netcode comments say a peer-to-peer match should not depend on
-- a third party or tell one who is playing. That principle is kept, and the way
-- it is kept is STRUCTURAL rather than a promise: there is nowhere to put a
-- player, an account, a device or a session, because no such column exists.
--
-- You cannot leak a field you did not create. A policy saying "do not log the
-- user id" survives exactly as long as the next person who has not read it.
--
-- WHAT IS DELIBERATELY ABSENT:
--   * no user_id, account, username, display name
--   * no IP address (see the note on the insert policy)
--   * no device, browser, screen size or anything fingerprintable
--   * no session or match id - two rows cannot be linked as "the same person"
--   * no precise time. The date is stored as a DATE, not a timestamp, so the
--     finest grain available is "some day". A timestamp to the second is a
--     near-unique identifier when combined with anything else at all.
--
-- WHAT IS LEFT IS A TALLY. "On this date, Kaelen beat Lyra in Classic." Add
-- them up and you learn whether a fighter is too strong, which was the whole
-- question. You cannot learn anything about a person, because nothing about a
-- person was written down.

-- ---------------------------------------------------------------------------
-- 11: BALANCE
-- ---------------------------------------------------------------------------
create table if not exists public.match_results (
    -- A surrogate key, because there is nothing natural to key on - which is
    -- itself the point.
    id         bigserial primary key,

    -- DATE, not timestamptz. See above: the grain is a day, on purpose.
    played_on  date not null default (now() at time zone 'utc')::date,

    mode       text not null check (mode in ('classic', 'zone', 'timeattack', 'boss', 'survival')),
    winner     text not null,
    loser      text not null,

    -- Rounds the loser took, 0-2. Distinguishes a 2-0 from a 2-1, which is the
    -- difference between "too strong" and "slightly ahead".
    loser_rounds smallint not null default 0 check (loser_rounds between 0 and 9)
);

-- Queried by fighter and by mode when adding up a balance picture.
create index if not exists match_results_winner_idx on public.match_results (winner);
create index if not exists match_results_mode_idx on public.match_results (mode);

-- ---------------------------------------------------------------------------
-- 21: ERRORS
-- ---------------------------------------------------------------------------
create table if not exists public.error_reports (
    id         bigserial primary key,
    seen_on    date not null default (now() at time zone 'utc')::date,

    -- The message and the first frames, truncated. Enough to recognise a bug;
    -- not enough to be a story about a session.
    message    text not null check (char_length(message) <= 300),
    where_at   text check (char_length(where_at) <= 300),

    -- Which build it came from, because a fault in one and not the other is
    -- most of the diagnosis. Two values, so it cannot carry anything else.
    build      text not null check (build in ('online', 'local'))
);

create index if not exists error_reports_message_idx on public.error_reports (message);

-- ---------------------------------------------------------------------------
-- WRITE-ONLY, FOR EVERYONE
-- ---------------------------------------------------------------------------
-- Anyone may INSERT and nobody may SELECT. That asymmetry is the second half of
-- the privacy design, and it is worth being explicit about why:
--
--   * the game must be able to report without an account, because a crash
--     before sign-in is exactly the crash worth hearing about;
--   * nobody holding the public key may read what anyone else reported. Even
--     with nothing identifying in a row, a readable table invites somebody to
--     correlate it with something else.
--
-- Reading is for the owner, through the dashboard or the service role.
alter table public.match_results enable row level security;
alter table public.error_reports enable row level security;

drop policy if exists "match_results: anyone may report" on public.match_results;
create policy "match_results: anyone may report"
    on public.match_results for insert with check (true);

drop policy if exists "error_reports: anyone may report" on public.error_reports;
create policy "error_reports: anyone may report"
    on public.error_reports for insert with check (true);

-- NOTE ON IP ADDRESSES. Supabase's edge logs record the IP of any request, as
-- every web server does, and that is outside this schema's control. What IS in
-- its control is that no row here can be joined to one: there is no column to
-- join on and no timestamp finer than a day to correlate by. Log retention is a
-- project setting, and shortening it is the remaining lever if that matters.

-- INSERT only. Explicitly, as 0003 established, rather than leaving whatever
-- Postgres' defaults handed out - which last time included TRUNCATE.
revoke all on public.match_results from anon, authenticated;
revoke all on public.error_reports from anon, authenticated;
grant insert on public.match_results to anon, authenticated;
grant insert on public.error_reports to anon, authenticated;
grant usage, select on sequence public.match_results_id_seq to anon, authenticated;
grant usage, select on sequence public.error_reports_id_seq to anon, authenticated;
grant all on public.match_results to service_role;
grant all on public.error_reports to service_role;

-- ---------------------------------------------------------------------------
-- READING IT BACK
-- ---------------------------------------------------------------------------
-- Views for the owner. Nothing the game calls - they exist so the question
-- "is anything unbalanced" has a direct answer rather than a query to rewrite
-- every time.
create or replace view public.balance_by_fighter as
select f.fighter,
       count(*) filter (where f.won) as wins,
       count(*) filter (where not f.won) as losses,
       count(*) as matches,
       round(100.0 * count(*) filter (where f.won) / nullif(count(*), 0), 1) as win_pct
from (
    select winner as fighter, true as won from public.match_results
    union all
    select loser as fighter, false from public.match_results
) f
group by f.fighter
order by win_pct desc nulls last;

create or replace view public.errors_by_message as
select message, build, count(*) as seen, max(seen_on) as last_seen
from public.error_reports
group by message, build
order by seen desc;
