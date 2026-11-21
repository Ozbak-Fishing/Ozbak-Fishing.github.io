# Ozbak — Lifelist App (Supabase-backed)

A static PWA (no build step) for Ozbak's fishing lifelist, built from
`../plan-de-match.md`. Since 2026-11-21 the app is backed by the owner's
real **Supabase** project — the same project (and the same tables) that his
Lovable site reads. The public site stays read-only for visitors; only the
signed-in admin can write.

- **Live site**: https://ozbak-fishing.github.io/
- **Supabase project**: `https://dapfearinbupdsuglrcs.supabase.co`
  (URL + public anon key are embedded in `app.js` — they are client-safe by
  design. There is **no** service_role key anywhere in this app, by design.)

## How to open / test locally

Serve the folder over HTTP (service worker + `fetch()` need `http://`):

```bash
cd ~/workspace/app-ozbak/app
python3 -m http.server 8765
# then open http://localhost:8765 in a browser (phone or desktop)
```

Smoke tests:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8765/index.html
node --check app.js && node --check sw.js
```

On a phone, the page can be installed ("Add to Home screen") thanks to
`manifest.json` + `sw.js`.

## How the data flows

### Live read (everyone, no login)

On load, the app fetches `species` and `missing_species` from Supabase REST
with the **anon key** (RLS allows public SELECT on both tables) and maps
rows to the app's fish model:

- `category` → gallery (`main` / `subspecies` / `hybrid(s)` → Hybrids);
  `capture_number` → #; `water_type` → the Freshwater/Saltwater label
  (Subspecies display as "Variant", as before); `country` / `place` are the
  separated fields; `image_url` → photo; `inaturalist_url` → the iNat link.
- Missing QC: the quest number is parsed out of `french_name`
  (`"[73] Saumon Chinook"` → quest `73`, name `Saumon Chinook`);
  `is_priority` → the ★ badge; `image_url` → the illustration.

Fallback chain if Supabase cannot be reached (short timeout):

1. **Last-good dataset** persisted in `localStorage` (key `ozbakAppV2`);
2. the **bundled `data.json`** snapshot (version `2026-11-21-r4`).

The old V1 store (`ozbakAppV1`, PIN simulation) is ignored except that its
sync-mode choice is migrated once. The Admin panel shows which source is in
use ("Data source").

### Admin auth (real — the PIN simulation is gone)

The Admin tab shows an **email + password** form (Supabase Auth,
`POST /auth/v1/token?grant_type=password`). The session (access/refresh
token + expiry) is kept in `localStorage` (`ozbakSession`) and refreshed
automatically when expired. After sign-in the app checks
`user_roles?user_id=eq.<uid>`: **only an `admin` role unlocks the panel** —
any other account gets a clear "not an admin account" message and is signed
out immediately. The password itself is only ever sent from the form to
Supabase; it is never stored or logged.

### Writes (admin JWT only)

All writes send the signed-in admin's JWT (RLS: "Admins can manage
species / missing species"; storage `species-images` is public-read,
admin-write). Every species write includes **all** fields, including the
legacy merged `location` composed from country/place
(`Canada + Québec → "Canada (Quebec)"`, `États-Unis + Maine → "Usa (Maine)"`)
because the Lovable site still reads that string.

- **Add / confirm a catch**: a new photo (from the existing picker + canvas
  crop) is uploaded first to `species-images/<timestamp>-<random>.jpg`, its
  public URL becomes `image_url`; then the row is INSERTed into `species`.
- **Edit**: PATCH `species?id=eq.<uuid>`. Changing the # (S12, only to fix a
  validation-order mistake) shifts the affected peers by ±1 with individual
  PATCHes ordered to avoid transient duplicates (descending when numbers go
  up, ascending when they go down), then the edited fish is PATCHed.
- **Missing QC transfer**: the prefilled form INSERTs the species row, then
  DELETEs the `missing_species` row.
- The duplicate-scientific-name check (S2) still runs against the in-memory
  list, so it works offline. It is scoped to the **same gallery** as the fish
  being added/edited (and never flags a fish against itself): the same
  scientific name may legitimately exist in another gallery — e.g.
  *Carassius auratus* is both a main species and, in captive form, a
  subspecies.

### Offline: pending catches + outbox

- **Pending-confirmation catches (S10) are LOCAL-ONLY**: unnumbered,
  unpublished, never sent anywhere until the owner confirms them in the
  Admin panel. Confirming assigns the next # and queues the insert.
- Confirmed writes go through a **persisted outbox** (`localStorage`). A
  write is queued instead of sent when: offline, not signed in as admin, the
  data control is **Blocked**, or the data control is **Wi-Fi only** while
  on a known cellular connection. The sync runner processes the queue
  sequentially when signed in as admin + online + the data control allows
  it; the **Sync now** button always forces an attempt when online and
  signed in (a deliberate manual action — it works even in "Blocked" mode).
  The indicator shows **Synchronized / Pending: N / Offline**.
- After a successful write, the dataset is re-fetched from Supabase and the
  UI re-renders, so the phone, the public site and Lovable all converge on
  the same tables.

### Without any connection

The app still opens and browses (service worker `ozbak-v5`, network-first
with cache fallback; last-good dataset in `localStorage`). Admin actions
taken offline simply wait in the outbox / pending list until sync is
possible.

## What visitors see (unchanged from V1)

Home with counters (51 Main / 2 Subspecies / 0 Hybrids / 78 Missing QC),
social links (real URLs), statistics (year, country/place, water, family —
count **and** %); the home page also carries a **QR code block**
(`qr-site.svg`, encoding https://ozbak-fishing.github.io/) under the
social links — meant to be shown to people he meets, e.g. while travelling:
tap it and it opens large in the usual popup. The SVG is a bundled asset
in the service-worker precache, so it displays fully offline; galleries in grid/list with EN/FR/scientific search,
filters (family, type, and two location dropdowns — Country, then Place,
the place list following the selected country), sort by number/name/family in both directions (newest first by
default); the fish popup with Date / Country / Place on separate lines,
notes and the iNaturalist link; EN base language with FR toggle inverting
the primary name. The data control (Blocked / Wi-Fi only / Wi-Fi + mobile)
lives **inside the admin panel only**, as specified.

## Shared with Lovable — do not break

The Lovable site reads the same `species` / `missing_species` tables and
the legacy `location` string, and displays Missing QC names **with** their
`[n]` prefix. Never drop or rename existing columns; when this app writes a
species it always composes `location` from country/place, and it never
writes `missing_species` names (transfers delete the row instead).

## Verification status

Verified locally with stubbed `fetch` (no real credentials): live-read
mapping (51/2/0/78, quest parsing, country/place), admin vs non-admin
sign-in, and the outbox (offline queue → sync inserts once with the
composed legacy location). **Not** verifiable without the owner: a real
login and a real photo upload on the live site.
