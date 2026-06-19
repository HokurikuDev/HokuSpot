// ============================================================================
// map.js — MapLibre GL map controller.
//
// Owns the map instance, marker rendering, and the bounds-based data fetch.
// Markers are rendered via a GeoJSON source + MapLibre's built-in clustering
// (not one DOM marker per place) so the map stays smooth with hundreds of
// rural pins without per-marker DOM overhead.
// ============================================================================

const MapController = (() => {
  let map;
  let onPlaceClick = () => {};
  let activePopup = null;
  let activeCategoryFilter = null; // null = show all categories

  function init({ container, onPlaceClickCallback }) {
    onPlaceClick = onPlaceClickCallback || onPlaceClick;

    map = new maplibregl.Map({
      container,
      style: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${CONFIG.MAPTILER_KEY}`,
      center: CONFIG.MAP_CENTER,
      zoom: CONFIG.MAP_DEFAULT_ZOOM,
      minZoom: CONFIG.MAP_MIN_ZOOM,
      maxZoom: CONFIG.MAP_MAX_ZOOM,
      maxBounds: padBounds(CONFIG.REGION_BOUNDS, 0.6),
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    // High accuracy with no timeout makes the browser hold out for a
    // GPS-grade fix that desktops/laptops (no GPS chip) often never get —
    // the request then errors out with POSITION_UNAVAILABLE, and because
    // trackUserLocation keeps retrying the same options, MapLibre's button
    // gets stuck showing its crossed-out error icon permanently. A timeout
    // lets it fall back to network/Wi-Fi-based positioning instead.
    const geolocateControl = new maplibregl.GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000,
      },
      trackUserLocation: true,
      showUserLocation: true,
      fitBoundsOptions: { maxZoom: 15 },
    });
    geolocateControl.on('error', (err) => {
      console.warn('Geolocation failed:', err?.message || err);
    });
    map.addControl(geolocateControl, 'top-right');

    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      setupPlacesLayer();
      refreshPlacesInView();
    });

    // Re-fetch places when the viewport changes meaningfully (debounced)
    // rather than on every pixel of pan/zoom, to avoid hammering the API.
    map.on('moveend', debounce(refreshPlacesInView, 350));

    return map;
  }

  function padBounds([w, s, e, n], padFactor) {
    const padLng = (e - w) * padFactor;
    const padLat = (n - s) * padFactor;
    return [w - padLng, s - padLat, e + padLng, n + padLat];
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function setupPlacesLayer() {
    map.addSource('places', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 13,
      clusterRadius: 42,
    });

    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'places',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#1C2530',
        'circle-opacity': 0.88,
        'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 30, 26],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#F7F3EA',
      },
    });

    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'places',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': ['Noto Sans Bold'],
        'text-size': 13,
      },
      paint: { 'text-color': '#F7F3EA' },
    });

    map.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: 'places',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['case', ['get', 'featured'], 10, 8],
        'circle-stroke-width': ['case', ['get', 'featured'], 3, 2],
        'circle-stroke-color': ['case', ['get', 'featured'], '#C9A24B', '#F7F3EA'],
      },
    });

    map.on('click', 'clusters', (e) => {
      if (pinPickerHandler) return;
      const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
      const clusterId = features[0].properties.cluster_id;
      map.getSource('places').getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        map.easeTo({ center: features[0].geometry.coordinates, zoom });
      });
    });

    map.on('click', 'unclustered-point', (e) => {
      if (pinPickerHandler) return; // editing a pin right now — don't reopen the detail panel
      const props = e.features[0].properties;
      onPlaceClick(props.id);
    });

    map.on('mouseenter', 'unclustered-point', showHoverPopup);
    map.on('mouseleave', 'unclustered-point', () => {
      if (activePopup) {
        activePopup.remove();
        activePopup = null;
      }
    });
    ['clusters', 'unclustered-point'].forEach((layer) => {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    });
  }

  function showHoverPopup(e) {
    const props = e.features[0].properties;
    const coords = e.features[0].geometry.coordinates.slice();
    activePopup = new maplibregl.Popup({ closeButton: false, offset: 14, className: 'map-hover-popup' })
      .setLngLat(coords)
      .setHTML(`<strong>${escapeHtml(props.name)}</strong>`)
      .addTo(map);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function refreshPlacesInView() {
    if (!map) return;
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    try {
      const places = await Api.getApprovedPlacesInBounds(bbox);
      renderPlaces(places);
    } catch (err) {
      console.error('Failed to load places in view:', err);
    }
  }

  function renderPlaces(places) {
    const filtered = activeCategoryFilter
      ? places.filter((p) => p.category_id === activeCategoryFilter)
      : places;

    const features = filtered.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        name: p.name,
        category_id: p.category_id,
        color: Categories.get(p.category_id).color,
        featured: !!p.featured,
      },
    }));

    const source = map.getSource('places');
    if (source) {
      source.setData({ type: 'FeatureCollection', features });
    }
  }

  function setCategoryFilter(categoryId) {
    activeCategoryFilter = categoryId; // null clears the filter
    refreshPlacesInView();
  }

  function flyTo(lng, lat, zoom = 15) {
    map.flyTo({ center: [lng, lat], zoom, duration: 900 });
  }

  function getMap() {
    return map;
  }

  // -------------------------------------------------------------------
  // Pin-picker mode — used by the "Add a place" form to let someone
  // choose a location by clicking the map. Encapsulated here (rather than
  // ui.js attaching raw map click listeners directly) so there is exactly
  // one click handler active at a time, with a single clear lifecycle:
  // start -> (any number of clicks, each replacing the previous pin) ->
  // stop. A visible MapLibre Marker is shown at the chosen point so
  // clicking has obvious, immediate visual feedback.
  // -------------------------------------------------------------------
  let pinPickerHandler = null;
  let pinPickerMarker = null;

  function startPinPicker(onPick, initial = null) {
    stopPinPicker(); // guard against double-start leaving two listeners active

    map.getCanvas().style.cursor = 'crosshair';

    if (initial) {
      // Editing an existing place — show its current location right away
      // rather than waiting for the user to click, so the panel and map
      // agree on the starting point.
      const el = document.createElement('div');
      el.className = 'pin-picker-marker';
      pinPickerMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([initial.lng, initial.lat])
        .addTo(map);
    }

    pinPickerHandler = (e) => {
      const { lat, lng } = e.lngLat;

      if (pinPickerMarker) {
        pinPickerMarker.setLngLat([lng, lat]);
      } else {
        const el = document.createElement('div');
        el.className = 'pin-picker-marker';
        pinPickerMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([lng, lat])
          .addTo(map);
      }

      onPick({ lat, lng });
    };

    map.on('click', pinPickerHandler);
  }

  function stopPinPicker() {
    if (pinPickerHandler) {
      map.off('click', pinPickerHandler);
      pinPickerHandler = null;
    }
    if (pinPickerMarker) {
      pinPickerMarker.remove();
      pinPickerMarker = null;
    }
    if (map) map.getCanvas().style.cursor = '';
  }

  return {
    init, refreshPlacesInView, setCategoryFilter, flyTo, getMap,
    startPinPicker, stopPinPicker,
  };
})();
