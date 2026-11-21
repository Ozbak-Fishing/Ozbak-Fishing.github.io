# Ozbak — Lifelist App (V1 prototype)

A static PWA prototype built from `../plan-de-match.md`, seeded with the real
imported data (`data.json` = copy of `../data/lifelist-import.json`:
**51 Main species, 2 Subspecies, 0 Hybrids, 78 Missing QC**) and the Ozbak
logo (`ozbak-logo.png`).

## How to open / test locally

Serve the folder over HTTP (a service worker and `fetch()` need `http://`,
opening `file://` will not fully work):

```bash
cd ~/workspace/app-ozbak/app
python3 -m http.server 8765
# then open http://localhost:8765 in a browser (phone or desktop)
```

Quick smoke tests:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8765/index.html
node --check app.js && node --check sw.js
```

On a phone on the same network, the page can be installed ("Add to Home
screen") thanks to `manifest.json` + `sw.js`; after the first load, the app
shell and data are cached for offline browsing.

## What works (all local, in the browser)

- **Home**: presentation, what a lifelist is, counter pills
  (51 Main species / 2 Subspecies / 0 Hybrids / Missing QC), social buttons
  (YouTube / Instagram / iNaturalist — placeholder `#` links, real URLs still
  to be provided), gallery shortcuts, **statistics** (by year, country/place,
  freshwater vs saltwater, family — bars show both the count and the %).
- **Galleries** (Main / Subspecies / Hybrids / Missing QC): grid **and** list
  views with toggle, search that matches English + French + scientific names
  in either language, filters (family, water type, place), sort (number —
  default, name, family), counter "x / y species".
- **Language**: EN is the base; the FR/EN toggle translates the whole UI and
  inverts fish names (selected language = big primary name, other language
  secondary, scientific unchanged).
- **Fish popup**: # + name, photo or placeholder, Identification
  (scientific / EN / FR / family), Water type, Capture with **Date, Country
  and Place on separate lines**, Notes, iNaturalist link when present,
  Share button (`navigator.share`, falls back to copying the link).
- **Missing QC**: name cards with a clean logo placeholder (no invented
  photos). In Admin mode, each card gets a **Transfer** button that opens the
  admin form pre-filled (names / scientific / family); only the capture info
  + photo are added, then the species leaves Missing QC and joins Main (or
  the pending list, if saved as pending).
- **Admin** (see "simulated" below): add fish with a photo picked from the
  device gallery **with a canvas crop step** (drag + zoom; the original photo
  is never touched), edit any fish — including changing its #, which inserts
  it at the new position and shifts higher numbers up by one (meant only to
  fix a validation-order mistake), duplicate-scientific-name warning before
  saving, **pending-confirmation list** (new catches stay unnumbered and
  unpublished until confirmed, then receive the next number), sync indicator
  (Synchronized / Pending: N), and the **data control (Sync blocked /
  Wi-Fi only / Wi-Fi + mobile) inside the admin panel only**.

## What is SIMULATED in V1 (not real yet)

- **PIN lock**: the PIN is only a local demo lock. A simple hash is kept in
  `localStorage` on this device/browser — it is **not real security** and
  anyone with the device could bypass it. It is a placeholder for
  **Supabase Auth** (real login) in the next step.
- **Sync**: there is no server. "Pending: N" counts local changes made since
  the last simulated sync; "Simulate sync now" just resets the counter
  (and refuses when the data control is set to "Sync blocked"). Real sync =
  Supabase (database + photo storage) plugged in where `saveState()` /
  `loadState()` currently read/write `localStorage`.
- **Data persistence**: everything (fish, pending catches, settings, cropped
  photo copies as data URLs) is stored in `localStorage` on top of the
  imported JSON. The Admin panel has a "Reset demo data" button that erases
  local changes and re-seeds from `data.json`.
- **Social links** are `#` placeholders until the real URLs are provided.

## Ready to plug into Supabase later

- Replace the PIN screen with Supabase Auth; keep the same admin UI.
- Replace `localStorage` reads/writes with Supabase tables (one row per fish:
  the JSON fields map 1-to-1) + a Storage bucket for photos (store the photo
  URL instead of a data URL).
- The public site is the same code with Admin never unlocked: read-only
  queries for visitors, writes only for the authenticated admin (RLS).
- Hosting: any free static host (Cloudflare Pages / Netlify / Vercel /
  GitHub Pages) — nothing in this folder needs a build step.

## Data notes (found during the build)

- All 53 caught fish have `photo: null` and `inaturalist: null`, and only
  3/51 Main fish have notes — the complete notes and the photos live on the
  current Lovable site, not in the Excel import. The app therefore shows the
  logo placeholder everywhere for now (by design — no photos were invented).
- Missing QC entries use `quest_num` (#7…X4) instead of a lifelist number,
  and have no water type / capture place — the gallery shows their quest
  number and, in the popup, the suggested place / when, when present (7/78
  have notes).
- Subspecies entries carry `category: "Variant"` (not Freshwater/Saltwater),
  so the water-type filter on that gallery lists "Variant".
- A few scientific names in the source keep the Excel's capitalisation
  (e.g. `Acipenser Oxyrinchus` in Missing QC) — displayed as-is, search is
  case/accent-insensitive so it does not affect finding them.
