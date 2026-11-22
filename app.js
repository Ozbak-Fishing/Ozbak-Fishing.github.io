'use strict';
/* Ozbak Lifelist — Supabase-backed app.
   Reads are LIVE from the owner's Supabase project (public anon key,
   client-safe by design). Writes go through the signed-in admin user's
   JWT (Supabase Auth + user_roles RLS). Offline: last-good dataset is
   cached in localStorage, pending-confirmation catches stay local-only,
   and confirmed writes queue in a persisted outbox until sync can run. */

const SB_URL = 'https://dapfearinbupdsuglrcs.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhcGZlYXJpbmJ1cGRzdWdscmNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2NDMyOTYsImV4cCI6MjA3MzIxOTI5Nn0.XNSEw0GX7BuC-rBDoY-ow-NJ-Ed_-8cEDnI3W8_nAh0';
const LS_KEY = 'ozbakAppV2';
const SESSION_KEY = 'ozbakSession';
const LANG_KEY = 'ozbakLang';
const VIEW_KEY = 'ozbakViewMode';

let lang = localStorage.getItem(LANG_KEY) || 'en';
let viewMode = localStorage.getItem(VIEW_KEY) || 'grid';
let route = { name: 'home' };
let state = null;
let adminUnlocked = false; // true only when signed in AND verified as admin in Supabase (user_roles)
let formPhoto = null;        // dataURL chosen/cropped in the admin form
let transferFromId = null;   // missing_qc fish id being transferred
let editId = null;           // fish id being edited

/* ---------------- i18n ---------------- */
const T = {
  en: {
    nav_home: 'Home', nav_main: 'Main species', nav_sub: 'Subspecies and variants', nav_hyb: 'Hybrids',
    nav_missing: 'Missing QC', nav_admin: 'Admin',
    footer_text: 'Ozbak — Lifelist · Catch & release',
    hero_title: 'Ozbak — Lifelist',
    hero_intro: "I'm Ozbak, a lifelister from Montréal (Anjou), Québec. I fish from shore, almost always catch & release, and I keep track of every species I catch.",
    what_title: 'What is a lifelist?',
    what_text: 'A lifelist is the search for ALL fish species — micro or monster, every size counts — as long as it is caught on a line. Each new species, once its identification is confirmed, takes the next number on the list, in catch order.',
    follow: 'Follow me',
    qr_caption: 'Scan to see my lifelist',
    galleries: 'Galleries', latest_title: 'Latest catches',
    prio_title: '★ Priority quests', prio_add: '☆ Make priority', prio_remove: '★ Remove from priorities',
    prio_full: 'You already have 5 priority quests — remove one first.',
    stats: 'Statistics',
    stat_year: 'By year', stat_place: 'By country / place', stat_water: 'Freshwater vs Saltwater', stat_family: 'By family',
    search_ph: 'Search a species…',
    all_families: 'All families', all_types: 'All types', all_countries: 'All countries', all_places: 'All places',
    sort_number: 'Sort: number', sort_name: 'Sort: name', sort_family: 'Sort: family',
    dir_desc: '↓ Descending', dir_asc: '↑ Ascending', priority: '★ Priority',
    species: 'species', no_results: 'No species matches your search.',
    grid: 'Grid', list: 'List',
    identification: 'Identification', scientific: 'Scientific name', english: 'English name',
    french: 'French name', family: 'Family', water_type: 'Water type', capture: 'Capture',
    date: 'Date', country: 'Country', place: 'Place', notes: 'Notes', share: 'Share', card_btn: 'Card', card_title: 'Your Instagram card', download: 'Download',
    inat: 'See the identification on iNaturalist (other photos)',
    quest: 'Quest', suggested_place: 'Suggested place', when: 'When',
    gal_main_d: 'My main collection of caught fish species.',
    gal_sub_d: 'Subspecies and variants I have caught.',
    gal_hyb_d: 'Hybrids I have caught.',
    gal_missing_d: 'Fish of Québec I have not caught yet.',
    transfer: 'Transfer (I caught it!)',
    admin_title: 'Admin',
    login_title: 'Admin login',
    login_text: 'Sign in with the app owner’s Supabase account. Only an admin account can add or edit fish — visitors only ever read the public site. The data control lives inside the admin panel only, so nobody you show the app to can turn it on.',
    email: 'Email', password: 'Password', sign_in: 'Sign in', sign_out: 'Sign out', signed_in_as: 'Signed in as',
    login_failed: 'Sign-in failed — check the email and password.',
    not_admin: 'This account is not an admin account for this app.',
    sync_status: 'Sync status', synchronized: 'Synchronized', pending_sync: 'Pending', sync_offline: 'Offline',
    data_control: 'Data control (sync)', sync_blocked: 'Sync blocked', sync_wifi: 'Wi-Fi only', sync_both: 'Wi-Fi + mobile data',
    sync_now: 'Sync now', backup_btn: '⬇ Full backup (ZIP: data + photos)', backup_running: 'Preparing backup…',
    bio_lock_title: 'Admin locked', bio_lock_text: 'This device asks for your fingerprint before opening the Admin — so nobody else can touch your lifelist.',
    bio_unlock_btn: 'Unlock with fingerprint', bio_fallback: 'Fingerprint problem? Disable the lock with your password', bio_disable_pw: 'Disable the fingerprint lock',
    bio_failed: 'Fingerprint check failed — try again, or use the password option below.', bio_panel_title: 'Fingerprint lock (this device)',
    bio_on_text: 'ON — this device will ask for your fingerprint before opening the Admin. Your password still works as the fallback.', bio_turn_off: 'Turn off the fingerprint lock',
    bio_off_text: 'OFF — turn it on to require your fingerprint before anyone can open the Admin on this device. Your password account stays the real key.', bio_turn_on: 'Turn on the fingerprint lock',
    bio_unavailable: 'No fingerprint / face unlock available in this browser on this device.',
    sync_error: 'Sync problem: the last change could not be sent. It stays saved on this device and will be retried.',
    sync_done_msg: 'Sync done — the site copy is now up to date.',
    sync_queued_msg: 'Saved on this device — it will sync when sign-in, connection and the data control allow it.',
    add_title: 'Add a fish', edit_title: 'Edit a fish',
    f_gallery: 'Gallery', f_status: 'Add as', st_pending: 'Pending confirmation (no number yet)', st_caught: 'Confirmed (gets the next number)',
    f_en: 'English name', f_fr: 'French name', f_sci: 'Scientific name', f_family: 'Family',
    f_water: 'Water type', f_date: 'Capture date', f_country: 'Country', f_place: 'Place (province / state / region)',
    f_notes: 'Notes', f_inat: 'iNaturalist link (optional)', f_photo: 'Photo — pick from the device gallery',
    crop_hint: 'Crop: drag the photo, use the zoom slider, then Apply crop. The original on the phone is never touched.',
    apply_crop: 'Apply crop', skip_crop: 'Keep full photo', photo_ready: 'Photo ready ✓',
    save: 'Save', cancel_edit: 'Cancel edit', edit_existing: 'Edit an existing fish',
    choose_fish: 'Choose a fish…', f_num: 'Number (#) — change ONLY to fix a validation-order mistake: the fish is inserted there and higher numbers shift up by one',
    dup_title: 'Duplicate warning', dup_msg: 'This scientific name already exists in your list: ',
    dup_ask: 'Save anyway?', pending_title: 'Pending confirmation',
    pending_empty: 'Nothing pending. New catches you add as "pending" will wait here, unnumbered and unpublished, until you confirm the identification.',
    confirm_btn: 'Confirm (assign next #)', delete_btn: 'Delete',
    saved_pending: 'Saved as pending — no number, not published, until confirmed.',
    saved_caught: 'Saved and published with #', transferred: 'Transferred! It left Missing QC.',
    updated: 'Fish updated.',
    del_btn: 'Delete this fish', del_intro: 'You are about to permanently delete:',
    del_consequence: 'It will be removed from the app and from the public site. The other fish keep their numbers. This cannot be undone.',
    del_type_label: 'Type the fish number to confirm', del_final: 'Delete permanently', del_cancel: 'Cancel',
    deleted_msg: 'Fish deleted.',
    data_source: 'Data source', source_live: 'Supabase — live data', source_cache: 'Saved copy on this device (the live data could not be reached)',
    source_bundled: 'Bundled copy in the app (the live data could not be reached)', refresh_btn: 'Reload data from Supabase',
    missing_admin_note: 'Admin is unlocked: you can transfer a missing species you caught from the Missing QC gallery.',
    home_admin_note: 'Admin: add a fish to my lifelist',
    required: 'English, French and scientific names are required.'
  },
  fr: {
    nav_home: 'Accueil', nav_main: 'Espèces principales', nav_sub: 'Sous-espèces et variants', nav_hyb: 'Hybrides',
    nav_missing: 'Manquants QC', nav_admin: 'Admin',
    footer_text: 'Ozbak — Lifelist · Remise à l’eau',
    hero_title: 'Ozbak — Lifelist',
    hero_intro: "Je suis Ozbak, un lifelister de Montréal (Anjou), au Québec. Je pêche du bord, presque toujours en remise à l'eau, et je note chaque espèce que je capture.",
    what_title: "C'est quoi, une lifelist ?",
    what_text: "Une lifelist, c'est la recherche de TOUS les poissons — micro ou monstre, toutes les tailles comptent — à condition de le prendre à la ligne. Chaque nouvelle espèce, une fois son identification confirmée, prend le prochain numéro de la liste, dans l'ordre de capture.",
    follow: 'Suivez-moi',
    qr_caption: 'Scanne pour voir ma lifelist',
    galleries: 'Galeries', latest_title: 'Dernières prises',
    prio_title: '★ Quêtes prioritaires', prio_add: '☆ Mettre en prioritaire', prio_remove: '★ Retirer des prioritaires',
    prio_full: 'Tu as déjà 5 quêtes prioritaires — retire-en une d\'abord.',
    stats: 'Statistiques',
    stat_year: 'Par année', stat_place: 'Par pays / lieu', stat_water: 'Eau douce vs eau salée', stat_family: 'Par famille',
    search_ph: 'Rechercher une espèce…',
    all_families: 'Toutes les familles', all_types: 'Tous types', all_countries: 'Tous les pays', all_places: 'Tous les lieux',
    sort_number: 'Tri : numéro', sort_name: 'Tri : nom', sort_family: 'Tri : famille',
    dir_desc: '↓ Décroissant', dir_asc: '↑ Croissant', priority: '★ Prioritaire',
    species: 'espèces', no_results: 'Aucune espèce ne correspond à votre recherche.',
    grid: 'Grille', list: 'Liste',
    identification: 'Identification', scientific: 'Nom scientifique', english: 'Nom anglais',
    french: 'Nom français', family: 'Famille', water_type: "Type d'eau", capture: 'Capture',
    date: 'Date', country: 'Pays', place: 'Lieu', notes: 'Notes', share: 'Partager', card_btn: 'Carte', card_title: 'Ta carte Instagram', download: 'Télécharger',
    inat: "Voir l'identification sur iNaturalist (autres photos)",
    quest: 'Quête', suggested_place: 'Lieu suggéré', when: 'Quand',
    gal_main_d: 'Ma collection principale d’espèces de poissons capturées.',
    gal_sub_d: 'Sous-espèces et variants que j’ai capturés.',
    gal_hyb_d: 'Hybrides que j’ai capturés.',
    gal_missing_d: 'Les poissons du Québec que je n’ai pas encore capturés.',
    transfer: 'Transférer (je l’ai pris !)',
    admin_title: 'Admin',
    login_title: 'Connexion admin',
    login_text: "Connecte-toi avec le compte Supabase du propriétaire de l'app. Seul un compte admin peut ajouter ou modifier des poissons — les visiteurs ne font que consulter le site public. Le contrôle des données se trouve seulement dans le panneau admin, pour que personne à qui tu montres l'app puisse l'activer.",
    email: 'Courriel', password: 'Mot de passe', sign_in: 'Se connecter', sign_out: 'Se déconnecter', signed_in_as: 'Connecté :',
    login_failed: 'Échec de connexion — vérifie le courriel et le mot de passe.',
    not_admin: "Ce compte n'est pas un compte admin pour cette app.",
    sync_status: 'État de la synchro', synchronized: 'Synchronisé', pending_sync: 'En attente', sync_offline: 'Hors ligne',
    data_control: 'Contrôle des données (synchro)', sync_blocked: 'Synchro bloquée', sync_wifi: 'Wi-Fi seulement', sync_both: 'Wi-Fi + données mobiles',
    sync_now: 'Synchroniser', backup_btn: '⬇ Sauvegarde complète (ZIP : données + photos)', backup_running: 'Préparation de la sauvegarde…',
    bio_lock_title: 'Admin verrouillé', bio_lock_text: "Cet appareil demande ton empreinte avant d'ouvrir l'Admin — personne d'autre ne peut toucher à ta lifelist.",
    bio_unlock_btn: "Déverrouiller avec l'empreinte", bio_fallback: "Problème d'empreinte ? Désactive le verrou avec ton mot de passe", bio_disable_pw: "Désactiver le verrou par empreinte",
    bio_failed: "Vérification d'empreinte échouée — réessaie, ou utilise l'option mot de passe ci-dessous.", bio_panel_title: 'Verrou par empreinte (cet appareil)',
    bio_on_text: "ACTIVÉ — cet appareil demandera ton empreinte avant d'ouvrir l'Admin. Ton mot de passe reste la solution de secours.", bio_turn_off: "Désactiver le verrou par empreinte",
    bio_off_text: "DÉSACTIVÉ — active-le pour exiger ton empreinte avant qu'on puisse ouvrir l'Admin sur cet appareil. Ton compte par mot de passe reste la vraie clé.", bio_turn_on: "Activer le verrou par empreinte",
    bio_unavailable: "Aucun déverrouillage par empreinte / visage disponible dans ce navigateur sur cet appareil.",
    sync_error: "Problème de synchro : le dernier changement n'a pas pu être envoyé. Il reste enregistré sur cet appareil et sera réessayé.",
    sync_done_msg: 'Synchro terminée — la copie du site est maintenant à jour.',
    sync_queued_msg: "Enregistré sur cet appareil — la synchro se fera quand la connexion, le compte admin et le contrôle des données le permettront.",
    add_title: 'Ajouter un poisson', edit_title: 'Modifier un poisson',
    f_gallery: 'Galerie', f_status: 'Ajouter comme', st_pending: 'En attente de confirmation (pas encore de numéro)', st_caught: 'Confirmé (reçoit le prochain numéro)',
    f_en: 'Nom anglais', f_fr: 'Nom français', f_sci: 'Nom scientifique', f_family: 'Famille',
    f_water: "Type d'eau", f_date: 'Date de capture', f_country: 'Pays', f_place: 'Lieu (province / État / région)',
    f_notes: 'Notes', f_inat: 'Lien iNaturalist (optionnel)', f_photo: 'Photo — choisir dans la galerie du téléphone',
    crop_hint: "Recadrage : déplace la photo, utilise le zoom, puis Appliquer. L'original du téléphone n'est jamais touché.",
    apply_crop: 'Appliquer le recadrage', skip_crop: 'Garder la photo entière', photo_ready: 'Photo prête ✓',
    save: 'Enregistrer', cancel_edit: 'Annuler la modification', edit_existing: 'Modifier un poisson existant',
    choose_fish: 'Choisir un poisson…', f_num: "Numéro (#) — à changer SEULEMENT pour corriger une erreur d'ordre de validation : le poisson s'insère là et les numéros plus élevés montent d'une coche",
    dup_title: 'Alerte doublon', dup_msg: 'Ce nom scientifique existe déjà dans ta liste : ',
    dup_ask: 'Enregistrer quand même ?', pending_title: 'En attente de confirmation',
    pending_empty: "Rien en attente. Les nouvelles prises ajoutées « en attente » resteront ici, sans numéro et non publiées, jusqu'à confirmation de l'identification.",
    confirm_btn: 'Confirmer (donner le prochain #)', delete_btn: 'Supprimer',
    saved_pending: "Enregistré en attente — pas de numéro, non publié, jusqu'à confirmation.",
    saved_caught: 'Enregistré et publié avec le #', transferred: 'Transféré ! Il a quitté les Manquants QC.',
    updated: 'Poisson mis à jour.',
    del_btn: 'Effacer ce poisson', del_intro: 'Tu es sur le point d’effacer définitivement :',
    del_consequence: "Il sera retiré de l'app et du site public. Les autres poissons gardent leurs numéros. C'est impossible à annuler.",
    del_type_label: 'Tape le numéro du poisson pour confirmer', del_final: 'Effacer définitivement', del_cancel: 'Annuler',
    deleted_msg: 'Poisson effacé.',
    data_source: 'Source des données', source_live: 'Supabase — données en direct', source_cache: "Copie enregistrée sur cet appareil (données en direct injoignables)",
    source_bundled: "Copie intégrée à l'app (données en direct injoignables)", refresh_btn: 'Recharger les données depuis Supabase',
    missing_admin_note: 'Admin déverrouillé : tu peux transférer une espèce manquante que tu as prise depuis la galerie Manquants QC.',
    home_admin_note: 'Admin : ajouter un poisson à ma lifelist',
    required: 'Les noms anglais, français et scientifique sont obligatoires.'
  }
};
const t = (k) => (T[lang] && T[lang][k]) || T.en[k] || k;

/* ---------------- helpers ---------------- */
const $ = (sel, el) => (el || document).querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isDataUrl = (s) => typeof s === 'string' && s.indexOf('data:') === 0;
function dataURLtoBlob(dataUrl) {
  const parts = String(dataUrl).split(',');
  const mime = ((parts[0] || '').match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(parts[1] || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
/* Legacy merged location, still read by the Lovable site: compose it from
   the separated country/place on every write, never drop it. */
function composeLocation(country, place) {
  const c = country === 'États-Unis' ? 'Usa' : (country || '');
  const p = place === 'Québec' ? 'Quebec' : (place || '');
  if (!c && !p) return '';
  return p ? c + ' (' + p + ')' : c;
}
/* Inverse of composeLocation — only a fallback for rows missing country/place. */
function parseLocation(loc) {
  const m = /^\s*(.*?)\s*\((.*)\)\s*$/.exec(loc || '');
  if (!m) return { country: '', place: '' };
  return { country: m[1] === 'Usa' ? 'États-Unis' : m[1], place: m[2] === 'Quebec' ? 'Québec' : m[2] };
}
const primaryName = (f) => (lang === 'fr' ? (f.name_fr || f.name_en) : (f.name_en || f.name_fr)) || f.scientific || '';
const secondaryName = (f) => (lang === 'fr' ? (f.name_en || '') : (f.name_fr || ''));
const placeLabel = (f) => [f.country, f.place].filter(Boolean).join(' · ') || (f.country || f.place || '');
const nextNum = (gallery) => state.fish.filter((f) => f.gallery === gallery && f.status === 'caught').reduce((m, f) => Math.max(m, f.num || 0), 0) + 1;

/* ---------------- Supabase client (REST + Auth, no SDK) ---------------- */
let session = null;        // {access_token, refresh_token, expires_at, user_id, email}
let adminVerified = false;
let loginError = '';       // i18n key of the last login problem ('' = none)
let syncing = false;
try { const rawS = localStorage.getItem(SESSION_KEY); if (rawS) session = JSON.parse(rawS); } catch (e) {}
function saveSession() {
  try { if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session)); else localStorage.removeItem(SESSION_KEY); } catch (e) {}
}
function sbHeaders(token) {
  return { apikey: SB_ANON, Authorization: 'Bearer ' + (token || SB_ANON), 'Content-Type': 'application/json' };
}
function fetchT(url, opts, ms) {
  opts = opts || {};
  let ctrl = null;
  if (typeof AbortController !== 'undefined') { ctrl = new AbortController(); opts.signal = ctrl.signal; }
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, ms || 10000);
  return fetch(url, opts).finally(() => clearTimeout(timer));
}
async function sbGet(path, token) {
  const r = await fetchT(SB_URL + path, { headers: sbHeaders(token) }, 9000);
  if (!r.ok) throw new Error('Supabase GET ' + r.status);
  return r.json();
}

/* ----- row mapping: Supabase -> app fish model ----- */
function mapSpeciesRow(r) {
  const gallery = (r.category === 'hybrid' || r.category === 'hybrids') ? 'hybrids' : (r.category || 'main');
  const water = r.water_type ? (r.water_type.charAt(0).toUpperCase() + r.water_type.slice(1)) : '';
  let country = r.country || '', place = r.place || '';
  if (!country && !place && r.location) { const p = parseLocation(r.location); country = p.country; place = p.place; }
  return {
    id: 'db-' + r.id, dbId: r.id, num: r.capture_number != null ? r.capture_number : null, quest: null,
    gallery, category: gallery === 'subspecies' ? 'Variant' : water, water: water || 'Freshwater',
    name_en: r.english_name || '', name_fr: r.french_name || '', scientific: r.scientific_name || '',
    family: r.family || '', date: r.capture_date || '', country, place,
    notes: r.notes || '', photo: r.image_url || null, inaturalist: r.inaturalist_url || '',
    status: 'caught', suggested_place: '', when: ''
  };
}
function mapMissingRow(r) {
  const m = /^\[([^\]]+)\]\s*/.exec(r.french_name || '');
  return {
    id: 'dbm-' + r.id, dbId: r.id, num: null, quest: m ? m[1] : '', gallery: 'missing', category: '', water: '',
    name_en: r.english_name || '', name_fr: m ? String(r.french_name).slice(m[0].length) : (r.french_name || ''),
    scientific: r.scientific_name || '', family: r.family || '', date: '', country: '', place: '',
    notes: '', photo: r.image_url || null, inaturalist: '', status: 'missing', priority: !!r.is_priority,
    suggested_place: '', when: ''
  };
}
async function fetchLiveDataset() {
  const species = await sbGet('/rest/v1/species?select=*');
  const missing = await sbGet('/rest/v1/missing_species?select=*');
  return { fish: species.map(mapSpeciesRow).concat(missing.map(mapMissingRow)) };
}

/* ----- auth (Supabase Auth, email + password) ----- */
async function sbSignIn(email, password) {
  loginError = '';
  try {
    const r = await fetchT(SB_URL + '/auth/v1/token?grant_type=password',
      { method: 'POST', headers: sbHeaders(), body: JSON.stringify({ email, password }) }, 12000);
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || !data.access_token) { loginError = 'login_failed'; return false; }
    session = {
      access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user_id: data.user && data.user.id, email: data.user && data.user.email
    };
    saveSession();
    if (!(await sbCheckAdmin())) { sbSignOut(); loginError = 'not_admin'; return false; }
    return true;
  } catch (e) { loginError = 'login_failed'; return false; }
}
async function sbCheckAdmin() {
  adminVerified = false;
  if (session) {
    try {
      const rows = await sbGet('/rest/v1/user_roles?select=role&user_id=eq.' + encodeURIComponent(session.user_id), session.access_token);
      adminVerified = Array.isArray(rows) && rows.some((x) => x.role === 'admin');
    } catch (e) { adminVerified = false; }
  }
  adminUnlocked = adminVerified;
  return adminVerified;
}
async function sbRefreshToken() {
  if (!session || !session.refresh_token) return false;
  try {
    const r = await fetchT(SB_URL + '/auth/v1/token?grant_type=refresh_token',
      { method: 'POST', headers: sbHeaders(), body: JSON.stringify({ refresh_token: session.refresh_token }) }, 12000);
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || !data.access_token) return false;
    session.access_token = data.access_token;
    if (data.refresh_token) session.refresh_token = data.refresh_token;
    session.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
    saveSession();
    return true;
  } catch (e) { return false; }
}
async function sbEnsureToken() {
  if (!session) return false;
  if (session.expires_at && session.expires_at - Date.now() > 60000) return true;
  if (await sbRefreshToken()) return true;
  sbSignOut();
  return false;
}
function sbSignOut() { session = null; adminVerified = false; adminUnlocked = false; saveSession(); bioClearUnlocked(); }
async function restoreSession() {
  if (!session) return;
  const was = adminUnlocked;
  if (await sbEnsureToken()) await sbCheckAdmin();
  if (adminUnlocked !== was) render();
  if (adminUnlocked) processOutbox(false);
}

/* ----- writes (admin JWT) ----- */
/* Local calendar day as YYYY-MM-DD, from the device's own clock
   (getFullYear/getMonth/getDate with zero-padding — NOT toISOString(),
   which is UTC and can be off by a day in the evening). */
function todayLocalISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function speciesPayload(f) {
  const water = String(f.water || (f.category === 'Variant' ? 'Freshwater' : f.category) || 'Freshwater').toLowerCase();
  return {
    scientific_name: f.scientific, english_name: f.name_en, french_name: f.name_fr,
    family: f.family || null, water_type: water,
    category: f.gallery === 'hybrids' ? 'hybrid' : (f.gallery || 'main'),
    capture_number: f.num != null ? f.num : null,
    /* capture_date is NOT NULL in Supabase (Lovable schema): sending null
       is rejected (400 / SQLSTATE 23502) and the outbox op would retry
       forever. An empty form date therefore falls back to the
       publication day — the owner's rule — while an existing date is
       never overwritten. This payload builder is the single choke point
       for both INSERT and PATCH, so the fallback covers every write. */
    capture_date: f.date || todayLocalISO(),
    location: composeLocation(f.country, f.place),
    country: f.country || null, place: f.place || null,
    notes: f.notes || null,
    image_url: f.photo && !isDataUrl(f.photo) ? f.photo : null,
    inaturalist_url: f.inaturalist || null
  };
}
async function sbWrite(method, path, body, prefer) {
  if (!(await sbEnsureToken())) throw new Error('not signed in');
  const headers = sbHeaders(session.access_token);
  if (prefer) headers.Prefer = prefer;
  const r = await fetchT(SB_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined }, 20000);
  if (!r.ok) throw new Error('Supabase write ' + r.status);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}
async function uploadPhoto(dataUrl) {
  if (!(await sbEnsureToken())) throw new Error('not signed in');
  const blob = dataURLtoBlob(dataUrl);
  const name = Date.now() + '-' + Math.random().toString(36).slice(2, 10) + '.jpg';
  const r = await fetchT(SB_URL + '/storage/v1/object/species-images/' + name,
    { method: 'POST', headers: { apikey: SB_ANON, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'image/jpeg' }, body: blob }, 30000);
  if (!r.ok) throw new Error('photo upload ' + r.status);
  return SB_URL + '/storage/v1/object/public/species-images/' + name;
}

/* ----- offline outbox + sync runner ----- */
function queueOp(op) { state.outbox.push(op); saveState(); processOutbox(false); }
function queueInsert(localFish, opts) {
  opts = opts || {};
  const snap = Object.assign({}, localFish);
  const photoDataUrl = isDataUrl(snap.photo) ? snap.photo : null;
  if (photoDataUrl) snap.photo = null;
  queueOp({ kind: 'insert', localId: localFish.id, fish: snap, photoDataUrl, transferDbId: opts.transferDbId || null, insertedDbId: null });
}
function queueUpdate(fish, snap, photoDataUrl, shiftOps) {
  (shiftOps || []).forEach((op) => state.outbox.push(op));
  const queued = state.outbox.find((o) => o.kind === 'insert' && o.localId === fish.id);
  if (queued) { // not in Supabase yet: fold the edit into its pending insert
    Object.assign(queued.fish, snap);
    if (photoDataUrl) { queued.photoDataUrl = photoDataUrl; queued.fish.photo = null; }
  } else if (fish.dbId) {
    state.outbox.push({ kind: 'update', dbId: fish.dbId, fish: snap, photoDataUrl: photoDataUrl || null });
  }
  saveState();
  processOutbox(false);
}
/* ----- protected delete (caught fish) ----- */
/* Anti-misclick safety: the admin must type the fish's exact capture
   number to arm the final delete button — two deliberate steps, and no
   native confirm() anywhere. Pure helper so it stays unit-testable. */
function deleteCodeMatches(fish, typed) {
  if (!fish || fish.num == null) return false;
  return String(typed == null ? '' : typed).trim() === String(fish.num).trim();
}
/* Photo file name inside the species-images bucket, derived from its
   public URL (null when the photo does not point at that bucket). */
function storageFileNameFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const marker = '/storage/v1/object/public/species-images/';
  const i = url.indexOf(marker);
  if (i < 0) return null;
  const name = decodeURIComponent(url.slice(i + marker.length).split('?')[0].split('#')[0]).trim();
  return name || null;
}
function deleteCaughtFish(f) {
  state.fish = state.fish.filter((x) => x.id !== f.id);
  if (f.dbId) {
    /* Numbers are NOT renumbered: the other fish keep theirs. If the
       deleted fish held the highest number of its gallery, nextNum()
       (max + 1) may hand that number to the next catch — intended. */
    queueOp({ kind: 'delete', dbId: f.dbId, photoFile: storageFileNameFromUrl(f.photo) });
  } else {
    /* Local-only fish (never synced — its insert is still queued): drop
       the queued op(s) for it and forget it locally. No server call
       exists to make. */
    state.outbox = state.outbox.filter((o) => o.localId !== f.id);
    saveState();
  }
}
async function executeOp(op) {
  /* Invariant: a photo-bearing op is never degraded into a photo-less
     write. uploadPhoto() must succeed BEFORE any species POST/PATCH runs;
     if it throws, processOutbox leaves the op queued (photo intact) and
     records a visible sync error instead of silently dropping the photo. */
  if (op.kind === 'insert') {
    if (!op.insertedDbId) {
      const f = Object.assign({}, op.fish);
      if (op.photoDataUrl) f.photo = await uploadPhoto(op.photoDataUrl);
      const rows = await sbWrite('POST', '/rest/v1/species', speciesPayload(f), 'return=representation');
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row && row.id) {
        op.insertedDbId = row.id;
        const local = state.fish.find((x) => x.id === op.localId);
        if (local) { local.dbId = row.id; local.id = 'db-' + row.id; if (row.image_url) local.photo = row.image_url; }
        saveState(); // remember the insert succeeded before the transfer delete runs
      }
    }
    if (op.transferDbId) await sbWrite('DELETE', '/rest/v1/missing_species?id=eq.' + op.transferDbId, null);
  } else if (op.kind === 'update') {
    const f = Object.assign({}, op.fish);
    if (op.photoDataUrl) f.photo = await uploadPhoto(op.photoDataUrl);
    await sbWrite('PATCH', '/rest/v1/species?id=eq.' + op.dbId, speciesPayload(f));
  } else if (op.kind === 'priority') {
    await sbWrite('PATCH', '/rest/v1/missing_species?id=eq.' + op.dbId, { is_priority: op.value });
  } else if (op.kind === 'patchNum') {
    await sbWrite('PATCH', '/rest/v1/species?id=eq.' + op.dbId, { capture_number: op.num });
  } else if (op.kind === 'delete') {
    /* The species row is the source of truth: if this DELETE fails, the
       throw leaves the op queued and surfaces a sync error (the photo
       cleanup below is then never attempted). */
    await sbWrite('DELETE', '/rest/v1/species?id=eq.' + op.dbId, null);
    if (op.photoFile) {
      /* Best-effort photo cleanup, only after the row is gone. Any
         failure is swallowed on purpose: an orphaned image file harms
         nothing, and it must never fail the op or raise a sync error. */
      try {
        if (await sbEnsureToken()) {
          await fetchT(SB_URL + '/storage/v1/object/species-images',
            { method: 'DELETE', headers: sbHeaders(session.access_token), body: JSON.stringify({ prefixes: [op.photoFile] }) }, 20000);
        }
      } catch (e) { /* orphaned photo file: harmless */ }
    }
  }
}
function mayAutoSync() {
  if (!session || !adminVerified) return false;
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return false;
  if (state.syncMode === 'blocked') return false;
  if (state.syncMode === 'wifi') {
    const c = (typeof navigator !== 'undefined' && navigator) ? navigator.connection : null;
    if (c && c.type === 'cellular') return false; // known cellular: wait for Wi-Fi
  }
  return true; // 'both' (Wi-Fi + mobile), or Wi-Fi mode with an unknown connection (desktop/Firefox)
}
async function processOutbox(force) {
  if (syncing || !state || !state.outbox || !state.outbox.length) return;
  if (!session || !adminVerified) return;
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return;
  if (!force && !mayAutoSync()) return;
  syncing = true;
  let didWork = false;
  let syncFailed = false;
  while (state.outbox.length) {
    const op = state.outbox[0];
    try { await executeOp(op); state.outbox.shift(); didWork = true; saveState(); }
    catch (e) {
      /* No silent failures: the op stays queued (photo intact) and the
         problem becomes visible in the Admin panel until a full drain. */
      syncFailed = true;
      state.syncError = { message: e && e.message ? String(e.message) : String(e || 'Unknown error'), at: Date.now() };
      saveState();
      break; // leave the rest queued for the next opportunity
    }
  }
  syncing = false;
  if (!syncFailed && !state.outbox.length && state.syncError) { state.syncError = null; saveState(); }
  if (didWork) { try { await refreshDataset(); } catch (e) {} saveState(); }
  if (route.name === 'admin') render();
}
async function refreshDataset() {
  const live = await fetchLiveDataset();
  const unsynced = state.fish.filter((f) => f.status === 'caught' && !f.dbId && String(f.id).indexOf('local-') === 0);
  /* A fish whose deletion is still queued must not resurrect from the
     live copy while its delete waits to sync. */
  const pendingDeletes = new Set(state.outbox.filter((o) => o.kind === 'delete').map((o) => o.dbId));
  state.fish = live.fish.filter((f) => !pendingDeletes.has(f.dbId)).concat(unsynced);
  state.dataSource = 'live';
}

/* ---------------- state ----------------
   state = { fish, pending, outbox, syncMode, dataSource, syncError }
   - fish: last-good dataset (live Supabase when reachable, else the saved
     copy, else the bundled data.json seed) + locally added unsynced fish.
   - pending: S10 pending-confirmation catches — LOCAL-ONLY, never sent
     to Supabase until the owner confirms them.
   - outbox: confirmed writes waiting for sync (persisted).
   - syncError: {message, at} of the last failed sync/save, shown in the
     Admin panel; cleared by the next fully successful outbox drain. */
function seedFromData(data) {
  const fish = [];
  const push = (arr, gallery) => (arr || []).forEach((x, i) => fish.push({
    id: gallery + '-' + i + '-' + slug(x.scientific), dbId: null, num: x.num ? parseInt(x.num, 10) : null,
    quest: null, gallery, category: x.category || '', water: x.category && x.category !== 'Variant' ? x.category : 'Freshwater',
    name_en: x.name_en || '', name_fr: x.name_fr || '',
    scientific: x.scientific || '', family: x.family || '', date: x.date || '', country: x.country || '',
    place: x.place || '', notes: x.notes || '', photo: x.photo || null, inaturalist: x.inaturalist || '',
    status: 'caught', suggested_place: '', when: ''
  }));
  push(data.main, 'main'); push(data.subspecies, 'subspecies'); push(data.hybrids, 'hybrids');
  (data.missing_qc || []).forEach((x, i) => fish.push({
    id: 'missing-' + i + '-' + slug(x.scientific), dbId: null, num: null, quest: x.quest_num || '',
    gallery: 'missing', category: '', water: '', name_en: x.name_en || '', name_fr: x.name_fr || '',
    scientific: x.scientific || '', family: x.family || '', date: '', country: '', place: '',
    notes: x.notes || '', photo: x.photo || null, inaturalist: '', status: 'missing', priority: !!x.priority,
    suggested_place: x.suggested_place || '', when: x.when || ''
  }));
  return { fish };
}
function saveState() {
  if (!state) return;
  const payload = (fish) => JSON.stringify({ fish, pending: state.pending, outbox: state.outbox, syncMode: state.syncMode, syncError: state.syncError || null });
  try { localStorage.setItem(LS_KEY, payload(state.fish)); return; } catch (e) { /* fall through to the trimmed retry */ }
  /* Trimmed retry: pending catches and outbox ops (with their photos) are
     essential and are kept whole; only the re-fetchable dataset cache is
     reduced to the fish that exist nowhere else yet (unsynced local
     catches). Synced fish come back from Supabase / the bundled seed. */
  const unsynced = (state.fish || []).filter((f) => f && f.status === 'caught' && !f.dbId && String(f.id || '').indexOf('local-') === 0);
  try { localStorage.setItem(LS_KEY, payload(unsynced)); return; } catch (e) {
    /* Even the trimmed save failed: keep the warning visible in memory —
       the on-device copy of pending/outbox work is at risk. (Not saved
       via saveState() again: that is what just failed.) */
    state.syncError = { message: 'On-device save failed: ' + (e && e.message ? String(e.message) : String(e || 'storage unavailable')), at: Date.now() };
  }
}
async function initApp() {
  if (typeof window !== 'undefined' && window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
    try { bioAvailable = !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { bioAvailable = false; }
  }
  let stored = null;
  try { const raw = localStorage.getItem(LS_KEY); if (raw) stored = JSON.parse(raw); } catch (e) {}
  if (stored && Array.isArray(stored.fish)) {
    state = { fish: stored.fish, pending: stored.pending || [], outbox: stored.outbox || [], syncMode: stored.syncMode || 'wifi', dataSource: 'cache', syncError: stored.syncError || null };
  } else {
    let mode = 'wifi';
    try { const v1 = JSON.parse(localStorage.getItem('ozbakAppV1') || 'null'); if (v1 && v1.syncMode) mode = v1.syncMode; } catch (e) {}
    state = { fish: [], pending: [], outbox: [], syncMode: mode, dataSource: 'bundled', syncError: null };
    try {
      const data = await (await fetch('data.json')).json();
      state.fish = seedFromData(data).fish;
    } catch (e) { /* no bundled data reachable: galleries stay empty until live works */ }
  }
  saveState();
  try { await refreshDataset(); saveState(); } catch (e) { /* offline: keep cache/bundled */ }
  render();
  const m = location.hash.match(/fish=([^&]+)/);
  if (m) openPopup(decodeURIComponent(m[1]));
  restoreSession();
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', () => processOutbox(false));
}
const caught = (gallery) => state.fish.filter((f) => f.gallery === gallery && f.status === 'caught');
const missingAll = () => state.fish.filter((f) => f.gallery === 'missing' && f.status === 'missing');

/* ---------------- rendering ---------------- */
function setActiveNav() {
  document.querySelectorAll('.mainnav a').forEach((a) => {
    const n = a.getAttribute('data-nav');
    const active = (route.name === 'home' && n === 'home') || (route.name === 'gallery' && n === route.gallery) || (route.name === 'admin' && n === 'admin');
    a.classList.toggle('active', !!active);
  });
  $('#langToggle').textContent = lang === 'en' ? 'FR' : 'EN';
}
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
  document.documentElement.lang = lang;
}
function updateAdminBadge() {
  const b = document.getElementById('adminBadge');
  if (!b) return;
  const n = state ? (state.pending.length + state.outbox.length) : 0;
  b.hidden = n === 0;
  b.textContent = n > 0 ? String(n) : '';
}
function render() {
  stopCarousels();
  applyStaticI18n(); setActiveNav(); updateAdminBadge();
  const v = $('#view');
  if (route.name === 'home') { v.innerHTML = homeHTML(); v.querySelectorAll('[data-fish]').forEach((el) => el.addEventListener('click', () => openPopup(el.getAttribute('data-fish')))); initCarousels(v); }
  else if (route.name === 'gallery') { v.innerHTML = galleryHTML(route.gallery); wireGallery(route.gallery); }
  else if (route.name === 'admin') { v.innerHTML = adminHTML(); wireAdmin(); }
  window.scrollTo(0, 0);
}
function go(r) { route = r; render(); $('#mainnav').classList.remove('open'); }

/* ----- home ----- */
function statBox(title, groups) {
  const total = groups.reduce((s, g) => s + g.n, 0) || 1;
  const rows = groups.map((g) => {
    const pct = Math.round((g.n / total) * 1000) / 10;
    return '<div class="stat-row"><div class="lbl"><span>' + esc(g.label) + '</span><b>' + g.n + ' — ' + pct + '%</b></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
  }).join('');
  return '<div class="stat-box"><h3>' + esc(title) + '</h3>' + rows + '</div>';
}
function statsHTML() {
  const all = state.fish.filter((f) => f.status === 'caught');
  const group = (keyFn) => {
    const m = new Map();
    all.forEach((f) => { const k = keyFn(f); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  };
  return '<div class="stats-grid">' +
    statBox(t('stat_year'), group((f) => (f.date || '').slice(0, 4))) +
    statBox(t('stat_place'), group((f) => placeLabel(f))) +
    statBox(t('stat_water'), group((f) => (f.category === 'Freshwater' || f.category === 'Saltwater') ? f.category : '')) +
    statBox(t('stat_family'), group((f) => f.family)) + '</div>';
}
/* ----- home carousels: slow continuous loop, manual drag, tap = fiche ----- */
let carouselCleanups = [];
function stopCarousels() { carouselCleanups.forEach((fn) => { try { fn(); } catch (e) {} }); carouselCleanups = []; }
function carCardHTML(f) {
  const badge = f.status === 'missing' ? ('★ #' + esc(f.quest)) : ('#' + f.num);
  const sub = f.status === 'missing' ? f.scientific : (f.date || '');
  return '<button class="car-card" data-fish="' + f.id + '"><span class="car-ph">' + photoHTML(f) + '<span class="badge">' + badge + '</span></span>' +
    '<span class="car-body"><span class="primary">' + esc(primaryName(f)) + '</span><span class="car-sub">' + esc(sub || '') + '</span></span></button>';
}
function carouselHTML(cardsHtml) {
  const set = '<div class="car-set">' + cardsHtml + '</div>';
  return '<div class="carousel"><div class="car-track">' + set + set + set + '</div></div>';
}
/* Transform-driven strip (v2): the track is moved directly, so the loop is
   truly endless, the drag works the same with mouse and touch, and the
   auto-scroll always resumes 3 s after the pointer is released. The v1
   native-scroll version hit the container's end after 2-3 loops, never
   resumed after touch (pointercancel), and could not be mouse-dragged. */
function initCarousels(root) {
  stopCarousels();
  root.querySelectorAll('.carousel').forEach((el) => {
    const track = el.querySelector('.car-track'); if (!track) return;
    const set = track.querySelector('.car-set'); if (!set) return;
    const copyW = set.offsetWidth; if (!copyW) return;
    let off = -copyW, raf = 0, last = 0, dragging = false, resumeAt = 0, startX = 0, startOff = 0, moved = false;
    const apply = () => { track.style.transform = 'translateX(' + off + 'px)'; };
    const norm = () => { off = -((((-off) % copyW) + copyW) % copyW); };
    apply();
    const step = (ts) => {
      raf = requestAnimationFrame(step);
      if (!last) last = ts;
      const dt = Math.min(64, ts - last); last = ts;
      if (dragging || document.hidden) return;
      if (resumeAt && ts < resumeAt) return;
      off += 0.024 * dt; /* ~24 px/s, content drifts left -> right */
      if (off >= 0) off -= copyW;
      apply();
    };
    raf = requestAnimationFrame(step);
    el.addEventListener('pointerdown', (e) => {
      dragging = true; moved = false; startX = e.clientX; startOff = off;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 8) moved = true;
      off = startOff + dx; norm(); apply();
    });
    const end = () => { if (dragging) { dragging = false; resumeAt = performance.now() + 3000; } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    carouselCleanups.push(() => cancelAnimationFrame(raf));
  });
}
/* ----- priority quests: the owner's star toggle (admin, option B) ----- */
function togglePriority(f) {
  const val = !f.priority;
  if (val && state.fish.filter((x) => x.status === 'missing' && x.priority).length >= 5) { alert(t('prio_full')); return; }
  f.priority = val;
  state.outbox.push({ kind: 'priority', dbId: f.dbId, value: val });
  saveState(); updateAdminBadge(); processOutbox(false);
  closePopup(); render();
}
function homeHTML() {
  const cM = caught('main').length, cS = caught('subspecies').length, cH = caught('hybrids').length, cQ = missingAll().length;
  const latest = state.fish.filter((f) => f.status === 'caught').slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || ((b.num || 0) - (a.num || 0))).slice(0, 5);
  const prios = missingAll().filter((f) => f.priority)
    .sort((a, b) => (parseInt(a.quest, 10) || 999) - (parseInt(b.quest, 10) || 999));
  return '<section class="hero"><img class="logo" src="ozbak-logo.png" alt="Ozbak logo">' +
    '<h1>' + esc(t('hero_title')) + '</h1><p>' + esc(t('hero_intro')) + '</p>' +
    '<div class="pills">' +
    '<a class="pill" href="#" data-go="main">' + cM + ' Main species</a>' +
    '<a class="pill" href="#" data-go="subspecies">' + cS + ' Subspecies and variants</a>' +
    '<a class="pill" href="#" data-go="hybrids">' + cH + ' Hybrids</a>' +
    '<a class="pill secondary" href="#" data-go="missing">' + cQ + ' Missing QC</a></div>' +
    '<div class="socials"><span style="align-self:center;font-weight:700;color:var(--blue)">' + esc(t('follow')) + ' :</span>' +
    '<a href="https://www.youtube.com/@Ozbak-fishing" target="_blank" rel="noopener">YouTube</a><a href="https://www.instagram.com/ozbak.fishing/" target="_blank" rel="noopener">Instagram</a><a href="https://www.inaturalist.org/people/6703182" target="_blank" rel="noopener">iNaturalist</a></div>' +
    '<div class="qr-block"><button type="button" class="qr-btn" data-qr aria-label="QR code — https://ozbak-fishing.github.io/"><img src="qr-site.svg" alt="QR code — https://ozbak-fishing.github.io/"></button>' +
    '<p class="qr-caption">' + esc(t('qr_caption')) + '</p>' +
    '<p class="qr-url">https://ozbak-fishing.github.io/</p></div></section>' +
    '<section class="section"><h2>' + esc(t('what_title')) + '</h2><p class="lead">' + esc(t('what_text')) + '</p></section>' +
    '<section class="section"><h2>' + esc(t('latest_title')) + '</h2>' +
    carouselHTML(latest.map((f) => carCardHTML(f)).join('')) + '</section>' +
    (prios.length ? '<section class="section"><h2>' + esc(t('prio_title')) + '</h2>' +
      carouselHTML(prios.map((f) => carCardHTML(f)).join('')) + '</section>' : '') +
    '<section class="section"><h2>' + esc(t('stats')) + '</h2>' + statsHTML() + '</section>';
}

/* ----- gallery ----- */
const GAL_TITLE = { main: 'nav_main', subspecies: 'nav_sub', hybrids: 'nav_hyb', missing: 'nav_missing' };
const GAL_DESC = { main: 'gal_main_d', subspecies: 'gal_sub_d', hybrids: 'gal_hyb_d', missing: 'gal_missing_d' };
let galFilters = { q: '', family: '', type: '', country: '', place: '', sort: 'number', dir: 'desc' };
function galleryItems(gallery) {
  return gallery === 'missing' ? missingAll() : caught(gallery);
}
function galleryHTML(gallery) {
  const items = galleryItems(gallery);
  const fams = [...new Set(items.map((f) => f.family).filter(Boolean))].sort();
  const types = [...new Set(items.map((f) => f.category).filter(Boolean))].sort();
  const countries = [...new Set(items.map((f) => f.country).filter(Boolean))].sort();
  const places = [...new Set(items.filter((f) => !galFilters.country || f.country === galFilters.country).map((f) => f.place).filter(Boolean))].sort();
  const opt = (vals, allLabel) => '<option value="">' + esc(allLabel) + '</option>' + vals.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
  return '<div class="gal-head"><h1>' + esc(t(GAL_TITLE[gallery])) + '</h1><p>' + esc(t(GAL_DESC[gallery])) + '</p></div>' +
    (gallery === 'missing' && adminUnlocked ? '<div class="ok">' + esc(t('missing_admin_note')) + '</div>' : '') +
    '<div class="toolbar"><input type="search" id="gq" placeholder="' + esc(t('search_ph')) + '" value="' + esc(galFilters.q) + '">' +
    '<div class="row"><select id="gfam">' + opt(fams, t('all_families')) + '</select>' +
    '<select id="gtype">' + opt(types, t('all_types')) + '</select>' +
    '<select id="gcountry">' + opt(countries, t('all_countries')) + '</select>' +
    '<select id="gplace">' + opt(places, t('all_places')) + '</select>' +
    '<select id="gsort"><option value="number">' + esc(t('sort_number')) + '</option><option value="name">' + esc(t('sort_name')) + '</option><option value="family">' + esc(t('sort_family')) + '</option></select>' +
    '<button id="gdir" type="button"></button></div>' +
    '<div class="meta"><span class="count" id="gcount"></span>' +
    '<span class="viewtoggle"><button id="vgrid" class="' + (viewMode === 'grid' ? 'on' : '') + '">▦ ' + esc(t('grid')) + '</button>' +
    '<button id="vlist" class="' + (viewMode === 'list' ? 'on' : '') + '">☰ ' + esc(t('list')) + '</button></span></div></div>' +
    '<div id="gresults"></div>';
}
/* Places available in a gallery, limited to one country when one is
   selected (all distinct places when no country is selected). */
function placeOptionsFor(gallery, country) {
  return [...new Set(galleryItems(gallery).filter((f) => !country || f.country === country).map((f) => f.place).filter(Boolean))].sort();
}
/* ---------- Full backup: one ZIP holding every fish/quest record plus
   every photo file (STORE method, no compression library needed — the
   photos are JPEGs, already compressed). The Supabase free project has
   no automatic backups, so this file IS the owner's safety net: the
   JSON restores the data, the folders restore the images. ---------- */
const CRC_TABLE = (() => { const tb = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); tb[n] = c >>> 0; } return tb; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(); const chunks = []; const central = []; let offset = 0;
  files.forEach((f) => {
    const name = enc.encode(f.name); const crc = crc32(f.data); const size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  });
  const cdStart = offset; let cdSize = 0; central.forEach((c) => { cdSize += c.length; });
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true);
  eo.setUint32(12, cdSize, true); eo.setUint32(16, cdStart, true);
  return new Blob(chunks.concat(central, [new Uint8Array(eo.buffer)]), { type: 'application/zip' });
}
function zipFileName(url) { const p = String(url).split('/'); return p[p.length - 1] || 'photo.jpg'; }
async function doBackup(btn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = t('backup_running');
  try {
    const files = [{ name: 'ozbak-data.json', data: new TextEncoder().encode(JSON.stringify({ exported_at: new Date().toISOString(), fish: state.fish, pending: state.pending }, null, 2)) }];
    const urls = new Map();
    state.fish.forEach((f) => { if (f.photo && f.photo.indexOf('http') === 0) urls.set(f.photo, (f.gallery === 'missing' ? 'illustrations/' : 'photos/') + zipFileName(f.photo)); });
    for (const pair of urls) {
      try { const r = await fetch(pair[0]); if (r.ok) files.push({ name: pair[1], data: new Uint8Array(await r.arrayBuffer()) }); } catch (e) { /* unreachable photo: skipped, its URL stays in the JSON */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(makeZip(files)); a.download = 'ozbak-sauvegarde-' + todayLocalISO() + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } finally { btn.disabled = false; btn.textContent = label; }
}

function filteredItems(gallery) {
  const q = norm(galFilters.q);
  let items = galleryItems(gallery).filter((f) => {
    if (q && !(norm(f.name_en).includes(q) || norm(f.name_fr).includes(q) || norm(f.scientific).includes(q))) return false;
    if (galFilters.family && f.family !== galFilters.family) return false;
    if (galFilters.type && f.category !== galFilters.type) return false;
    if (galFilters.country && f.country !== galFilters.country) return false;
    if (galFilters.place && f.place !== galFilters.place) return false;
    return true;
  });
  const questNum = (f) => { const n = parseInt(f.quest, 10); return isNaN(n) ? 9999 : n; };
  const dirF = galFilters.dir === 'desc' ? -1 : 1;
  if (galFilters.sort === 'name') items.sort((a, b) => dirF * primaryName(a).localeCompare(primaryName(b)));
  else if (galFilters.sort === 'family') items.sort((a, b) => dirF * ((a.family || '').localeCompare(b.family || '') || (a.num || 0) - (b.num || 0)));
  else items.sort((a, b) => dirF * (gallery === 'missing' ? questNum(a) - questNum(b) || String(a.quest).localeCompare(String(b.quest)) : (a.num || 0) - (b.num || 0)));
  /* Missing QC: the owner's priority quests always sit on top of the
     gallery; the chosen sort still applies inside each group. */
  if (gallery === 'missing') items = items.filter((f) => f.priority).concat(items.filter((f) => !f.priority));
  return items;
}
function photoHTML(f, cls) {
  if (f.photo) return '<img class="photo ' + (cls || '') + '" src="' + f.photo + '" alt="' + esc(primaryName(f)) + '">';
  return '<div class="placeholder"><img src="ozbak-logo.png" alt=""><span class="sci">' + esc(f.scientific) + '</span></div>';
}
function cardHTML(f, gallery) {
  const badge = gallery === 'missing' ? ('#' + esc(f.quest)) : ('#' + f.num);
  const wlab = f.gallery === 'subspecies' ? (f.water || 'Freshwater') : (f.category || '—');
  let h = '<div><button class="card" data-fish="' + f.id + '"><span class="ph">' + photoHTML(f) +
    '<span class="badge">' + badge + '</span>' + (f.photo ? '<span class="sci">' + esc(f.scientific) + '</span>' : '') +
    (gallery === 'missing' && f.priority ? '<span class="prio">' + esc(t('priority')) + '</span>' : '') + '</span>' +
    '<span class="body" style="display:block"><span class="primary" style="display:block">' + esc(primaryName(f)) + '</span>' +
    '<span class="secondary" style="display:block">' + esc(secondaryName(f)) + '</span>' +
    '<span class="foot"><span class="water' + (wlab === 'Saltwater' ? ' salt' : '') + '">' + esc(wlab) + '</span>' +
    '<span class="place">' + esc(placeLabel(f)) + '</span></span></span></button>';
  if (gallery === 'missing' && adminUnlocked) h += '<button class="transfer-btn" data-transfer="' + f.id + '">' + esc(t('transfer')) + '</button>';
  return h + '</div>';
}
function rowHTML(f, gallery) {
  const badge = gallery === 'missing' ? ('#' + esc(f.quest)) : ('#' + f.num);
  const thumb = f.photo ? '<img class="thumb" src="' + f.photo + '" alt="">' : '<span class="thumb ph"><img src="ozbak-logo.png" alt=""></span>';
  let h = '<div><button class="rowcard" data-fish="' + f.id + '">' + thumb +
    '<span class="mid"><span class="primary">' + esc(primaryName(f)) + '</span><br><span class="sci">' + esc(f.scientific) + '</span><br>' +
    '<span class="sub">' + esc([placeLabel(f), f.date].filter(Boolean).join(' • ')) + '</span></span>' +
    '<span class="right"><span class="num">' + badge + '</span><br><span class="fam">' + esc(f.family) + '</span></span></button>';
  if (gallery === 'missing' && adminUnlocked) h += '<button class="transfer-btn" data-transfer="' + f.id + '">' + esc(t('transfer')) + '</button>';
  return h + '</div>';
}
function drawGalleryResults(gallery) {
  const items = filteredItems(gallery);
  $('#gcount').textContent = items.length + ' / ' + galleryItems(gallery).length + ' ' + t('species');
  const box = $('#gresults');
  if (!items.length) { box.innerHTML = '<div class="empty">' + esc(t('no_results')) + '</div>'; return; }
  box.innerHTML = viewMode === 'grid'
    ? '<div class="grid">' + items.map((f) => cardHTML(f, gallery)).join('') + '</div>'
    : '<div class="listview">' + items.map((f) => rowHTML(f, gallery)).join('') + '</div>';
  box.querySelectorAll('[data-fish]').forEach((el) => el.addEventListener('click', () => openPopup(el.getAttribute('data-fish'))));
  box.querySelectorAll('[data-transfer]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); startTransfer(el.getAttribute('data-transfer')); }));
}
function wireGallery(gallery) {
  if (window._lastGal !== gallery) { galFilters = { q: '', family: '', type: '', country: '', place: '', sort: 'number', dir: gallery === 'missing' ? 'asc' : 'desc' }; window._lastGal = gallery; }
  const on = () => drawGalleryResults(gallery);
  if (galFilters.family) $('#gfam').value = galFilters.family;
  if (galFilters.type) $('#gtype').value = galFilters.type;
  /* The Place list follows the selected Country: only that country's
     places (all places when no country is selected). A place that is no
     longer valid after a country change resets to "all". */
  const placeSel = $('#gplace');
  const refreshPlaces = () => {
    const vals = placeOptionsFor(gallery, galFilters.country);
    if (galFilters.place && !vals.includes(galFilters.place)) galFilters.place = '';
    placeSel.innerHTML = '<option value="">' + esc(t('all_places')) + '</option>' + vals.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
    placeSel.value = galFilters.place || '';
  };
  const countrySel = $('#gcountry');
  if (countrySel) countrySel.value = galFilters.country || '';
  refreshPlaces();
  $('#gsort').value = galFilters.sort;
  $('#gq').addEventListener('input', (e) => { galFilters.q = e.target.value; on(); });
  $('#gfam').addEventListener('change', (e) => { galFilters.family = e.target.value; on(); });
  $('#gtype').addEventListener('change', (e) => { galFilters.type = e.target.value; on(); });
  if (countrySel) countrySel.addEventListener('change', (e) => { galFilters.country = e.target.value; refreshPlaces(); on(); });
  placeSel.addEventListener('change', (e) => { galFilters.place = e.target.value; on(); });
  $('#gsort').addEventListener('change', (e) => { galFilters.sort = e.target.value; on(); });
  const dirBtn = $('#gdir');
  const setDirLabel = () => { dirBtn.textContent = t(galFilters.dir === 'desc' ? 'dir_desc' : 'dir_asc'); };
  setDirLabel();
  dirBtn.addEventListener('click', () => { galFilters.dir = galFilters.dir === 'desc' ? 'asc' : 'desc'; setDirLabel(); on(); });
  $('#vgrid').addEventListener('click', () => { viewMode = 'grid'; localStorage.setItem(VIEW_KEY, 'grid'); render(); });
  $('#vlist').addEventListener('click', () => { viewMode = 'list'; localStorage.setItem(VIEW_KEY, 'list'); render(); });
  drawGalleryResults(gallery);
}

/* ----- detail popup ----- */
function openPopup(id) {
  const f = state.fish.find((x) => x.id === id) || state.pending.find((x) => x.id === id);
  if (!f) return;
  const isMissing = f.status === 'missing';
  const title = isMissing ? ('#' + esc(f.quest) + ' · ' + esc(primaryName(f))) : ('#' + f.num + ' ' + esc(primaryName(f)));
  const waterLabel = f.gallery === 'subspecies' ? (f.water || 'Freshwater') : (f.category || '—');
  const big = f.photo ? '<img class="bigphoto" src="' + f.photo + '" alt="' + esc(primaryName(f)) + '">'
    : '<div class="placeholder bigplaceholder"><img src="ozbak-logo.png" alt=""><span class="sci">' + esc(f.scientific) + '</span></div>';
  let captureRows = '';
  if (isMissing) {
    captureRows =
      (f.suggested_place ? '<div><dt>' + esc(t('suggested_place')) + ':</dt><dd>' + esc(f.suggested_place) + '</dd></div>' : '') +
      (f.when ? '<div><dt>' + esc(t('when')) + ':</dt><dd>' + esc(f.when) + '</dd></div>' : '');
  } else {
    captureRows =
      '<div><dt>' + esc(t('date')) + ':</dt><dd>' + esc(f.date || '—') + '</dd></div>' +
      '<div><dt>' + esc(t('country')) + ':</dt><dd>' + esc(f.country || '—') + '</dd></div>' +
      '<div><dt>' + esc(t('place')) + ':</dt><dd>' + esc(f.place || '—') + '</dd></div>';
  }
  $('#popupContent').innerHTML = '<h2>' + title + '</h2>' + big +
    '<div class="cols"><div><h3>' + esc(t('identification')) + '</h3><dl>' +
    '<div><dt>' + esc(t('scientific')) + ':</dt><dd><i>' + esc(f.scientific) + '</i></dd></div>' +
    '<div><dt>' + esc(t('english')) + ':</dt><dd>' + esc(f.name_en) + '</dd></div>' +
    '<div><dt>' + esc(t('french')) + ':</dt><dd>' + esc(f.name_fr) + '</dd></div>' +
    '<div><dt>' + esc(t('family')) + ':</dt><dd>' + esc(f.family) + '</dd></div></dl>' +
    '<h3 style="margin-top:14px">' + esc(t('water_type')) + '</h3><span class="water' + (waterLabel === 'Saltwater' ? ' salt' : '') + '">' + esc(waterLabel) + '</span></div>' +
    '<div><h3>' + esc(t('capture')) + '</h3><dl>' + captureRows + '</dl>' +
    (f.inaturalist ? '<p><a href="' + esc(f.inaturalist) + '" target="_blank" rel="noopener">' + esc(t('inat')) + '</a></p>' : '') +
    '</div></div>' +
    (f.notes ? '<h3 style="margin-top:16px">' + esc(t('notes')) + '</h3><p class="notes">' + esc(f.notes) + '</p>' : '') +
    '<button class="share-btn" id="shareBtn">↗ ' + esc(t('share')) + '</button>' +
    (isMissing ? '' : '<button class="share-btn" id="cardBtn" style="margin-left:8px">🃏 ' + esc(t('card_btn')) + '</button>') +
    (isMissing && adminUnlocked && f.dbId ? '<button class="share-btn" id="prioBtn" style="margin-left:8px">' + esc(f.priority ? t('prio_remove') : t('prio_add')) + '</button>' : '');
  $('#popup').hidden = false;
  $('#shareBtn').addEventListener('click', () => shareFish(f));
  const cb = $('#cardBtn'); if (cb) cb.addEventListener('click', () => makeCard(f));
  const pb = $('#prioBtn'); if (pb) pb.addEventListener('click', () => togglePriority(f));
}
function closePopup() { $('#popup').hidden = true; }
/* ----- QR code to the public site (shown in person, e.g. while travelling) ----- */
function openQr() {
  $('#popupContent').innerHTML = '<h2>' + esc(t('qr_caption')) + '</h2>' +
    '<img class="bigqr" src="qr-site.svg" alt="QR code — https://ozbak-fishing.github.io/">' +
    '<p class="qr-url">https://ozbak-fishing.github.io/</p>';
  $('#popup').hidden = false;
}
function shareFish(f) {
  const url = location.href.split('#')[0] + '#fish=' + f.id;
  const text = '#' + (f.num || f.quest || '') + ' ' + primaryName(f) + ' (' + f.scientific + ') — Ozbak Lifelist';
  if (navigator.share) navigator.share({ title: 'Ozbak Lifelist', text, url }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => alert(url));
  else prompt('Copy this link / Copiez ce lien :', url);
}

/* ----- Instagram catch card (owner-approved design, 2026-11-21) -----
   1080x1350 (4:5), English only, one accent colour per gallery:
   main = brand blue, subspecies = teal, hybrids = purple. The catch
   photo is shown WHOLE (contain) over a blurred cover backdrop. */
const CARD_STYLE = {
  main: { accent: '#004393', tint: '#EAF1F8', label: 'Main species' },
  subspecies: { accent: '#096E80', tint: '#E3F2F5', label: 'Subspecies and variants' },
  hybrids: { accent: '#5E35B1', tint: '#ECE5F7', label: 'Hybrids' }
};
function loadImg(src, cors) {
  return new Promise((res, rej) => {
    const i = new Image();
    if (cors) i.crossOrigin = 'anonymous';
    i.onload = () => res(i); i.onerror = rej; i.src = src;
  });
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
async function makeCard(f) {
  const st = CARD_STYLE[f.gallery] || CARD_STYLE.main;
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#FAF9F8'; ctx.fillRect(0, 0, W, H);
  let photo = null, logo = null, qr = null;
  try { logo = await loadImg('ozbak-logo.png'); } catch (e) {}
  try { qr = await loadImg('qr-site.png'); } catch (e) {}
  if (f.photo) { try { photo = await loadImg(f.photo, true); } catch (e) { try { photo = await loadImg(f.photo); } catch (e2) {} } }
  // frame + header band
  rr(ctx, 18, 18, W - 36, H - 36, 42); ctx.lineWidth = 10; ctx.strokeStyle = st.accent; ctx.stroke();
  rr(ctx, 48, 48, W - 96, 190, 28); ctx.fillStyle = st.accent; ctx.fill();
  let size = 60;
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
  do { ctx.font = '700 ' + size + 'px Arial, sans-serif'; size -= 4; }
  while (ctx.measureText((f.name_en || '').toUpperCase()).width > 690 && size > 30);
  ctx.fillText((f.name_en || '').toUpperCase(), 84, 138);
  ctx.font = '700 36px Arial, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillText(st.label, 84, 196);
  ctx.beginPath(); ctx.arc(W - 161, 131, 57, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.fillStyle = st.accent; ctx.font = '700 44px Arial, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('#' + (f.num || ''), W - 161, 147); ctx.textAlign = 'left';
  // scientific + family
  ctx.fillStyle = '#5A697D'; ctx.font = 'italic 34px Georgia, serif';
  const sci = f.scientific || '';
  ctx.fillText(sci, 84, 290);
  const sw = ctx.measureText(sci).width;
  ctx.fillText('·  ' + (f.family || ''), 84 + sw + 14, 290);
  // photo window: blurred cover backdrop + whole photo on top
  const px = 48, py = 318, pw = W - 96, ph = 600;
  rr(ctx, px, py, pw, ph, 18); ctx.save(); ctx.clip();
  if (photo) {
    const s = Math.max(pw / photo.width, ph / photo.height);
    try { ctx.filter = 'blur(28px)'; } catch (e) {}
    ctx.drawImage(photo, px + (pw - photo.width * s) / 2 - 30, py + (ph - photo.height * s) / 2 - 30, photo.width * s + 60, photo.height * s + 60);
    try { ctx.filter = 'none'; } catch (e) {}
    const s2 = Math.min(pw / photo.width, ph / photo.height);
    ctx.drawImage(photo, px + (pw - photo.width * s2) / 2, py + (ph - photo.height * s2) / 2, photo.width * s2, photo.height * s2);
  } else {
    ctx.fillStyle = st.tint; ctx.fillRect(px, py, pw, ph);
    if (logo) ctx.drawImage(logo, px + (pw - 380) / 2, py + (ph - 380) / 2, 380, 380);
  }
  ctx.restore();
  rr(ctx, px, py, pw, ph, 18); ctx.lineWidth = 6; ctx.strokeStyle = st.accent; ctx.stroke();
  // stats box (always English on the card)
  rr(ctx, 48, 952, W - 96, 200, 24); ctx.fillStyle = st.tint; ctx.fill();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let dateStr = '—';
  if (f.date) { const p = f.date.split('-'); if (p.length === 3) dateStr = months[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0]; }
  const placeStr = [f.place, f.country].filter(Boolean).join(', ') || '—';
  const wtr = f.water ? (f.water.charAt(0).toUpperCase() + f.water.slice(1)) : '';
  const isWater = (wtr === 'Freshwater' || wtr === 'Saltwater');
  const cells = [['DATE', dateStr], ['PLACE', placeStr], isWater ? ['WATER', wtr] : ['TYPE', f.category || '—'], ['FAMILY', f.family || '—']];
  cells.forEach((c, i) => {
    const cx = 48 + (i % 2) * ((W - 96) / 2), cy = 952 + Math.floor(i / 2) * 100;
    ctx.fillStyle = '#5A697D'; ctx.font = '700 27px Arial, sans-serif'; ctx.fillText(c[0], cx + 36, cy + 50);
    ctx.fillStyle = '#142335'; ctx.font = '700 36px Arial, sans-serif'; ctx.fillText(c[1], cx + 36, cy + 92);
  });
  // footer: logo + brand + QR
  if (logo) ctx.drawImage(logo, 56, H - 196, 150, 150);
  ctx.fillStyle = '#004393'; ctx.font = '700 42px Arial, sans-serif';
  ctx.fillText('OZBAK — LIFELIST', 226, H - 104);
  if (qr) ctx.drawImage(qr, W - 196, H - 200, 140, 140);
  ctx.fillStyle = '#5A697D'; ctx.font = '26px Arial, sans-serif';
  ctx.fillText('My lifelist', W - 196, H - 28);
  // present: preview + share / download
  const url = cv.toDataURL('image/png');
  $('#popupContent').innerHTML = '<h2>' + esc(t('card_title')) + '</h2>' +
    '<img class="bigphoto" src="' + url + '" alt="Instagram card">' +
    '<button class="share-btn" id="cardShareBtn">↗ ' + esc(t('share')) + '</button>' +
    '<a class="share-btn" style="margin-left:8px;text-decoration:none;display:inline-block" href="' + url + '" download="ozbak-card-' + (f.num || 'x') + '.png">⬇ ' + esc(t('download')) + '</a>';
  $('#popup').hidden = false;
  $('#cardShareBtn').addEventListener('click', async () => {
    try {
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      const file = new File([blob], 'ozbak-card-' + (f.num || 'x') + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
      if (navigator.share) { await navigator.share({ title: 'Ozbak Lifelist', text: '#' + (f.num || '') + ' ' + (f.name_en || '') + ' — Ozbak Lifelist' }); return; }
    } catch (e) {}
    const a = document.createElement('a'); a.href = url; a.download = 'ozbak-card-' + (f.num || 'x') + '.png'; a.click();
  });
}

/* ---------- Fingerprint lock for the Admin (S6) ----------
   A per-device WebAuthn (platform authenticator) gate ON TOP of the
   Supabase password account. The password stays the real credential —
   this lock only stops someone holding the phone from opening the
   Admin tab. Opt-in per device (localStorage); the unlock lasts for
   the app session (sessionStorage) and dies on sign-out. The
   assertion signature is fully verified against the public key
   captured at registration (ES256). Fallback if the fingerprint ever
   fails: disable the lock by re-typing the account password. */
const BIO_KEY = 'ozbakBioGate';
let bioAvailable = false;
let bioChallenge = null;
function b64urlEncode(bytes) { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlDecode(str) { const s = String(str).replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4)); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
/* Minimal CBOR decoder — just enough for WebAuthn attestation objects
   (maps, arrays, ints, byte/text strings, simple values). */
function cborDecode(bytes, offset) {
  offset = offset || 0;
  const b = bytes[offset]; const major = b >> 5; const ai = b & 31; let pos = offset + 1;
  const readLen = () => { if (ai < 24) return ai; if (ai === 24) { const v = bytes[pos]; pos += 1; return v; } if (ai === 25) { const v = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; return v; } if (ai === 26) { const v = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0; pos += 4; return v; } throw new Error('CBOR length too large'); };
  if (major === 0) return [readLen(), pos];
  if (major === 1) return [-1 - readLen(), pos];
  if (major === 2 || major === 3) { const len = readLen(); const v = bytes.slice(pos, pos + len); pos += len; return [major === 3 ? new TextDecoder().decode(v) : v, pos]; }
  if (major === 4) { const len = readLen(); const arr = []; for (let i = 0; i < len; i++) { const r = cborDecode(bytes, pos); arr.push(r[0]); pos = r[1]; } return [arr, pos]; }
  if (major === 5) { const len = readLen(); const map = new Map(); for (let i = 0; i < len; i++) { const k = cborDecode(bytes, pos); pos = k[1]; const v = cborDecode(bytes, pos); pos = v[1]; map.set(k[0], v[0]); } return [map, pos]; }
  if (major === 7) { if (ai === 20) return [false, pos]; if (ai === 21) return [true, pos]; if (ai === 22) return [null, pos]; if (ai === 25) { pos += 2; return [0, pos]; } if (ai === 26) { pos += 4; return [0, pos]; } if (ai === 27) { pos += 8; return [0, pos]; } return [ai, pos]; }
  throw new Error('CBOR major ' + major);
}
function coseToJwk(coseBytes) {
  const parsed = cborDecode(coseBytes, 0)[0];
  const x = parsed.get(-2), y = parsed.get(-3);
  if (!x || !y) throw new Error('COSE key incomplete');
  return { kty: 'EC', crv: 'P-256', x: b64urlEncode(x), y: b64urlEncode(y), ext: true };
}
function derToRawSig(der) {
  let pos = 0;
  if (der[pos++] !== 0x30) throw new Error('DER sequence');
  let len = der[pos++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = (len << 8) | der[pos++]; }
  const readInt = () => { if (der[pos++] !== 0x02) throw new Error('DER int'); const l = der[pos++]; let v = der.slice(pos, pos + l); pos += l; while (v.length > 32 && v[0] === 0) v = v.slice(1); const out = new Uint8Array(32); out.set(v, 32 - v.length); return out; };
  const r = readInt(), s = readInt(); const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32); return raw;
}
function bioGate() { try { const g = JSON.parse(localStorage.getItem(BIO_KEY) || 'null'); return g && g.credId && g.jwk ? g : null; } catch (e) { return null; } }
function bioUnlocked() { try { return sessionStorage.getItem('ozbakBioUnlocked') === '1'; } catch (e) { return false; } }
function bioSetUnlocked() { try { sessionStorage.setItem('ozbakBioUnlocked', '1'); } catch (e) {} }
function bioClearUnlocked() { try { sessionStorage.removeItem('ozbakBioUnlocked'); } catch (e) {} }
async function bioRegister() {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = await navigator.credentials.create({ publicKey: {
    challenge, rp: { name: 'Ozbak Lifelist' },
    user: { id: new TextEncoder().encode(session.user_id || 'ozbak'), name: session.email || '', displayName: session.email || '' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
    attestation: 'none', timeout: 60000 } });
  if (!cred) throw new Error('no credential');
  const att = cborDecode(new Uint8Array(cred.response.attestationObject), 0)[0];
  const authData = att.get('authData');
  if (!(authData[32] & 0x40)) throw new Error('no attested credential data');
  const credIdLen = (authData[53] << 8) | authData[54];
  const credId = authData.slice(55, 55 + credIdLen);
  const jwk = coseToJwk(authData.slice(55 + credIdLen));
  localStorage.setItem(BIO_KEY, JSON.stringify({ credId: b64urlEncode(credId), jwk }));
  bioSetUnlocked();
}
async function bioUnlock() {
  const gate = bioGate(); if (!gate) return true;
  bioChallenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({ publicKey: {
    challenge: bioChallenge,
    allowCredentials: [{ type: 'public-key', id: b64urlDecode(gate.credId) }],
    userVerification: 'required', timeout: 60000 } });
  if (!assertion) throw new Error('cancelled');
  const resp = assertion.response;
  const clientData = JSON.parse(new TextDecoder().decode(resp.clientDataJSON));
  if (clientData.type !== 'webauthn.get' || clientData.challenge !== b64urlEncode(bioChallenge)) throw new Error('challenge mismatch');
  const authData = new Uint8Array(resp.authenticatorData);
  if (!(authData[32] & 0x04)) throw new Error('user verification missing');
  const clientHash = await crypto.subtle.digest('SHA-256', resp.clientDataJSON);
  const signed = new Uint8Array(authData.length + clientHash.byteLength);
  signed.set(authData, 0); signed.set(new Uint8Array(clientHash), authData.length);
  const key = await crypto.subtle.importKey('jwk', gate.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRawSig(new Uint8Array(resp.signature)), signed);
  if (!ok) throw new Error('bad signature');
  bioSetUnlocked();
  return true;
}
function bioDisable() { try { localStorage.removeItem(BIO_KEY); } catch (e) {} bioClearUnlocked(); }

/* ----- admin ----- */
function adminHTML() {
  if (!adminUnlocked) {
    return '<h1 style="color:var(--blue)">' + esc(t('admin_title')) + '</h1><div class="panel"><h2>' + esc(t('login_title')) + '</h2>' +
      '<p>' + esc(t('login_text')) + '</p><div id="adminMsg"></div>' +
      (loginError ? '<div class="warn">' + esc(t(loginError)) + '</div>' : '') +
      '<form id="loginForm"><label>' + esc(t('email')) + '</label><input type="email" id="loginEmail" autocomplete="username" required>' +
      '<label>' + esc(t('password')) + '</label><input type="password" id="loginPass" autocomplete="current-password" required>' +
      '<button class="btn" type="submit" id="loginBtn">' + esc(t('sign_in')) + '</button></form></div>';
  }
  if (bioGate() && !bioUnlocked()) {
    return '<h1 style="color:var(--blue)">' + esc(t('admin_title')) + '</h1>' +
      '<div class="panel"><h2>🔒 ' + esc(t('bio_lock_title')) + '</h2><p>' + esc(t('bio_lock_text')) + '</p><div id="adminMsg"></div>' +
      '<button class="btn" id="bioUnlockBtn" type="button">' + esc(t('bio_unlock_btn')) + '</button>' +
      '<p style="margin-top:16px"><button class="btn ghost" id="bioFallbackBtn" type="button">' + esc(t('bio_fallback')) + '</button></p>' +
      '<div id="bioFallbackBox" hidden><label>' + esc(t('password')) + '</label><input type="password" id="bioPass" autocomplete="current-password">' +
      '<button class="btn danger" id="bioDisableBtn" type="button">' + esc(t('bio_disable_pw')) + '</button></div></div>';
  }
  const pendingCount = state.outbox.length;
  const isOffline = typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
  const syncLabel = pendingCount ? esc(t('pending_sync')) + ': ' + pendingCount
    : (isOffline ? esc(t('sync_offline')) : esc(t('synchronized')));
  const radio = (val, label) => '<label><input type="radio" name="syncmode" value="' + val + '"' + (state.syncMode === val ? ' checked' : '') + '> ' + esc(label) + '</label>';
  const editOptions = state.fish.filter((f) => f.status === 'caught')
    .sort((a, b) => a.gallery.localeCompare(b.gallery) || (a.num || 0) - (b.num || 0))
    .map((f) => '<option value="' + f.id + '">' + esc(f.gallery) + ' #' + f.num + ' — ' + esc(f.name_en || f.scientific) + ' (' + esc(f.scientific) + ')</option>').join('');
  const pendingList = state.pending.length
    ? state.pending.map((f) => '<div class="pending-item"><span><b>' + esc(primaryName(f)) + '</b> · <i>' + esc(f.scientific) + '</i><br><span class="small">' + esc([f.gallery, f.date, placeLabel(f)].filter(Boolean).join(' • ')) + '</span></span>' +
      '<span><button class="btn small" data-confirm-pending="' + f.id + '">' + esc(t('confirm_btn')) + '</button> ' +
      '<button class="btn small danger" data-delete-pending="' + f.id + '">' + esc(t('delete_btn')) + '</button></span></div>').join('')
    : '<p class="small">' + esc(t('pending_empty')) + '</p>';
  return '<h1 style="color:var(--blue)">' + esc(t('admin_title')) + '</h1><div id="adminMsg"></div>' +
    '<div class="panel"><h3>' + esc(t('signed_in_as')) + '</h3><p>' + esc(session ? session.email || '' : '') + '</p>' +
    '<button class="btn ghost" id="signOutBtn">' + esc(t('sign_out')) + '</button></div>' +
    '<div class="panel"><h3>' + esc(t('bio_panel_title')) + '</h3>' +
    (bioGate()
      ? '<p>' + esc(t('bio_on_text')) + '</p><button class="btn ghost" id="bioOffBtn" type="button">' + esc(t('bio_turn_off')) + '</button>'
      : bioAvailable
        ? '<p>' + esc(t('bio_off_text')) + '</p><button class="btn ghost" id="bioOnBtn" type="button">' + esc(t('bio_turn_on')) + '</button>'
        : '<p class="small">' + esc(t('bio_unavailable')) + '</p>') + '</div>' +
    '<div class="panel"><h3>' + esc(t('sync_status')) + '</h3>' +
    '<span class="syncdot' + (pendingCount ? ' pending' : '') + '">' + syncLabel + '</span>' +
    (state.syncError ? '<div class="warn" style="margin-top:10px">' + esc(t('sync_error')) + '<br><span class="small">' + esc(state.syncError.message || '') + (state.syncError.at ? ' · ' + esc(new Date(state.syncError.at).toLocaleString()) : '') + '</span></div>' : '') +
    '<h3 style="margin-top:18px">' + esc(t('data_control')) + '</h3><div class="radio-row">' +
    radio('blocked', t('sync_blocked')) + radio('wifi', t('sync_wifi')) + radio('both', t('sync_both')) + '</div>' +
    '<button class="btn ghost" id="syncNow">' + esc(t('sync_now')) + '</button> ' +
    '<button class="btn ghost" id="backupBtn">' + esc(t('backup_btn')) + '</button></div>' +
    '<div class="panel"><h3>' + esc(t('pending_title')) + ' (' + state.pending.length + ')</h3>' + pendingList + '</div>' +
    '<div class="panel"><h3 id="formTitle">' + esc(t('add_title')) + '</h3>' +
    '<label>' + esc(t('edit_existing')) + '</label><select id="editSelect"><option value="">' + esc(t('choose_fish')) + '</option>' + editOptions + '</select>' +
    '<form id="fishForm"><div class="form-grid">' +
    '<div><label>' + esc(t('f_en')) + ' *</label><input id="af_en" required></div>' +
    '<div><label>' + esc(t('f_fr')) + ' *</label><input id="af_fr" required></div>' +
    '<div><label>' + esc(t('f_sci')) + ' *</label><input id="af_sci" required></div>' +
    '<div><label>' + esc(t('f_family')) + '</label><input id="af_family"></div>' +
    '<div><label>' + esc(t('f_gallery')) + '</label><select id="af_gallery"><option value="main">Main species</option><option value="subspecies">Subspecies and variants</option><option value="hybrids">Hybrids</option></select></div>' +
    '<div><label>' + esc(t('f_water')) + '</label><select id="af_water"><option>Freshwater</option><option>Saltwater</option><option>Variant</option></select></div>' +
    /* The date input starts on today (the publication day, which is also
       the payload fallback when left untouched) so the owner sees which
       date will be used. fillForm() overwrites it with the fish's own
       date whenever one is loaded — editing never alters an existing
       date through this pre-fill. */
    '<div><label>' + esc(t('f_date')) + '</label><input type="date" id="af_date" value="' + todayLocalISO() + '"></div>' +
    '<div><label>' + esc(t('f_country')) + '</label><input id="af_country" placeholder="Canada"></div>' +
    '<div><label>' + esc(t('f_place')) + '</label><input id="af_place" placeholder="Québec"></div>' +
    '<div><label>' + esc(t('f_inat')) + '</label><input id="af_inat" type="url" placeholder="https://www.inaturalist.org/observations/…"></div>' +
    '</div>' +
    '<div id="numRow" hidden><label>' + esc(t('f_num')) + '</label><input type="number" id="af_num" min="1"></div>' +
    '<label>' + esc(t('f_status')) + '</label><select id="af_status"><option value="pending">' + esc(t('st_pending')) + '</option><option value="caught">' + esc(t('st_caught')) + '</option></select>' +
    '<label>' + esc(t('f_notes')) + '</label><textarea id="af_notes"></textarea>' +
    '<label>' + esc(t('f_photo')) + '</label><input type="file" id="af_photo" accept="image/*">' +
    '<div class="cropbox" id="cropBox" hidden><p class="small">' + esc(t('crop_hint')) + '</p>' +
    '<canvas id="cropCanvas" width="480" height="360"></canvas>' +
    '<label>Zoom <input type="range" id="cropZoom" min="1" max="3" step="0.05" value="1" style="width:200px;vertical-align:middle"></label>' +
    '<button type="button" class="btn small" id="cropApply">' + esc(t('apply_crop')) + '</button> ' +
    '<button type="button" class="btn small ghost" id="cropSkip">' + esc(t('skip_crop')) + '</button></div>' +
    '<div id="photoPreview" style="margin-top:10px"></div>' +
    '<button class="btn" type="submit" id="saveBtn">' + esc(t('save')) + '</button> ' +
    '<button class="btn ghost" type="button" id="cancelEdit" hidden>' + esc(t('cancel_edit')) + '</button>' +
    /* Danger zone: only revealed when an existing caught fish is loaded
       for editing (wireAdmin toggles #deleteZone). Visually separated
       from Save, and the delete itself needs the typed-number safety. */
    '<div class="danger-zone" id="deleteZone" hidden>' +
    '<button class="btn danger-outline" type="button" id="deleteFishBtn">' + esc(t('del_btn')) + '</button>' +
    '<div class="danger-box" id="deleteConfirm" hidden>' +
    '<p style="margin:0 0 6px"><b>' + esc(t('del_intro')) + '</b></p>' +
    '<p style="margin:0 0 6px" id="deleteFishName"></p>' +
    '<p class="small" style="margin:0">' + esc(t('del_consequence')) + '</p>' +
    '<label for="deleteCode">' + esc(t('del_type_label')) + '</label>' +
    '<input id="deleteCode" inputmode="numeric" autocomplete="off" style="max-width:160px">' +
    '<button class="btn danger" type="button" id="deleteFinalBtn" disabled>' + esc(t('del_final')) + '</button> ' +
    '<button class="btn ghost" type="button" id="deleteCancelBtn">' + esc(t('del_cancel')) + '</button>' +
    '</div></div></form></div>' +
    '<div class="panel"><h3>' + esc(t('data_source')) + '</h3><p>' + esc(t(state.dataSource === 'live' ? 'source_live' : state.dataSource === 'bundled' ? 'source_bundled' : 'source_cache')) + '</p>' +
    '<button class="btn ghost" id="refreshBtn">' + esc(t('refresh_btn')) + '</button></div>';
}
function adminMsg(html, ok) { const m = $('#adminMsg'); if (m) m.innerHTML = '<div class="' + (ok ? 'ok' : 'warn') + '">' + html + '</div>'; }

/* crop state */
let cropImg = null, cropOrig = null, cropZoom = 1, cropX = 0, cropY = 0, cropDrag = null;
/* Photos stored by the app are always a lightened copy: max dimension
   1600 px, JPEG ~0.85. The original stays untouched in the phone gallery.
   Every path into formPhoto (attach at pick time, crop Apply, crop Skip)
   goes through the same helper, so a full-resolution original can never
   end up in formPhoto — a multi-MB dataURL is what used to overflow the
   persisted state and silently take the photo (and the queued write)
   down with it. */
const PHOTO_MAX_DIM = 1600;
const PHOTO_JPEG_QUALITY = 0.85;
function setFormPhotoFromImage(source) {
  const srcW = source ? (source.naturalWidth || source.width || 0) : 0;
  const srcH = source ? (source.naturalHeight || source.height || 0) : 0;
  if (!source || !srcW || !srcH) { formPhoto = null; showPhotoPreview(); return; }
  const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { formPhoto = null; showPhotoPreview(); return; }
  ctx.drawImage(source, 0, 0, w, h);
  formPhoto = canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY);
  showPhotoPreview();
}
function drawCrop() {
  const cv = $('#cropCanvas'); if (!cv || !cropImg) return;
  const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height;
  ctx.fillStyle = '#eef4fc'; ctx.fillRect(0, 0, W, H);
  const base = Math.max(W / cropImg.width, H / cropImg.height);
  const s = base * cropZoom, w = cropImg.width * s, h = cropImg.height * s;
  ctx.drawImage(cropImg, (W - w) / 2 + cropX, (H - h) / 2 + cropY, w, h);
}
function wireCrop() {
  const input = $('#af_photo'); if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files && input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      cropOrig = reader.result;
      const img = new Image();
      img.onload = () => {
        cropImg = img; cropZoom = 1; cropX = 0; cropY = 0; $('#cropBox').hidden = false; const z = $('#cropZoom'); if (z) z.value = 1; drawCrop();
        /* Invariant: a picked photo is attached immediately; cropping
           only refines it. The downscaled full image becomes formPhoto
           (and the preview) as soon as the pick loads, so saving the
           form without ever touching Apply/Skip can no longer lose the
           photo silently — that exact sequence cost the owner his photo
           twice. Picking a new photo while editing likewise replaces
           the old formPhoto right here. Cancelling the picker fires no
           change event (or no file), so nothing is touched then. */
        setFormPhotoFromImage(cropImg);
      };
      img.src = cropOrig;
    };
    reader.readAsDataURL(file);
  });
  const cv = $('#cropCanvas');
  if (cv) {
    cv.addEventListener('pointerdown', (e) => { cropDrag = { x: e.clientX, y: e.clientY, cx: cropX, cy: cropY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => { if (!cropDrag) return; cropX = cropDrag.cx + (e.clientX - cropDrag.x); cropY = cropDrag.cy + (e.clientY - cropDrag.y); drawCrop(); });
    cv.addEventListener('pointerup', () => { cropDrag = null; });
  }
  const z = $('#cropZoom'); if (z) z.addEventListener('input', () => { cropZoom = parseFloat(z.value); drawCrop(); });
  /* Apply REPLACES the pick-time attachment with the cropped version
     (the crop canvas is 480x360, already under the cap — the helper
     re-encodes it unchanged in size). Skip KEEPS the full image that was
     attached at pick time; re-applying the helper to cropImg produces
     exactly that same attachment, so the button stays consistent and
     harmless if the pick-time attach was somehow skipped. */
  const ap = $('#cropApply'); if (ap) ap.addEventListener('click', () => { setFormPhotoFromImage($('#cropCanvas')); });
  const sk = $('#cropSkip'); if (sk) sk.addEventListener('click', () => { setFormPhotoFromImage(cropImg); });
}
function showPhotoPreview() {
  const p = $('#photoPreview'); if (!p) return;
  p.innerHTML = formPhoto ? '<span class="small">' + esc(t('photo_ready')) + '</span><br><img src="' + formPhoto + '" style="width:140px;border-radius:10px;margin-top:6px" alt="">' : '';
}
function fillForm(f) {
  $('#af_en').value = f.name_en || ''; $('#af_fr').value = f.name_fr || ''; $('#af_sci').value = f.scientific || '';
  $('#af_family').value = f.family || ''; $('#af_date').value = f.date || ''; $('#af_country').value = f.country || '';
  $('#af_place').value = f.place || ''; $('#af_inat').value = f.inaturalist || ''; $('#af_notes').value = f.notes || '';
  const g = $('#af_gallery'); if (g && ['main', 'subspecies', 'hybrids'].includes(f.gallery)) g.value = f.gallery;
  const w = $('#af_water'); const wv = f.gallery === 'subspecies' ? (f.water || 'Freshwater') : f.category;
  if (w && wv) [...w.options].forEach((o) => { if (o.value === wv) w.value = wv; });
  formPhoto = f.photo || null; showPhotoPreview();
}
function startTransfer(id) {
  transferFromId = id; editId = null; go({ name: 'admin' });
  const f = state.fish.find((x) => x.id === id);
  if (f && $('#fishForm')) { fillForm(f); if (!$('#af_date').value) $('#af_date').value = todayLocalISO(); $('#af_gallery').value = 'main'; $('#af_status').value = 'caught'; $('#formTitle').textContent = t('transfer') + ' — ' + primaryName(f); }
}
function wireAdmin() {
  const loginForm = $('#loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#loginBtn'); if (btn) btn.disabled = true;
      const ok = await sbSignIn($('#loginEmail').value.trim(), $('#loginPass').value);
      if (ok) loginError = '';
      render();
      if (ok) processOutbox(false);
    });
    return;
  }
  const bioUnlockBtn = $('#bioUnlockBtn');
  if (bioUnlockBtn) {
    bioUnlockBtn.addEventListener('click', async () => {
      bioUnlockBtn.disabled = true;
      try { await bioUnlock(); render(); }
      catch (e) { adminMsg(esc(t('bio_failed')), false); bioUnlockBtn.disabled = false; }
    });
    $('#bioFallbackBtn').addEventListener('click', () => { $('#bioFallbackBox').hidden = false; });
    $('#bioDisableBtn').addEventListener('click', async () => {
      const ok = await sbSignIn(session ? session.email || '' : '', $('#bioPass').value);
      if (ok) { bioDisable(); render(); }
      else adminMsg(esc(t('login_failed')), false);
    });
    return;
  }
  const bioOnBtn = $('#bioOnBtn');
  if (bioOnBtn) bioOnBtn.addEventListener('click', async () => { try { await bioRegister(); render(); } catch (e) { adminMsg(esc(t('bio_failed')), false); } });
  const bioOffBtn = $('#bioOffBtn');
  if (bioOffBtn) bioOffBtn.addEventListener('click', () => { bioDisable(); render(); });
  document.querySelectorAll('input[name=syncmode]').forEach((r) => r.addEventListener('change', () => { state.syncMode = r.value; saveState(); processOutbox(false); }));
  $('#backupBtn').addEventListener('click', () => doBackup($('#backupBtn')));
  $('#syncNow').addEventListener('click', async () => {
    await processOutbox(true); // deliberate manual action: forces an attempt even when sync is "blocked"
    if (!state.outbox.length) adminMsg(esc(t('sync_done_msg')), true);
    else adminMsg(esc(t('sync_queued_msg')));
  });
  $('#signOutBtn').addEventListener('click', () => { sbSignOut(); render(); });
  $('#refreshBtn').addEventListener('click', async () => { try { await refreshDataset(); saveState(); } catch (e) {} render(); });
  document.querySelectorAll('[data-confirm-pending]').forEach((b) => b.addEventListener('click', () => {
    const i = state.pending.findIndex((x) => x.id === b.getAttribute('data-confirm-pending')); if (i < 0) return;
    const f = state.pending.splice(i, 1)[0];
    f.status = 'caught'; f.num = nextNum(f.gallery); state.fish.push(f);
    queueInsert(f, { transferDbId: f.transferDbId || null }); delete f.transferDbId;
    saveState(); render();
    adminMsg(esc(t('saved_caught')) + f.num, true);
  }));
  document.querySelectorAll('[data-delete-pending]').forEach((b) => b.addEventListener('click', () => {
    state.pending = state.pending.filter((x) => x.id !== b.getAttribute('data-delete-pending')); saveState(); render();
  }));
  const editSel = $('#editSelect');
  editSel.addEventListener('change', () => {
    const f = state.fish.find((x) => x.id === editSel.value);
    if (!f) { editId = null; $('#numRow').hidden = true; $('#cancelEdit').hidden = true; $('#deleteZone').hidden = true; return; }
    editId = f.id; transferFromId = null; fillForm(f);
    $('#af_gallery').value = f.gallery; $('#af_gallery').disabled = true;
    $('#af_num').value = f.num; $('#numRow').hidden = false; $('#cancelEdit').hidden = false;
    $('#formTitle').textContent = t('edit_title') + ' — #' + f.num + ' ' + primaryName(f);
    /* Reveal the delete danger zone for this fish, with its confirmation
       block reset (hidden, code cleared, final button disarmed). */
    $('#deleteZone').hidden = false;
    $('#deleteConfirm').hidden = true;
    $('#deleteCode').value = ''; $('#deleteFinalBtn').disabled = true;
    $('#deleteFishName').innerHTML = '<b>#' + f.num + '</b> — ' + esc(f.name_fr || '') + ' / ' + esc(f.name_en || '') + ' <i>(' + esc(f.scientific) + ')</i>';
  });
  $('#cancelEdit').addEventListener('click', () => { editId = null; render(); });
  /* Protected delete: step 1 reveals the confirmation block; step 2 is
     the final button, which stays disabled until the typed number
     exactly matches the fish being edited (deleteCodeMatches). */
  const deleteCodeInput = $('#deleteCode'), deleteFinalBtn = $('#deleteFinalBtn'), deleteConfirmBox = $('#deleteConfirm');
  $('#deleteFishBtn').addEventListener('click', () => {
    deleteConfirmBox.hidden = false; deleteCodeInput.value = ''; deleteFinalBtn.disabled = true;
    deleteCodeInput.focus();
  });
  $('#deleteCancelBtn').addEventListener('click', () => {
    deleteConfirmBox.hidden = true; deleteCodeInput.value = ''; deleteFinalBtn.disabled = true;
  });
  deleteCodeInput.addEventListener('input', () => {
    const f = state.fish.find((x) => x.id === editId);
    deleteFinalBtn.disabled = !(f && deleteCodeMatches(f, deleteCodeInput.value));
  });
  deleteFinalBtn.addEventListener('click', () => {
    const f = state.fish.find((x) => x.id === editId);
    if (!f || !deleteCodeMatches(f, deleteCodeInput.value)) return; // safety re-checked at click time
    deleteCaughtFish(f);
    editId = null; render(); adminMsg(esc(t('deleted_msg')), true);
  });
  wireCrop();
  $('#fishForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const sci = $('#af_sci').value.trim();
    if (!$('#af_en').value.trim() || !$('#af_fr').value.trim() || !sci) return adminMsg(esc(t('required')));
    /* duplicate warning (S2) — scoped to the SAME gallery as the fish being
       added/edited: the same scientific name may legitimately exist in
       another gallery (e.g. Carassius auratus is a main species AND, in
       captive form, a subspecies). The fish being edited never counts
       against itself (x.id !== editId). Transfers target 'main'. */
    const editTarget = editId ? state.fish.find((x) => x.id === editId) : null;
    const targetGallery = editTarget ? editTarget.gallery : $('#af_gallery').value;
    const dup = state.fish.concat(state.pending).find((x) => norm(x.scientific) === norm(sci) && x.id !== editId && x.status !== 'missing' && x.gallery === targetGallery);
    if (dup && !confirm(t('dup_title') + ' — ' + t('dup_msg') + (dup.num ? '#' + dup.num + ' ' : '') + primaryName(dup) + ' (' + dup.scientific + '). ' + t('dup_ask'))) return;
    const waterVal = $('#af_water').value;
    const base = {
      name_en: $('#af_en').value.trim(), name_fr: $('#af_fr').value.trim(), scientific: sci,
      family: $('#af_family').value.trim(), category: waterVal, water: waterVal === 'Variant' ? 'Freshwater' : waterVal,
      date: $('#af_date').value,
      country: $('#af_country').value.trim(), place: $('#af_place').value.trim(),
      inaturalist: $('#af_inat').value.trim(), notes: $('#af_notes').value.trim(), photo: formPhoto
    };
    if (targetGallery === 'subspecies') {
      // A subspecies keeps the 'Variant' display label; the chosen value is its REAL water type.
      base.category = 'Variant';
      base.water = waterVal === 'Variant' ? ((editTarget && editTarget.water) || 'Freshwater') : waterVal;
    }
    if (editId) {
      const f = state.fish.find((x) => x.id === editId); if (!f) return;
      if (waterVal === 'Variant' && f.water) base.water = f.water; // keep the real water type behind the Variant label
      const oldNum = f.num;
      const peersBefore = state.fish.filter((x) => x.gallery === f.gallery && x.status === 'caught')
        .map((x) => ({ id: x.id, dbId: x.dbId, num: x.num }));
      Object.assign(f, base);
      const wanted = parseInt($('#af_num').value, 10);
      if (wanted && wanted !== f.num) {
        const peers = state.fish.filter((x) => x.gallery === f.gallery && x.status === 'caught').sort((a, b) => a.num - b.num);
        peers.splice(peers.indexOf(f), 1);
        const at = Math.max(0, Math.min(peers.length, wanted - 1));
        peers.splice(at, 0, f);
        peers.forEach((x, i) => { x.num = i + 1; });
      }
      /* S12 shift, mirrored to Supabase: peers whose number changed get a
         capture_number PATCH, ordered to avoid transient duplicates
         (descending when numbers go up, ascending when they go down). */
      const newNumById = {}; state.fish.forEach((x) => { newNumById[x.id] = x.num; });
      const shiftOps = peersBefore
        .filter((p) => p.dbId && p.id !== f.id && newNumById[p.id] !== p.num)
        .map((p) => ({ kind: 'patchNum', dbId: p.dbId, num: newNumById[p.id] }));
      if (wanted && wanted < oldNum) shiftOps.sort((a, b) => b.num - a.num);
      else if (wanted && wanted > oldNum) shiftOps.sort((a, b) => a.num - b.num);
      const photoDataUrl = isDataUrl(formPhoto) ? formPhoto : null;
      const snap = Object.assign({}, f); if (photoDataUrl) snap.photo = null;
      queueUpdate(f, snap, photoDataUrl, shiftOps);
      saveState(); editId = null; render(); adminMsg(esc(t('updated')), true); return;
    }
    const gallery = $('#af_gallery').value;
    const asPending = $('#af_status').value === 'pending';
    const nf = Object.assign({ id: 'local-' + Date.now(), dbId: null, num: null, quest: null, gallery, status: asPending ? 'pending' : 'caught', suggested_place: '', when: '' }, base);
    const wasTransfer = !!transferFromId;
    let transferDbId = null;
    if (wasTransfer) {
      const tf = state.fish.find((x) => x.id === transferFromId);
      if (tf) transferDbId = tf.dbId || null;
      state.fish = state.fish.filter((x) => x.id !== transferFromId);
    }
    if (asPending) { if (wasTransfer) nf.transferDbId = transferDbId; state.pending.push(nf); }
    else { nf.num = nextNum(gallery); state.fish.push(nf); queueInsert(nf, { transferDbId }); }
    transferFromId = null; saveState(); render();
    adminMsg(esc(wasTransfer ? t('transferred') + ' ' : '') + esc(asPending ? t('saved_pending') : t('saved_caught') + nf.num), true);
  });
  if (transferFromId) {
    const f = state.fish.find((x) => x.id === transferFromId);
    /* A transferred quest has no date yet: start the field on today (the
       publication day) instead of blank — same rule as a fresh add. */
    if (f) { fillForm(f); if (!$('#af_date').value) $('#af_date').value = todayLocalISO(); $('#af_gallery').value = 'main'; $('#af_status').value = 'caught'; $('#formTitle').textContent = t('transfer') + ' — ' + primaryName(f); }
  }
}

/* ---------------- global wiring ---------------- */
document.addEventListener('click', (e) => {
  const nav = e.target.closest('a[data-nav]');
  if (nav) { e.preventDefault(); const n = nav.getAttribute('data-nav'); go(n === 'home' ? { name: 'home' } : n === 'admin' ? { name: 'admin' } : { name: 'gallery', gallery: n }); return; }
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); const n = g.getAttribute('data-go'); go(n === 'admin' ? { name: 'admin' } : { name: 'gallery', gallery: n }); return; }
  const qr = e.target.closest('[data-qr]');
  if (qr) { e.preventDefault(); openQr(); }
});
$('#langToggle').addEventListener('click', () => { lang = lang === 'en' ? 'fr' : 'en'; localStorage.setItem(LANG_KEY, lang); render(); });
$('#burger').addEventListener('click', () => $('#mainnav').classList.toggle('open'));
$('#popupClose').addEventListener('click', closePopup);
$('#popup').addEventListener('click', (e) => { if (e.target.id === 'popup') closePopup(); });

if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {})); }

/* Ask the browser to keep this app's storage (offline dataset + photo
   cache) persistent, so Android does not evict it under storage pressure. */
if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(() => {}); }

initApp();
