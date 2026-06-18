// ============================================================================
// categories.js — Category metadata cache.
//
// Categories are stored in the database (public.categories) so the fixed
// list can be edited via SQL without a frontend redeploy. This module loads
// them once at startup and exposes synchronous lookups for the rest of the
// app. A hardcoded FALLBACK mirrors sql/01_schema.sql's seed values in case
// the network/database is briefly unavailable on first paint.
// ============================================================================

const Categories = (() => {
  const FALLBACK = [
    { id: 'tourist',  label_en: 'Tourist Spot',       color: '#3B7A57', icon: 'landmark',  sort_order: 1 },
    { id: 'haikyo',   label_en: 'Abandoned Place',     color: '#8B5E3C', icon: 'door-open', sort_order: 2 },
    { id: 'road',     label_en: 'Interesting Road',    color: '#4A6FA5', icon: 'route',     sort_order: 3 },
    { id: 'nature',   label_en: 'Nature / Viewpoint',  color: '#5C8A3A', icon: 'mountain',  sort_order: 4 },
    { id: 'food',     label_en: 'Food / Drink',        color: '#C9622A', icon: 'utensils',  sort_order: 5 },
    { id: 'historic', label_en: 'Historic Site',       color: '#7A6A53', icon: 'scroll',    sort_order: 6 },
    { id: 'onsen',    label_en: 'Onsen / Bath',        color: '#B5483D', icon: 'droplet',   sort_order: 7 },
    { id: 'other',    label_en: 'Other',               color: '#6B7280', icon: 'pin',       sort_order: 8 },
  ];

  let cache = new Map(FALLBACK.map((c) => [c.id, c]));
  let loaded = false;

  async function load() {
    try {
      const rows = await Api.getCategories();
      if (rows && rows.length > 0) {
        cache = new Map(rows.map((c) => [c.id, c]));
      }
    } catch (err) {
      console.warn('Falling back to built-in category list:', err.message);
    } finally {
      // Mark the load attempt as complete whether it succeeded or fell
      // back — "loaded" means "we tried", not "the network call succeeded".
      loaded = true;
    }
    return all();
  }

  function all() {
    return [...cache.values()].sort((a, b) => a.sort_order - b.sort_order);
  }

  function get(id) {
    return cache.get(id) || cache.get('other');
  }

  function isLoaded() {
    return loaded;
  }

  return { load, all, get, isLoaded };
})();
