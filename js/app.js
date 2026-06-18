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
  await UI.refreshAuthUI();

  Api.onAuthChange(() => {
    UI.refreshAuthUI();
  });

  document.getElementById('btn-close-detail-outer')?.addEventListener('click', UI.closePlaceDetail);
})();

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
