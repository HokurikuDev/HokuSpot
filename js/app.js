// ============================================================================
// app.js — Entry point. Boots category cache, map, and auth-driven UI.
// ============================================================================

(async function main() {
  await Categories.load();

  MapController.init({
    container: 'map',
    onPlaceClickCallback: (placeId) => UI.openPlaceDetail(placeId),
  });

  renderCategoryFilters();
  UI.initCoordSearch();
  await UI.refreshAuthUI();
  observeTopBarHeight();

  Api.onAuthChange(() => {
    UI.refreshAuthUI();
  });

  document.getElementById('btn-close-detail-outer')?.addEventListener('click', UI.closePlaceDetail);
})();

// Keep MapLibre's own top-right controls (zoom, compass, geolocate) below
// the floating header at all times. The header's height isn't fixed — it
// wraps to two lines once the auth pill + coord-search button no longer
// fit on one row (narrow screens, long display names) — so we measure the
// real rendered box instead of guessing a static offset in CSS.
function observeTopBarHeight() {
  const bar = document.getElementById('top-bar');
  if (!bar || typeof ResizeObserver === 'undefined') return;

  const apply = () => {
    document.documentElement.style.setProperty('--top-bar-height', `${bar.offsetHeight}px`);
  };

  new ResizeObserver(apply).observe(bar);
  apply();
}

function renderCategoryFilters() {
  const bar = document.getElementById('category-filters');
  if (!bar) return;

  const cats = Categories.all();
  bar.innerHTML = `
    <button class="filter-chip is-active" data-cat="">All</button>
    ${cats.map((c) => `
      <button class="filter-chip" data-cat="${c.id}" style="--chip-color:${c.color}">
        ${escapeHtmlLocal(c.label_en)}
      </button>`).join('')}
  `;

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-chip');
    if (!btn) return;
    bar.querySelectorAll('.filter-chip').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    MapController.setCategoryFilter(btn.dataset.cat || null);
  });
}

function escapeHtmlLocal(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
