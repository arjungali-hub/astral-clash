-- A fully unlocked save, for your own account.
--
-- RUN THIS AFTER CREATING YOUR ACCOUNT IN THE GAME. The row keys on your
-- profile, which does not exist until you have signed up once - there is
-- nothing for this to attach to before then.
--
-- Keyed on your USERNAME, so there is no uuid to go and look up. Put yours on
-- the next line (lowercase, as stored) and run the whole thing.

with me as (
    select user_id from public.profiles where username = lower('YOUR-USERNAME-HERE')
)
insert into public.saves (user_id, data, device)
select me.user_id, $save${"p1":{"coins":99999,"unlockedChars":["Kaelen","Lyra","Gorgonok","Voss","Draven","Seraphine","Nyx","Ignis","Aurelia","Thorne"],"upgrades":{"Kaelen":{"hp":3,"dmg":3,"special":3,"speed":3},"Lyra":{"hp":3,"dmg":3,"special":3,"speed":3},"Gorgonok":{"hp":3,"dmg":3,"special":3,"speed":3},"Voss":{"hp":3,"dmg":3,"special":3,"speed":3},"Draven":{"hp":3,"dmg":3,"special":3,"speed":3},"Seraphine":{"hp":3,"dmg":3,"special":3,"speed":3},"Nyx":{"hp":3,"dmg":3,"special":3,"speed":3},"Ignis":{"hp":3,"dmg":3,"special":3,"speed":3},"Aurelia":{"hp":3,"dmg":3,"special":3,"speed":3},"Thorne":{"hp":3,"dmg":3,"special":3,"speed":3}},"doubleJumpUnlocked":true,"daily":null},"p2":{"coins":99999,"unlockedChars":["Kaelen","Lyra","Gorgonok","Voss","Draven","Seraphine","Nyx","Ignis","Aurelia","Thorne"],"upgrades":{"Kaelen":{"hp":3,"dmg":3,"special":3,"speed":3},"Lyra":{"hp":3,"dmg":3,"special":3,"speed":3},"Gorgonok":{"hp":3,"dmg":3,"special":3,"speed":3},"Voss":{"hp":3,"dmg":3,"special":3,"speed":3},"Draven":{"hp":3,"dmg":3,"special":3,"speed":3},"Seraphine":{"hp":3,"dmg":3,"special":3,"speed":3},"Nyx":{"hp":3,"dmg":3,"special":3,"speed":3},"Ignis":{"hp":3,"dmg":3,"special":3,"speed":3},"Aurelia":{"hp":3,"dmg":3,"special":3,"speed":3},"Thorne":{"hp":3,"dmg":3,"special":3,"speed":3}},"doubleJumpUnlocked":true,"daily":null}}$save$::jsonb, 'seeded'
from me
-- Idempotent, and safe to re-run after playing: it overwrites rather than
-- failing because the row is already there.
on conflict (user_id) do update
    set data = excluded.data,
        device = excluded.device;

-- 0 means the username did not match anybody: create the account in the game
-- first, or check the spelling. 1 means you are done - sign out and back in to
-- pull it down.
select count(*) as rows_written
from public.saves s
join public.profiles p on p.user_id = s.user_id
where p.username = lower('YOUR-USERNAME-HERE');
