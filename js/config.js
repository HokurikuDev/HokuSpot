// ============================================================================
// config.js — Single source of truth for app-wide configuration.
//
// IMPORTANT: The Supabase URL and ANON key below are MEANT to be public.
// They are safe to commit and ship in client-side JS. Security is enforced
// entirely by the Row-Level Security policies in sql/02_policies.sql, not
// by hiding this key. Never put a Supabase SERVICE ROLE key here — that one
// must never appear in any file shipped to a browser.
// ============================================================================

const CONFIG = {
  // --- Supabase ---------------------------------------------------------
  // Project URL is the bare project domain — the Supabase JS client appends
  // /rest/v1/, /auth/v1/, etc. itself, so don't include any path suffix here.
  SUPABASE_URL: 'https://jmlypmsxrdhooxhpdfsg.supabase.co',
  // This is the new-format "publishable" key (sb_publishable_...), Supabase's
  // direct replacement for the old anon key — same low-privilege role, same
  // RLS enforcement. Safe to ship in client code. NEVER put a sb_secret_...
  // key here; that one bypasses Row-Level Security entirely.
  SUPABASE_ANON_KEY: 'sb_publishable_oA_VkjQ3m4ozwZKEL6aExQ_SI6xovcU',

  // --- MapTiler -----------------------------------------------------------
  // Free tier key from https://cloud.maptiler.com/account/keys/
  // This key IS visible to anyone viewing the page source — that's normal
  // for MapTiler's client-side usage model. Restrict it to your GitHub
  // Pages domain in the MapTiler dashboard to prevent quota theft.
  MAPTILER_KEY: 'puMORbf8chI5eyoSvAzH',

  // --- Map defaults ---------------------------------------------------------
  // Centered roughly between Hakui and Toyama City, framing both areas.
  MAP_CENTER: [136.95, 36.80],
  MAP_DEFAULT_ZOOM: 9.2,
  MAP_MIN_ZOOM: 7,
  MAP_MAX_ZOOM: 18,

  // Rough bounding box covering Hakui (Ishikawa) + Toyama Prefecture.
  // Used to gently constrain panning and for "reset view" button.
  // [west, south, east, north]
  REGION_BOUNDS: [136.20, 36.25, 137.80, 37.10],

  // Category and tag display is sourced from the database (public.categories)
  // at runtime so the fixed list can be edited via SQL without redeploying
  // the frontend — see js/categories.js for the fetch + fallback.
};

// Freeze to catch accidental mutation elsewhere in the app during development.
Object.freeze(CONFIG);
