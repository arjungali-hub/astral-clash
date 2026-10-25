# Password reset links

## The one setting that has to change in the Supabase dashboard

**Authentication → Emails → Reset Password**, and change the link so it sends a
`token_hash` to the game instead of pointing at Supabase's `/verify`:

```html
<a href="{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=recovery">
  Reset your password
</a>
```

The default template is `{{ .ConfirmationURL }}`, which points at
`.../auth/v1/verify?token=...`. **That URL spends the token the moment anything
fetches it** — and plenty of things fetch URLs before a person does.

## Why, with the evidence

A reset was requested and the link clicked within ten seconds. The auth log:

```
18:36:53  /recover + mail.send
18:36:59  /verify  request completed              <- succeeded
18:36:59  /verify  403 One-time token not found   <- SAME SECOND, same IP
```

Two verifies in the same second, from the same address. Nobody clicks twice in
the same second. Something on that machine — a link scanner, antivirus, or a
browser prefetch — followed the URL first and spent the token, and the real
click arrived to find it gone. The player is then told the link expired, which
is true and completely unhelpful, because it expired before they touched it.

This is not specific to this project. Any one-time link that is consumed by a
GET is vulnerable to whatever fetches links early, and corporate mail scanners
do it as a matter of policy.

## What changes

With `token_hash` in the query string, **loading the page does nothing**. The
game reads it and calls `verifyOtp()` deliberately, so the token is spent by an
action rather than by a visit. A prefetch now warms a page instead of burning a
password reset.

`consumeRecoveryToken()` in `shared/account.js` does the exchange. It clears the
query string first, so a reload cannot replay it and the token is not left in
the address bar or in history.

## The old links still work

The hash form (`#access_token=...`) is still handled, and so is
`#error=...&error_code=otp_expired`, which is what a spent link produces. An
email already sitting in somebody's inbox is not broken by this change — it is
just still vulnerable to the same prefetch, which is the reason to change the
template rather than only the code.

## Testing it

1. Request a link, click it **once**.
2. Expect the Account panel to open on **Choose a new password**.
3. Set one, and expect to land signed in.

If it fails, the auth log says exactly which request did what:

```sql
select timestamp, log_attributes['path'] as path,
       log_attributes['remote_addr'] as ip, log_attributes['error'] as err
from logs where source = 'auth_logs'
order by timestamp desc limit 12
```

Two `/verify` rows for one click means something is still fetching the link
early — and with the template above there should be no `/verify` row at all,
because the game no longer sends anyone there.
