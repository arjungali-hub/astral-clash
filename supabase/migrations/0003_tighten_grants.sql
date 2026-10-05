-- The grants nobody asked for.
--
-- 0001 granted `authenticated` exactly what the game needs. Checking the result
-- afterwards showed each role ALSO holding privileges that came from Postgres'
-- default privileges for new tables in `public`:
--
--   anon           REFERENCES, TRIGGER, TRUNCATE
--   authenticated  REFERENCES, TRIGGER, TRUNCATE  (plus the four it should have)
--   service_role   REFERENCES, TRIGGER, TRUNCATE
--
-- TRUNCATE IS THE ONE THAT MATTERS, and it is worth being precise about why:
-- **TRUNCATE is not subject to row level security.** Every policy in 0001 is
-- written against auth.uid(), and every one of them is bypassed by a TRUNCATE.
-- So those grants said, on paper, that any signed-in user - and any anonymous
-- one - could erase every player's save in a single statement.
--
-- In practice PostgREST offers no route to TRUNCATE, so it was not reachable
-- through the application. That is a reason to be unhurried about fixing it, not
-- a reason to leave it: "the only client we currently ship happens not to expose
-- this verb" is a property of today's client, and the grant is a property of the
-- database. The same argument appears in 0002 about a function that could not
-- really be called, and it was not good enough there either.
--
-- REFERENCES and TRIGGER are harmless by comparison - they allow pointing a
-- foreign key at this table and attaching a trigger to it - but neither role has
-- any business doing either, and a privilege nobody can justify is one nobody
-- will question later.

-- ANON GETS NOTHING. It cannot pass a single policy in 0001 - they all compare
-- against auth.uid(), which is null when signed out - so every privilege it
-- holds is one it can never legitimately use.
revoke all on public.saves from anon;

-- AUTHENTICATED GETS THE FOUR VERBS THE GAME USES, and only those. Reset to
-- nothing first so this is a statement of the whole intended set rather than a
-- subtraction from whatever happened to be there.
revoke all on public.saves from authenticated;
grant select, insert, update, delete on public.saves to authenticated;

-- SERVICE_ROLE GETS EVERYTHING, which is what it is for: it bypasses RLS by
-- design and its key is never shipped to a browser. Without this, an
-- administrative task or a future server-side job would find the table it is
-- meant to own unreadable - the one case where a missing grant is a surprise
-- rather than a safeguard.
grant all on public.saves to service_role;
