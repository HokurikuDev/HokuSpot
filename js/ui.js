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
        <button id="btn-my-submissions" class="btn btn--ghost">My submissions</button>
        ${currentProfile.role !== 'user' ? '<button id="btn-moderate" class="btn btn--ghost">Review queue</button>' : ''}
        <button id="btn-sign-out" class="btn btn--ghost">Sign out</button>
      `;
      $('#btn-add-place')?.addEventListener('click', openSubmissionForm);
      $('#btn-my-submissions')?.addEventListener('click', openMySubmissions);
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
  // Coordinate search — "Go to coordinates" button in the header opens a
  // small popover with lat/lng inputs and flies the map there. No place
  // lookup involved; this is pure map navigation, available whether or
  // not anyone is signed in. A temporary marker is dropped at the target
  // point so it's visually clear where the search landed, and is cleared
  // the next time the popover opens or a new search runs.
  // -------------------------------------------------------------------
  let coordSearchMarker = null;

  function initCoordSearch() {
    const btn = $('#btn-coord-search');
    const popover = $('#coord-search-popover');
    if (!btn || !popover) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !popover.hidden;
      if (isOpen) {
        closeCoordPopover();
      } else {
        openCoordPopover();
      }
    });

    document.addEventListener('click', (e) => {
      if (!popover.hidden && !popover.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        closeCoordPopover();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !popover.hidden) closeCoordPopover();
    });
  }

  function openCoordPopover() {
    const popover = $('#coord-search-popover');
    popover.innerHTML = `
      <form id="form-coord-search" class="stack">
        <label>Latitude
          <input type="number" name="lat" step="any" placeholder="e.g. 36.8047" required />
        </label>
        <label>Longitude
          <input type="number" name="lng" step="any" placeholder="e.g. 136.9077" required />
        </label>
        <p class="form-error" id="coord-search-error" hidden></p>
        <button type="submit" class="btn btn--accent btn--block btn--small">Go</button>
      </form>
    `;
    popover.hidden = false;
    $('#form-coord-search input[name="lat"]').focus();

    $('#form-coord-search').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const lat = parseFloat(fd.get('lat'));
      const lng = parseFloat(fd.get('lng'));
      const errEl = $('#coord-search-error');
      errEl.hidden = true;

      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        errEl.textContent = 'Enter both latitude and longitude as numbers.';
        errEl.hidden = false;
        return;
      }
      if (lat < -90 || lat > 90) {
        errEl.textContent = 'Latitude must be between -90 and 90.';
        errEl.hidden = false;
        return;
      }
      if (lng < -180 || lng > 180) {
        errEl.textContent = 'Longitude must be between -180 and 180.';
        errEl.hidden = false;
        return;
      }

      goToCoordinates(lat, lng);
      closeCoordPopover();
    });
  }

  function closeCoordPopover() {
    const popover = $('#coord-search-popover');
    if (popover) {
      popover.hidden = true;
      popover.innerHTML = '';
    }
  }

  function goToCoordinates(lat, lng) {
    const map = MapController.getMap();

    if (coordSearchMarker) {
      coordSearchMarker.remove();
      coordSearchMarker = null;
    }

    const el = document.createElement('div');
    el.className = 'coord-search-marker';
    coordSearchMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map);

    MapController.flyTo(lng, lat, 14);
    showToast(`Jumped to ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
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
          ${currentProfile && currentProfile.role !== 'user'
            ? '<button class="btn btn--ghost btn--small" id="btn-edit-place">Edit</button>'
            : ''}
          <button class="btn btn--ghost btn--small" id="btn-report">Report an issue</button>
        </div>
      </div>
    `;

    $('#btn-close-detail').addEventListener('click', closePlaceDetail);
    $('#btn-directions').addEventListener('click', () => {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`, '_blank', 'noopener');
    });
    $('#btn-report').addEventListener('click', () => openReportForm(place.id));
    $('#btn-edit-place')?.addEventListener('click', () => {
      closePlaceDetail();
      openEditForm(place);
    });

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
  // Submission / edit form — shared by THREE entry points:
  //   1. "+ Add a place"            -> openSubmissionForm()        (create)
  //   2. "My submissions" list      -> openEditForm(place, 'own')  (edit own pending)
  //   3. Detail panel "Edit" button -> openEditForm(place, 'mod')  (moderator edit any place)
  //
  // The form itself doesn't enforce who can do what — RLS does that (see
  // sql/02_policies.sql). This function only decides what to pre-fill and
  // which Api call to make on submit.
  //
  // It opens in its own slide-in panel (#submit-panel, same pattern as
  // #detail-panel) rather than the full-screen modal the very first
  // version used — that modal completely covered the map, which made
  // "click the map to drop a pin" impossible. Pin placement is delegated
  // to MapController.startPinPicker(), which owns a single click listener
  // and a visible marker for the chosen point.
  // -------------------------------------------------------------------
  let pendingPin = null; // { lat, lng } — current chosen location, create or edit
  let existingPhotos = []; // photos already on the place, when editing

  function openSubmissionForm() {
    renderSubmitPanel({ mode: 'create' });
  }

  function openEditForm(place) {
    renderSubmitPanel({ mode: 'edit', place });
  }

  function renderSubmitPanel({ mode, place = null }) {
    const cats = Categories.all();
    const panel = $('#submit-panel');
    const isEdit = mode === 'edit';

    pendingPin = isEdit ? { lat: place.lat, lng: place.lng } : null;
    existingPhotos = isEdit ? [...(place.place_photos || [])].sort((a, b) => a.sort_order - b.sort_order) : [];
    const currentTags = isEdit ? (place.place_tags || []).map((pt) => pt.tags?.label).filter(Boolean) : [];

    const pinReadoutText = pendingPin
      ? `Pinned at ${pendingPin.lat.toFixed(5)}, ${pendingPin.lng.toFixed(5)}`
      : 'No location chosen yet';

    panel.innerHTML = `
      <div class="submit-panel__header">
        <h2>${isEdit ? 'Edit place' : 'Add a place'}</h2>
        <button class="modal__close" id="btn-close-submit" aria-label="Close">&times;</button>
      </div>
      <div class="submit-panel__body">
        <form id="form-submit" class="stack">
          <label>Name <input type="text" name="name" required maxlength="120" value="${escapeHtml(place?.name || '')}" /></label>
          <label>Category
            <select name="categoryId" required>
              ${cats.map((c) => `<option value="${c.id}" ${place?.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.label_en)}</option>`).join('')}
            </select>
          </label>
          <div class="pin-picker">
            <p class="form-hint">Click anywhere on the map to drop a pin at the location. Click again to move it.</p>
            <p id="pin-readout" class="pin-readout ${pendingPin ? 'is-set' : ''}">${pinReadoutText}</p>
          </div>
          <label>Address <input type="text" name="address" maxlength="200" placeholder="Optional — helps others find it" value="${escapeHtml(place?.address || '')}" /></label>
          <label>Description <textarea name="description" rows="3" maxlength="1000">${escapeHtml(place?.description || '')}</textarea></label>
          <label>What's interesting about it? <textarea name="highlights" rows="3" maxlength="1000" placeholder="History, access notes, best time to visit…">${escapeHtml(place?.highlights || '')}</textarea></label>
          <label>Tags <input type="text" name="tags" placeholder="comma, separated, tags" value="${escapeHtml(currentTags.join(', '))}" /></label>
          ${isEdit && existingPhotos.length > 0 ? `
            <div class="existing-photos">
              <p class="form-hint">Current photos — remove any you don't want to keep:</p>
              <div id="existing-photo-list" class="existing-photo-list">
                ${existingPhotos.map((p) => `
                  <div class="existing-photo" data-photo-id="${p.id}">
                    <img src="${escapeHtml(p.storage_path ? Api.getPhotoPublicUrl(p.storage_path) : p.external_url)}" alt="" />
                    <button type="button" class="existing-photo__remove" data-photo-id="${p.id}" aria-label="Remove photo">&times;</button>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          <label>${isEdit ? 'Add a photo URL' : 'Photo URL'} <input type="url" name="photoUrl" placeholder="https://… (optional)" /></label>
          <label>${isEdit ? 'Or upload an additional photo' : 'Or upload a photo'} <input type="file" name="photoFile" accept="image/jpeg,image/png,image/webp" /></label>
          <p class="form-error" id="submit-error" hidden></p>
          ${isEdit
            ? `<p class="form-hint">${place.status === 'pending' ? 'Saving will keep this submission pending review.' : 'This place is already live — changes will be visible immediately.'}</p>`
            : `<p class="form-hint">Your submission goes to a moderator for review before it appears on the public map.</p>`}
          <button type="submit" class="btn btn--accent btn--block">${isEdit ? 'Save changes' : 'Submit for review'}</button>
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
    }, pendingPin);

    $('#btn-close-submit').addEventListener('click', closeSubmissionForm);

    if (isEdit) {
      $all('.existing-photo__remove').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const photoId = btn.dataset.photoId;
          btn.disabled = true;
          try {
            await Api.removePhotoFromPlace(photoId);
            $(`.existing-photo[data-photo-id="${photoId}"]`)?.remove();
            existingPhotos = existingPhotos.filter((p) => p.id !== photoId);
          } catch (err) {
            showToast(`Couldn't remove photo: ${err.message}`, true);
            btn.disabled = false;
          }
        });
      });
    }

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
      const newPhotos = [];
      const photoUrl = fd.get('photoUrl');
      const photoFile = fd.get('photoFile');
      if (photoUrl) newPhotos.push({ externalUrl: photoUrl });
      if (photoFile && photoFile.size > 0) newPhotos.push({ file: photoFile });

      try {
        if (isEdit) {
          await Api.updatePlace(place.id, {
            name: fd.get('name'),
            description: fd.get('description') || null,
            highlights: fd.get('highlights') || null,
            address: fd.get('address') || null,
            categoryId: fd.get('categoryId'),
            lat: pendingPin.lat,
            lng: pendingPin.lng,
            tagLabels,
            newPhotos,
          });
          closeSubmissionForm();
          showToast('Changes saved.');
          if (place.status === 'approved') {
            MapController.refreshPlacesInView();
          }
        } else {
          await Api.submitPlace({
            name: fd.get('name'),
            description: fd.get('description') || null,
            highlights: fd.get('highlights') || null,
            address: fd.get('address') || null,
            categoryId: fd.get('categoryId'),
            lat: pendingPin.lat,
            lng: pendingPin.lng,
            tagLabels,
            photos: newPhotos,
          });
          closeSubmissionForm();
          showToast('Submitted! It will appear once a moderator approves it.');
        }
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
    existingPhotos = [];
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
  // My submissions — lets a user see the status of everything they've
  // submitted and edit anything still pending (RLS only allows editing
  // while status='pending', so approved/rejected rows are shown read-only
  // here; editing an already-approved place is a moderator-only action,
  // done from the place detail panel's "Edit" button instead).
  // -------------------------------------------------------------------
  async function openMySubmissions() {
    openModal(`<div id="my-submissions" class="panel-loading">Loading your submissions…</div>`, { title: 'My submissions', wide: true });
    try {
      const mine = await Api.getMySubmissions();
      renderMySubmissions(mine);
    } catch (err) {
      $('#my-submissions').innerHTML = `<div class="panel-error">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderMySubmissions(mine) {
    const root = $('#my-submissions');
    if (mine.length === 0) {
      root.innerHTML = `<p class="empty-state">You haven't submitted any places yet.</p>`;
      return;
    }

    const statusLabel = { pending: 'Pending review', approved: 'Live on map', rejected: 'Not approved' };

    root.innerHTML = `<ul class="mod-list">${mine.map((p) => `
      <li class="mod-item" data-id="${p.id}">
        <div class="mod-item__info">
          <strong>${escapeHtml(p.name)}</strong>
          <span class="mod-item__meta">
            ${escapeHtml(Categories.get(p.category_id).label_en)} ·
            <span class="status-pill status-pill--${p.status}">${escapeHtml(statusLabel[p.status] || p.status)}</span>
          </span>
          ${p.status === 'rejected' && p.rejection_reason ? `<p class="rejection-reason">Reason: ${escapeHtml(p.rejection_reason)}</p>` : ''}
        </div>
        <div class="mod-item__actions">
          ${p.status === 'pending' ? '<button class="btn btn--small btn--accent" data-action="edit">Edit</button>' : ''}
        </div>
      </li>`).join('')}</ul>`;

    root.addEventListener('click', async (e) => {
      if (e.target.dataset.action !== 'edit') return;
      const placeId = e.target.closest('.mod-item').dataset.id;
      try {
        const place = await Api.getPlaceDetail(placeId);
        closeModal();
        openEditForm(place);
      } catch (err) {
        showToast(`Couldn't open this place for editing: ${err.message}`, true);
      }
    });
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
    initCoordSearch,
    showToast,
  };
})();
