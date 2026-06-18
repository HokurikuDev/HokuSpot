// ============================================================================
// categories.test.js — Functional tests for js/categories.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

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

function loadCategories(mockApi) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'categories.js'), 'utf8');
  const wrapped = `${code}\nthis.__Categories = Categories;`;
  const sandbox = { Api: mockApi, console };
  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox);
  return sandbox.__Categories;
}

(async () => {
  console.log('\nCategories.load --------------------------------------------------------');

  await test('uses fallback list before load() is called', () => {
    const Categories = loadCategories({ getCategories: async () => [] });
    const all = Categories.all();
    assert.ok(all.length >= 8, 'fallback should have at least the 8 documented categories');
    assert.strictEqual(Categories.isLoaded(), false);
  });

  await test('replaces fallback with DB rows on successful load', async () => {
    const dbRows = [
      { id: 'tourist', label_en: 'Tourist Spot', color: '#000000', icon: 'landmark', sort_order: 1 },
      { id: 'custom', label_en: 'Custom Category', color: '#abcdef', icon: 'pin', sort_order: 2 },
    ];
    const Categories = loadCategories({ getCategories: async () => dbRows });
    await Categories.load();

    assert.strictEqual(Categories.isLoaded(), true);
    assert.strictEqual(Categories.all().length, 2, 'should now reflect exactly the 2 DB rows, not merged with fallback');
    assert.strictEqual(Categories.get('custom').label_en, 'Custom Category');
  });

  await test('falls back gracefully when the API call throws (e.g. network down)', async () => {
    const Categories = loadCategories({ getCategories: async () => { throw new Error('network down'); } });
    const result = await Categories.load();

    assert.ok(result.length >= 8, 'should still return the fallback list, not throw');
    assert.strictEqual(Categories.isLoaded(), true, 'load attempt is considered complete even on fallback');
  });

  await test('get() returns "other" category for an unknown id', () => {
    const Categories = loadCategories({ getCategories: async () => [] });
    const unknown = Categories.get('totally-made-up-category');
    assert.strictEqual(unknown.id, 'other');
  });

  await test('all() is sorted by sort_order', async () => {
    const dbRows = [
      { id: 'c', label_en: 'C', color: '#000', icon: 'pin', sort_order: 3 },
      { id: 'a', label_en: 'A', color: '#000', icon: 'pin', sort_order: 1 },
      { id: 'b', label_en: 'B', color: '#000', icon: 'pin', sort_order: 2 },
    ];
    const Categories = loadCategories({ getCategories: async () => dbRows });
    await Categories.load();
    // Compare as a joined string rather than assert.deepStrictEqual on the
    // array itself — arrays constructed inside a separate vm context have
    // a different Array prototype than this file's realm, so a strict
    // structural/prototype check would fail here even when the contents
    // are identical. Joining sidesteps the cross-realm Array identity issue.
    const idsJoined = Categories.all().map((c) => c.id).join(',');
    assert.strictEqual(idsJoined, 'a,b,c');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
