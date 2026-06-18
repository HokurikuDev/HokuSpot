// ============================================================================
// ui.js — DOM rendering and event wiring for all non-map UI: auth panel,
// place detail card, submission form, and the moderation queue.
//
// Kept deliberately framework-free (vanilla DOM) since the whole app is a
// handful of views — a build step would add complexity without benefit
// for a static GitHub Pages deployment.
// ============================================================================

const UI = (() => {
  let currentProfile = null;

  function $(sel, root = document) {
    return root.querySelector(sel);
  }
  function $all(sel, root = document) {
    return [...root.querySelectorAll(sel)];
  }
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  // -------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------
  async function refreshAuthUI() {
    const session = await Api.getSession();
    currentProfile = session ? await Api.getMyProfile() : null;

    const authArea = $('#auth-area');
    if (!authArea) return;

    if (currentProfile) {
      authArea.innerHTML = `
        <span class="user-pill">
          <span class="user-pill__name">${escapeHtml(currentProfile.display_name)}</span>
          ${currentProfile.role !== 'user' ? `<span class="role-badge">${escapeHtml(currentProfile.role)}</span>` : ''}
        </span>
        <button id="btn-add-place" class="btn btn--accent">+ Add a place</button>
        ${currentProfile.role !== 'user' ? '<button id="btn-moderate" class="btn btn--ghost">Review queue</button>' : ''}
        <button id="btn-sign-out" class="btn btn--ghost">Sign out</button>
      `;
      $('#btn-add-place')?.addEventListener('click', openSubmissionForm);
      $('#btn-sign-out')?.addEventListener('click', async () => {
        await Api.signOut();
        await refreshAuthUI();
      });
      $('#btn-moderate')?.addEventListener('click', openModerationQueue);
    } else {
      authArea.innerHTML = `<button id="btn-sign-in" class="btn btn--accent">Sign in</button>`;
      $('#btn-sign-in')?.addEventListener('click', openAuthModal);
    }
  }

  function openAuthModal() {
    openModal(`
      <div class="auth-tabs">
        <button class="auth-tab is-active" data-tab="signin">Sign in</button>
        <button class="auth-tab" data-tab="signup">Create account</button>
      </div>
      <form id="form-signin" class="stack">
        <label>Email <input type="email" name="email" required autocomplete="email" /></label>
        <label>Password <input type="password" name="password" required autocomplete="current-password" /></label>
        <p class="form-error" id="signin-error" hidden></p>
        <button type="submit" class="btn btn--accent btn--block">Sign in</button>
      </form>
      <form id="form-signup" class="stack" hidden>
        <label>Display name <input type="text" name="displayName" required maxlength="40" /></label>
        <label>Email <input type="email" name="email" required autocomplete="email" /></label>
        <label>Password <input type="password" name="password" required minlength="8" autocomplete="new-password" /></label>
        <p class="form-hint">At least 8 characters.</p>
        <p class="form-error" id="signup-error" hidden></p>
        <button type="submit" class="btn btn--accent btn--block">Create account</button>
      </form>
    `, { title: 'Welcome' });

    $all('.auth-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $all('.auth-tab').forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        $('#form-signin').hidden = tab.dataset.tab !== 'signin';
        $('#form-signup').hidden = tab.dataset.tab !== 'signup';
      });
    });

    $('#form-signin').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = $('#signin-error');
      errEl.hidden = true;
      try {
        await Api.signIn(fd.get('email'), fd.get('password'));
        closeModal();
        await refreshAuthUI();
      } catch (err) {
        errEl.textContent = friendlyAuthError(err);
        errEl.hidden = false;
      }
    });

    $('#form-signup').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = $('#signup-error');
      errEl.hidden = true;
      try {
        await Api.signUp(fd.get('email'), fd.get('password'), fd.get('displayName'));
        closeModal();
        showToast('Account created. Check your email to confirm, then sign in.');
      } catch (err) {
        errEl.textContent = friendlyAuthError(err);
        errEl.hidden = false;
      }
    });
  }

  function friendlyAuthError(err) {
    const msg = err?.message || 'Something went wrong. Try again.';
    if (/already registered/i.test(msg)) return 'That email is already registered — try signing in instead.';
    if (/invalid login/i.test(msg)) return 'Incorrect email or password.';
    return msg;
  }

  // -------------------------------------------------------------------
  // Place detail card (Google Maps-style)
  // -------------------------------------------------------------------
  async function openPlaceDetail(placeId) {
    const panel = $('#detail-panel');
    panel.classList.add('is-open');
    panel.innerHTML = `<div class="panel-loading">Loading place…</div>`;

    try {
      const place = await Api.getPlaceDetail(placeId);
      renderPlaceDetail(place);
    } catch (err) {
      panel.innerHTML = `<div class="panel-error">Couldn't load this place. ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderPlaceDetail(place) {
    const panel = $('#detail-panel');
    const cat = Categories.get(place.category_id);
    const tags = (place.place_tags || []).map((pt) => pt.tags?.label).filter(Boolean);
    const photos = (place.place_photos || []).sort((a, b) => a.sort_order - b.sort_order);

    const photoHtml = photos.length
      ? `<div class="photo-strip">
          ${photos.map((p) => {
            const url = p.storage_path ? Api.getPhotoPublicUrl(p.storage_path) : p.external_url;
            return `<img src="${escapeHtml(url)}" alt="${escapeHtml(p.caption || place.name)}" loading="lazy" />`;
          }).join('')}
        </div>`
      : `<div class="photo-strip photo-strip--empty">No photos yet</div>`;

    panel.innerHTML = `
      <button class="panel-close" id="btn-close-detail" aria-label="Close">&times;</button>
      ${photoHtml}
      <div class="panel-body">
        <span class="category-chip" style="--chip-color: ${cat.color}">${escapeHtml(cat.label_en)}</span>
        <h2 class="place-title">${escapeHtml(place.name)}${place.featured ? ' <span class="featured-star" title="Featured">★</span>' : ''}</h2>
        ${place.address ? `<p class="place-address">${escapeHtml(place.address)}</p>` : ''}
        ${place.description ? `<p class="place-description">${escapeHtml(place.description)}</p>` : ''}
        ${place.highlights ? `<div class="place-highlights"><h3>Worth knowing</h3><p>${escapeHtml(place.highlights)}</p></div>` : ''}
        ${tags.length ? `<div class="tag-list">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="panel-actions">
          <button class="btn btn--ghost btn--small" id="btn-directions">Directions</button>
          <button class="btn btn--ghost btn--small" id="btn-report">Report an issue</button>
        </div>
      </div>
    `;

    $('#btn-close-detail').addEventListener('click', closePlaceDetail);
    $('#btn-directions').addEventListener('click', () => {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`, '_blank', 'noopener');
    });
    $('#btn-report').addEventListener('click', () => openReportForm(place.id));

    MapController.flyTo(place.lng, place.lat);
  }

  function closePlaceDetail() {
    $('#detail-panel').classList.remove('is-open');
  }

  function openReportForm(placeId) {
    openModal(`
      <form id="form-report" class="stack">
        <label>What's wrong with this place? <textarea name="reason" required maxlength="500" rows="4"></textarea></label>
        <p class="form-error" id="report-error" hidden></p>
        <button type="submit" class="btn btn--accent btn--block">Submit report</button>
      </form>
    `, { title: 'Report an issue' });

    $('#form-report').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await Api.reportPlace(placeId, fd.get('reason'));
        closeModal();
        showToast('Thanks — a moderator will take a look.');
      } catch (err) {
        const errEl = $('#report-error');
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });
  }

  // -------------------------------------------------------------------
  // Submission form
  //
  // This used to open inside the full-screen modal (#modal-root), which
  // covers the entire viewport including the map — so "click the map to
  // drop a pin" was never actually possible; the click had nowhere to
  // land but the modal backdrop. It now opens in its own slide-in panel
  // (#submit-panel, same pattern as #detail-panel) that leaves the map
  // visible and clickable beside it. Pin placement itself is delegated to
  // MapController.startPinPicker(), which owns a single click listener
  // and a visible marker for the chosen point.
  // -------------------------------------------------------------------
  let pendingPin = null; // { lat, lng } chosen via map click while the panel is open

  function openSubmissionForm() {
    const cats = Categories.all();
    const panel = $('#submit-panel');
    pendingPin = null;

    panel.innerHTML = `
      <div class="submit-panel__header">
        <h2>Add a place</h2>
        <button class="modal__close" id="btn-close-submit" aria-label="Close">&times;</button>
      </div>
      <div class="submit-panel__body">
        <form id="form-submit" class="stack">
          <label>Name <input type="text" name="name" required maxlength="120" /></label>
          <label>Category
            <select name="categoryId" required>
              ${cats.map((c) => `<option value="${c.id}">${escapeHtml(c.label_en)}</option>`).join('')}
            </select>
          </label>
          <div class="pin-picker">
            <p class="form-hint">Click anywhere on the map to drop a pin at the location. Click again to move it.</p>
            <p id="pin-readout" class="pin-readout">No location chosen yet</p>
          </div>
          <label>Address <input type="text" name="address" maxlength="200" placeholder="Optional — helps others find it" /></label>
          <label>Description <textarea name="description" rows="3" maxlength="1000"></textarea></label>
          <label>What's interesting about it? <textarea name="highlights" rows="3" maxlength="1000" placeholder="History, access notes, best time to visit…"></textarea></label>
          <label>Tags <input type="text" name="tags" placeholder="comma, separated, tags" /></label>
          <label>Photo URL <input type="url" name="photoUrl" placeholder="https://… (optional)" /></label>
          <label>Or upload a photo <input type="file" name="photoFile" accept="image/jpeg,image/png,image/webp" /></label>
          <p class="form-error" id="submit-error" hidden></p>
          <p class="form-hint">Your submission goes to a moderator for review before it appears on the public map.</p>
          <button type="submit" class="btn btn--accent btn--block">Submit for review</button>
        </form>
      </div>
    `;
    panel.classList.add('is-open');

    MapController.startPinPicker(({ lat, lng }) => {
      pendingPin = { lat, lng };
      const readout = $('#pin-readout');
      if (readout) {
        readout.textContent = `Pinned at ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        readout.classList.add('is-set');
      }
    });

    $('#btn-close-submit').addEventListener('click', closeSubmissionForm);

    $('#form-submit').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('#submit-error');
      errEl.hidden = true;

      if (!pendingPin) {
        errEl.textContent = 'Click the map to choose a location first.';
        errEl.hidden = false;
        return;
      }

      const fd = new FormData(e.target);
      const tagLabels = (fd.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean);
      const photos = [];
      const photoUrl = fd.get('photoUrl');
      const photoFile = fd.get('photoFile');
      if (photoUrl) photos.push({ externalUrl: photoUrl });
      if (photoFile && photoFile.size > 0) photos.push({ file: photoFile });

      try {
        await Api.submitPlace({
          name: fd.get('name'),
          description: fd.get('description') || null,
          highlights: fd.get('highlights') || null,
          address: fd.get('address') || null,
          categoryId: fd.get('categoryId'),
          lat: pendingPin.lat,
          lng: pendingPin.lng,
          tagLabels,
          photos,
        });
        closeSubmissionForm();
        showToast('Submitted! It will appear once a moderator approves it.');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });
  }

  function closeSubmissionForm() {
    $('#submit-panel').classList.remove('is-open');
    MapController.stopPinPicker();
    pendingPin = null;
  }

  // -------------------------------------------------------------------
  // Moderation queue
  // -------------------------------------------------------------------
  async function openModerationQueue() {
    openModal(`<div id="mod-queue" class="panel-loading">Loading pending submissions…</div>`, { title: 'Review queue', wide: true });
    try {
      const pending = await Api.getPendingPlaces();
      renderModerationQueue(pending);
    } catch (err) {
      $('#mod-queue').innerHTML = `<div class="panel-error">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderModerationQueue(pending) {
    const root = $('#mod-queue');
    if (pending.length === 0) {
      root.innerHTML = `<p class="empty-state">Nothing waiting for review.</p>`;
      return;
    }
    root.innerHTML = `<ul class="mod-list">${pending.map((p) => `
      <li class="mod-item" data-id="${p.id}">
        <div class="mod-item__info">
          <strong>${escapeHtml(p.name)}</strong>
          <span class="mod-item__meta">${escapeHtml(Categories.get(p.category_id).label_en)} · submitted by ${escapeHtml(p.profiles?.display_name || 'unknown')}</span>
          ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}
        </div>
        <div class="mod-item__actions">
          <button class="btn btn--small btn--accent" data-action="approve">Approve</button>
          <button class="btn btn--small btn--ghost" data-action="feature">Approve &amp; feature</button>
          <button class="btn btn--small btn--danger" data-action="reject">Reject</button>
        </div>
      </li>`).join('')}</ul>`;

    root.addEventListener('click', async (e) => {
      const action = e.target.dataset.action;
      if (!action) return;
      const item = e.target.closest('.mod-item');
      const placeId = item.dataset.id;

      try {
        if (action === 'approve') {
          await Api.approvePlace(placeId);
        } else if (action === 'feature') {
          await Api.approvePlace(placeId);
          await Api.setFeatured(placeId, true);
        } else if (action === 'reject') {
          const reason = prompt('Reason for rejection (shown to the submitter):') || 'Not specified';
          await Api.rejectPlace(placeId, reason);
        }
        item.remove();
        MapController.refreshPlacesInView();
        if (!root.querySelector('.mod-item')) {
          root.innerHTML = `<p class="empty-state">Nothing waiting for review.</p>`;
        }
      } catch (err) {
        showToast(`Error: ${err.message}`, true);
      }
    }, { once: false });
  }

  // -------------------------------------------------------------------
  // Modal / toast primitives
  // -------------------------------------------------------------------
  let onModalClose = null;

  function openModal(innerHtml, { title = '', wide = false, onClose = null } = {}) {
    onModalClose = onClose;
    const root = $('#modal-root');
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal ${wide ? 'modal--wide' : ''}">
          <div class="modal__header">
            <h2>${escapeHtml(title)}</h2>
            <button class="modal__close" id="btn-modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="modal__body">${innerHtml}</div>
        </div>
      </div>
    `;
    root.classList.add('is-open');
    $('#btn-modal-close').addEventListener('click', closeModal);
    $('.modal-backdrop').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) closeModal();
    });
  }

  function closeModal() {
    const root = $('#modal-root');
    root.classList.remove('is-open');
    root.innerHTML = '';
    if (onModalClose) onModalClose();
    onModalClose = null;
  }

  function showToast(message, isError = false) {
    const root = $('#toast-root');
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'toast--error' : ''}`;
    toast.textContent = message;
    root.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  return {
    refreshAuthUI,
    openPlaceDetail,
    closePlaceDetail,
    openSubmissionForm,
    openModerationQueue,
    showToast,
  };
})();
