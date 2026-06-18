// ============================================================================
// api.test.js — Functional tests for js/supabase-client.js's Api object.
//
// Run with: node test/api.test.js
// Loads the real browser script via vm so we're testing the actual file
// that ships to production, not a reimplementation of it.
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { createMockSupabase } = require('./mock-supabase');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok  - ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL  - ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

function loadApiWithMock(mockClient) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-client.js'), 'utf8');
  // supabase-client.js declares `const Api = {...}` at top level. Inside a
  // vm context, top-level const/let do NOT become properties of the
  // sandbox object (unlike var) — they live in a separate lexical
  // environment. We append an explicit assignment so the sandbox can see
  // it, without modifying the real source file.
  const wrapped = `${code}\nthis.__Api = Api;`;
  const sandbox = {
    window: { supabase: { createClient: () => mockClient } },
    CONFIG: { SUPABASE_URL: 'https://mock.test', SUPABASE_ANON_KEY: 'mock-key' },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox);
  return sandbox.__Api;
}

(async () => {
  console.log('\nApi.submitPlace ----------------------------------------------------');
  await test('forces status=pending and featured=false regardless of input', async () => {
    const mock = createMockSupabase();
    const Api = loadApiWithMock(mock);
    mock._setSession({ user: { id: 'u1', email: 'alice@test.com' } });

    const place = await Api.submitPlace({
      name: 'Test Spot',
      categoryId: 'tourist',
      lat: 36.5,
      lng: 137.0,
      tagLabels: [],
      photos: [],
    });

    assert.strictEqual(place.status, 'pending', 'status should default to pending');
    assert.strictEqual(place.featured, false, 'featured should default to false');
    assert.strictEqual(place.created_by, 'u1', 'created_by should be the current user');
  });

  await test('throws a clear error when not signed in', async () => {
    const mock = createMockSupabase();
    const Api = loadApiWithMock(mock);
    // no session set

    await assert.rejects(
      () => Api.submitPlace({ name: 'X', categoryId: 'tourist', lat: 1, lng: 1, tagLabels: [], photos: [] }),
      /must be signed in/i
    );
  });

  await test('creates and links tags without duplicating existing ones', async () => {
    const mock = createMockSupabase({ tags: [{ id: 1, label: 'sunset' }] });
    const Api = loadApiWithMock(mock);
    mock._setSession({ user: { id: 'u1', email: 'alice@test.com' } });

    await Api.submitPlace({
      name: 'Tagged Spot',
      categoryId: 'nature',
      lat: 36.5,
      lng: 137.0,
      tagLabels: ['sunset', 'Photography', '  free-entry  '],
      photos: [],
    });

    const tagLabels = mock._tables.tags.map((t) => t.label).sort();
    assert.deepStrictEqual(tagLabels, ['free-entry', 'photography', 'sunset'],
      'tags should be lowercased, trimmed, deduped, and existing tag reused not duplicated');
    assert.strictEqual(mock._tables.tags.filter((t) => t.label === 'sunset').length, 1,
      'existing "sunset" tag should not be duplicated');

    const linkCount = mock._tables.place_tags.length;
    assert.strictEqual(linkCount, 3, 'should create exactly 3 place_tags links');
  });

  await test('attaches both uploaded and external-URL photos correctly', async () => {
    const mock = createMockSupabase();
    const Api = loadApiWithMock(mock);
    mock._setSession({ user: { id: 'u1', email: 'alice@test.com' } });

    const fakeFile = { name: 'photo.jpg', type: 'image/jpeg', size: 1024 };

    await Api.submitPlace({
      name: 'Photo Spot',
      categoryId: 'haikyo',
      lat: 36.5,
      lng: 137.0,
      tagLabels: [],
      photos: [{ file: fakeFile, caption: 'uploaded' }, { externalUrl: 'https://example.com/a.jpg', caption: 'linked' }],
    });

    const photos = mock._tables.place_photos;
    assert.strictEqual(photos.length, 2, 'should insert 2 photo rows');

    const uploaded = photos.find((p) => p.caption === 'uploaded');
    const linked = photos.find((p) => p.caption === 'linked');
    assert.ok(uploaded.storage_path, 'uploaded photo should have a storage_path');
    assert.strictEqual(uploaded.external_url, undefined, 'uploaded photo should not have external_url');
    assert.strictEqual(linked.external_url, 'https://example.com/a.jpg', 'linked photo should keep its URL');
    assert.strictEqual(linked.storage_path, undefined, 'linked photo should not have a storage_path');

    assert.strictEqual(mock._storageFiles.length, 1, 'exactly one file should be uploaded to storage');
    assert.ok(mock._storageFiles[0].path.startsWith('u1/'), 'uploaded path should be namespaced under the user id (matches storage RLS policy expectation)');
  });

  console.log('\nApi.getPhotoPublicUrl -----------------------------------------------');
  await test('builds a public URL from a storage path', () => {
    const mock = createMockSupabase();
    const Api = loadApiWithMock(mock);
    const url = Api.getPhotoPublicUrl('u1/some-photo.jpg');
    assert.strictEqual(url, 'https://mock-storage.test/place-photos/u1/some-photo.jpg');
  });

  console.log('\nApi.getMyProfile ------------------------------------------------------');
  await test('returns null when logged out (no error thrown)', async () => {
    const mock = createMockSupabase();
    const Api = loadApiWithMock(mock);
    const profile = await Api.getMyProfile();
    assert.strictEqual(profile, null);
  });

  await test('returns the profile row when logged in', async () => {
    const mock = createMockSupabase({ profiles: [{ id: 'u1', display_name: 'Alice', role: 'user' }] });
    const Api = loadApiWithMock(mock);
    mock._setSession({ user: { id: 'u1', email: 'alice@test.com' } });
    const profile = await Api.getMyProfile();
    assert.strictEqual(profile.display_name, 'Alice');
  });

  console.log('\nApi.getApprovedPlacesInBounds ------------------------------------------');
  await test('passes bbox filters through as gte/lte on lat/lng', async () => {
    const mock = createMockSupabase({
      places: [
        { id: 'p1', name: 'In bounds', lat: 36.5, lng: 137.0, category_id: 'tourist', featured: false },
        { id: 'p2', name: 'Out of bounds', lat: 40.0, lng: 137.0, category_id: 'tourist', featured: false },
      ],
    });
    const Api = loadApiWithMock(mock);
    const results = await Api.getApprovedPlacesInBounds([136.0, 36.0, 138.0, 37.0]);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'In bounds');
  });

  console.log('\nApi.approvePlace / rejectPlace / setFeatured --------------------------');
  await test('approvePlace sets status and review metadata', async () => {
    const mock = createMockSupabase({ places: [{ id: 'p1', name: 'X', status: 'pending', featured: false }] });
    const Api = loadApiWithMock(mock);
    mock._setSession({ user: { id: 'mod1', email: 'mod@test.com' } });

    await Api.approvePlace('p1');
    const place = mock._tables.places.find((p) => p.id === 'p1');
    assert.strictEqual(place.status, 'approved');
    assert.strictEqual(place.reviewed_by, 'mod1');
    assert.ok(place.reviewed_at, 'reviewed_at should be set');
  });

  await test('rejectPlace sets status, reason, and review metadata', async () => {
    const mock = createMockSupabase({ places: [{ id: 'p1', name: 'X', status: 'pending', featured: false }] });
    const Api = loadApiWithMock(mock);
    mock._setSession({ user: { id: 'mod1', email: 'mod@test.com' } });

    await Api.rejectPlace('p1', 'Duplicate of an existing pin');
    const place = mock._tables.places.find((p) => p.id === 'p1');
    assert.strictEqual(place.status, 'rejected');
    assert.strictEqual(place.rejection_reason, 'Duplicate of an existing pin');
  });

  await test('setFeatured toggles the featured flag', async () => {
    const mock = createMockSupabase({ places: [{ id: 'p1', name: 'X', status: 'approved', featured: false }] });
    const Api = loadApiWithMock(mock);
    await Api.setFeatured('p1', true);
    assert.strictEqual(mock._tables.places.find((p) => p.id === 'p1').featured, true);
  });

  console.log('\nApi.updatePlace ---------------------------------------------------------');
  await test('updates only the scalar fields that were provided', async () => {
    const mock = createMockSupabase({
      places: [{ id: 'p1', name: 'Old Name', description: 'Old desc', category_id: 'tourist', lat: 1, lng: 1, status: 'pending' }],
    });
    const Api = loadApiWithMock(mock);
    await Api.updatePlace('p1', { name: 'New Name' });

    const place = mock._tables.places.find((p) => p.id === 'p1');
    assert.strictEqual(place.name, 'New Name', 'name should be updated');
    assert.strictEqual(place.description, 'Old desc', 'description should be untouched since it was not provided');
  });

  await test('updating lat/lng (re-dropping the pin) works', async () => {
    const mock = createMockSupabase({
      places: [{ id: 'p1', name: 'X', lat: 36.0, lng: 137.0, status: 'pending' }],
    });
    const Api = loadApiWithMock(mock);
    await Api.updatePlace('p1', { lat: 36.95, lng: 136.45 });

    const place = mock._tables.places.find((p) => p.id === 'p1');
    assert.strictEqual(place.lat, 36.95);
    assert.strictEqual(place.lng, 136.45);
  });

  await test('never sends status or featured, even if accidentally passed in', async () => {
    // updatePlace's destructured params don't even include status/featured,
    // so there's no code path that could leak them through — this test
    // guards against a future refactor accidentally widening the signature.
    const mock = createMockSupabase({
      places: [{ id: 'p1', name: 'X', status: 'pending', featured: false }],
    });
    const Api = loadApiWithMock(mock);
    await Api.updatePlace('p1', { name: 'Y', status: 'approved', featured: true });

    const place = mock._tables.places.find((p) => p.id === 'p1');
    assert.strictEqual(place.status, 'pending', 'status must remain unchanged — only approvePlace/rejectPlace may change it');
    assert.strictEqual(place.featured, false, 'featured must remain unchanged — only setFeatured may change it');
  });

  await test('attaches new photos with sort_order continuing after existing ones', async () => {
    const mock = createMockSupabase({
      places: [{ id: 'p1', name: 'X', status: 'pending' }],
      place_photos: [{ id: 'ph1', place_id: 'p1', external_url: 'https://example.com/a.jpg', sort_order: 0 }],
    });
    const Api = loadApiWithMock(mock);
    mock._setSession({ user: { id: 'u1', email: 'alice@test.com' } });

    await Api.updatePlace('p1', { newPhotos: [{ externalUrl: 'https://example.com/b.jpg' }] });

    const photos = mock._tables.place_photos.filter((p) => p.place_id === 'p1');
    assert.strictEqual(photos.length, 2);
    const newPhoto = photos.find((p) => p.external_url === 'https://example.com/b.jpg');
    assert.strictEqual(newPhoto.sort_order, 1, 'new photo should continue the sort_order sequence, not collide with existing');
  });

  console.log('\nApi.replaceTagsForPlace ---------------------------------------------------');
  await test('adds new tags and removes ones no longer wanted, leaves unchanged tags alone', async () => {
    const mock = createMockSupabase({
      tags: [{ id: 1, label: 'sunset' }, { id: 2, label: 'free-entry' }, { id: 3, label: 'old-tag' }],
      place_tags: [
        { place_id: 'p1', tag_id: 1 }, // sunset - kept
        { place_id: 'p1', tag_id: 3 }, // old-tag - should be removed
      ],
    });
    const Api = loadApiWithMock(mock);

    await Api.replaceTagsForPlace('p1', ['sunset', 'free-entry']);

    const links = mock._tables.place_tags.filter((l) => l.place_id === 'p1');
    const tagIds = links.map((l) => l.tag_id).sort();
    assert.deepStrictEqual(tagIds, [1, 2], 'should end up with exactly sunset(1) and free-entry(2)');
  });

  await test('is a no-op when the desired tag set already matches', async () => {
    const mock = createMockSupabase({
      tags: [{ id: 1, label: 'sunset' }],
      place_tags: [{ place_id: 'p1', tag_id: 1 }],
    });
    const Api = loadApiWithMock(mock);

    await Api.replaceTagsForPlace('p1', ['sunset']);

    const links = mock._tables.place_tags.filter((l) => l.place_id === 'p1');
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].tag_id, 1);
  });

  await test('removing all tags clears every link for that place', async () => {
    const mock = createMockSupabase({
      tags: [{ id: 1, label: 'sunset' }, { id: 2, label: 'free-entry' }],
      place_tags: [{ place_id: 'p1', tag_id: 1 }, { place_id: 'p1', tag_id: 2 }],
    });
    const Api = loadApiWithMock(mock);

    await Api.replaceTagsForPlace('p1', []);

    const links = mock._tables.place_tags.filter((l) => l.place_id === 'p1');
    assert.strictEqual(links.length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
