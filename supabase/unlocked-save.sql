-- A fully unlocked save, for your own account.
--
-- RUN THIS AFTER SIGNING IN AT LEAST ONCE. The row keys on auth.users, which
-- does not have you in it until the magic link has been clicked once - so there
-- is nothing for this to attach to before then.
--
-- Keyed on your EMAIL rather than a user id, so there is no uuid to go and look
-- up. Change the address on the next line and run the whole thing.

with me as (
    select id from auth.users where email = 'YOUR-EMAIL-HERE'
)
insert into public.saves (user_id, data, device)
select me.id, $save${"p1":{"coins":99999,"unlockedChars":["Kaelen","Lyra","Gorgonok","Voss","Draven","Seraphine","Nyx","Ignis","Aurelia","Thorne"],"upgrades":{"Kaelen":{"hp":3,"dmg":3,"special":3,"speed":3},"Lyra":{"hp":3,"dmg":3,"special":3,"speed":3},"Gorgonok":{"hp":3,"dmg":3,"special":3,"speed":3},"Voss":{"hp":3,"dmg":3,"special":3,"speed":3},"Draven":{"hp":3,"dmg":3,"special":3,"speed":3},"Seraphine":{"hp":3,"dmg":3,"special":3,"speed":3},"Nyx":{"hp":3,"dmg":3,"special":3,"speed":3},"Ignis":{"hp":3,"dmg":3,"special":3,"speed":3},"Aurelia":{"hp":3,"dmg":3,"special":3,"speed":3},"Thorne":{"hp":3,"dmg":3,"special":3,"speed":3}},"doubleJumpUnlocked":true,"daily":null},"p2":{"coins":99999,"unlockedChars":["Kaelen","Lyra","Gorgonok","Voss","Draven","Seraphine","Nyx","Ignis","Aurelia","Thorne"],"upgrades":{"Kaelen":{"hp":3,"dmg":3,"special":3,"speed":3},"Lyra":{"hp":3,"dmg":3,"special":3,"speed":3},"Gorgonok":{"hp":3,"dmg":3,"special":3,"speed":3},"Voss":{"hp":3,"dmg":3,"special":3,"speed":3},"Draven":{"hp":3,"dmg":3,"special":3,"speed":3},"Seraphine":{"hp":3,"dmg":3,"special":3,"speed":3},"Nyx":{"hp":3,"dmg":3,"special":3,"speed":3},"Ignis":{"hp":3,"dmg":3,"special":3,"speed":3},"Aurelia":{"hp":3,"dmg":3,"special":3,"speed":3},"Thorne":{"hp":3,"dmg":3,"special":3,"speed":3}},"doubleJumpUnlocked":true,"daily":null}}$save$::jsonb, 'seeded'
from me
-- Idempotent, and safe to re-run after playing: it overwrites rather than
-- failing on the row already being there.
on conflict (user_id) do update
    set data = excluded.data,
        device = excluded.device;

-- Zero rows means the email did not match anybody - sign in first, or check
-- the address.
select count(*) as rows_written from public.saves;
