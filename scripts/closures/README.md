# Road reports – moderator workflow

Users can long-press a road → **Report road issue** → *Road closed / Delay / Construction / Flooding* (+ optional note).
The report is sent like every other in-app report: an anonymous `kh_events` row (`type = 'layer'`, `props.k = 'closure'`,
`install_id = 'anon'`, `session_id = null`, no country/city, no client time, language, device, OS or app version), position rounded to 4 decimals (~11 m), through the
public insert-only key. **Nothing a user sends is shown in the app.** The map only shows entries a moderator put into
the static file `data/closures.json` (schema: `data/closures.schema.json`). Entries past `expires` are hidden by the
app automatically (max. 14 days after `since`).

## 1. Export the pending reports (Supabase dashboard → SQL editor, with your own moderator login)

```sql
select id, created_at, props
from kh_events
where type = 'layer' and props->>'k' = 'closure' and created_at > now() - interval '3 days'
order by created_at desc;
```

Download the result as JSON → `reports.json` (keep it **outside** the repo; never commit raw reports or keys).

## 2. Decide

Check each report (several independent reports near the same spot, local news, etc.). Write `approve.json`
(also outside the repo) with only the rows you approve:

```json
{ "123456": { "hours": 24 }, "123470": { "hours": 72, "note": "Bridge closed for repairs" } }
```

* `hours` – how long it stays visible: a positive number up to 336 (14 days); default 48 when omitted. `0`, negative
  or larger values are refused. Prefer short times; re-approve if still valid.
* `note` – optional, written by **you** (user notes are never published). Describe only the road situation in plain,
  neutral words (e.g. "Slow traffic", "Lane closed for repairs"). The script refuses notes with terms from the blocklist
  in `js/closures-core.js` or with personal data (phone numbers, e-mails, links, @handles) and tells you which report
  to fix; nothing is written in that case.

## 3. Write the file and publish

```sh
node scripts/closures/export-approved.mjs --reports ~/reports.json --approve ~/approve.json
node scripts/closures/export-approved.mjs --prune     # just drop expired entries
git add data/closures.json && git commit -m "closures: update" && open a PR
```

The script needs no network and no keys; it validates, rounds coordinates, de-duplicates by report id and drops
expired entries. The service worker fetches `data/closures.json` network-first, so updates reach users without an app
version bump.
