-- Two security advisories, cleared.
--
-- Supabase's own database linter raised these the moment 0001 landed. Neither
-- was exploitable as far as I can tell, and both are worth fixing anyway: a
-- warning you have decided to live with is indistinguishable, six months later,
-- from one nobody read.

-- 1. FUNCTION SEARCH PATH. touch_saves_updated_at() ran with whatever
--    search_path the caller had. The attack it enables needs somebody able to
--    create objects in a schema earlier on that path - which, with the grants
--    in 0001, nobody using this application has. But a trigger function that
--    resolves its own names differently depending on who fired it is a loose
--    end regardless, and pinning it costs nothing: `now()` lives in pg_catalog,
--    which is always searched.
--
--    pg_catalog explicitly rather than '' to match what Supabase's own
--    functions in this database do.
alter function public.touch_saves_updated_at() set search_path = pg_catalog;

-- 2. A SECURITY DEFINER FUNCTION THE PUBLIC COULD CALL.
--
--    `rls_auto_enable()` is Supabase's, created by the project's "Enable
--    automatic RLS" option: an event trigger that turns RLS on for every new
--    table in `public`. That option is worth having - it is the safety net that
--    makes a future table safe if somebody forgets - but it arrived with
--    EXECUTE granted to `anon` and `authenticated`, so the linter saw a
--    SECURITY DEFINER function reachable at /rest/v1/rpc/rls_auto_enable.
--
--    In practice it is not callable: it RETURNS event_trigger, and Postgres
--    refuses to run such a function outside an actual DDL event. So this is
--    tidying rather than a fix. Done anyway, because "it happens to be
--    unreachable through this one path" is a worse reason to leave a grant in
--    place than any reason to remove it.
--
--    Revoking EXECUTE does NOT disable the feature. Event triggers fire as part
--    of DDL processing under the owner's rights; they never consult the EXECUTE
--    privilege of whichever API role is connected.
do $$
begin
    if exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'rls_auto_enable'
    ) then
        -- FROM PUBLIC, which is the part that matters. Revoking from anon
        -- and authenticated alone changed nothing and the advisory stayed
        -- up: the ACL read `=X/postgres`, and a bare `=` is the grant to
        -- PUBLIC - a pseudo-role every role inherits. Taking it from two
        -- members of a group does not take it from the group.
        revoke execute on function public.rls_auto_enable() from public;
        revoke execute on function public.rls_auto_enable() from anon, authenticated;
    end if;
end;
$$;
