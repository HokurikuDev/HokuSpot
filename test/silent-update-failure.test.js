// ============================================================================
// silent-update-failure.test.js — Proves the real bug behind "repinning an
// approved place usually doesn't save": js/supabase-client.js's
// updatePlace() called .update().eq() with NO .select() chained. PostgREST
// returns 204 No Content with no body for a PATCH regardless of whether 0
// or N rows matched — so an RLS-blocked update (0 rows touched) looked
// EXACTLY like success: error stayed null, the UI closed the panel and
// said "Changes saved," and nothing had actually changed.
//
// This test calls the real Api.updatePlace() from the actual shipped
// js/supabase-client.js (via Node's vm module, the same approach
// api.test.js uses) against a fake REST endpoint that mimics PostgREST's
// real responses for both cases, and confirms:
//   1. a normal update (1 row matched) resolves successfully
//   2. a zero-row update (simulating RLS silently rejecting it) THROWS,
//      rather than resolving as if nothing was wrong
//
// Run with: node test/silent-update-failure.test.js  (no server needed)
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

let passed = 0, failed = 0;
function report(name, ok, detail = '') {
  if (ok) { console.log(`  ok  - ${name}`); passed++; }
  else { console.log(`FAIL  - ${name}${detail ? ' :: ' + detail : ''}`); failed++; }
}

// ---- Minimal fake PostgREST server -----------------------------------
// /rest/v1/places?id=eq.ok-place      -> PATCH returns the updated row (1 match)
// /rest/v1/places?id=eq.blocked-place -> PATCH returns [] (RLS matched 0 rows)
function startFakeServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'PATCH' && req.url.includes('/rest/v1/places')) {
          const payload = body ? JSON.parse(body) : {};
          if (req.url.includes('id=eq.blocked-place')) {
            // RLS silently filtered this row out — PostgREST with
            // Prefer: return=representation responds 200 with an empty array.
            res.statusCode = 200;
            res.end('[]');
            return;
          }
          if (req.url.includes('id=eq.ok-place')) {
            res.statusCode = 200;
            res.end(JSON.stringify([{ id: 'ok-place', ...payload }]));
            return;
          }
        }
        // place_tags / place_photos lookups during updatePlace — just return empty.
        res.statusCode = 200;
        res.end('[]');
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await startFakeServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // ---- Load the REAL supabase-client.js in a sandboxed context ---------
  // Mirrors how test/api.test.js loads it: a tiny `window.supabase` stub
  // backed by real fetch() calls to our fake server, plus config.js's
  // expected globals, executed via vm so we're testing the actual shipped
  // file rather than a reimplementation.
  const configSrc = `const CONFIG = { SUPABASE_URL: '${baseUrl}', SUPABASE_ANON_KEY: 'anon-key' };`;
  const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-client.js'), 'utf8');

  const sandbox = {
    console,
    fetch: (...args) => fetch(...args),
    window: {
      supabase: {
        createClient(url, key) {
          // Extremely thin client: only implements the chain shape
          // Api.updatePlace actually uses (.from().update().eq()[.select().single()]),
          // routed to our fake HTTP server so real network/response semantics apply.
          return {
            from(table) {
              const filters = [];
              const builder = {
                update(payload) {
                  builder._payload = payload;
                  builder._method = 'PATCH';
                  return builder;
                },
                eq(col, val) {
                  filters.push(`${col}=eq.${val}`);
                  return builder;
                },
                select() {
                  builder._select = true;
                  return builder;
                },
                async single() {
                  const result = await builder._exec();
                  const row = Array.isArray(result.data) ? result.data[0] : result.data;
                  if (!row) {
                    return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
                  }
                  return { data: row, error: null };
                },
                async _exec() {
                  const qs = filters.length ? '?' + filters.join('&') : '';
                  const resp = await fetch(`${url}/rest/v1/${table}${qs}`, {
                    method: builder._method || 'GET',
                    headers: { 'Content-Type': 'application/json', apikey: key },
                    body: builder._payload ? JSON.stringify(builder._payload) : undefined,
                  });
                  const data = await resp.json();
                  return { data, error: null };
                },
                then(resolve, reject) {
                  // Allows `await builder` directly when .select()/.single() isn't chained —
                  // exactly the old, buggy call shape: const { error } = await ....update().eq(...)
                  builder._exec().then((r) => resolve({ data: r.data, error: null })).catch(reject);
                },
              };
              return builder;
            },
          };
        },
      },
    },
  };
  sandbox.window.supabaseClient = undefined;
  vm.createContext(sandbox);
  vm.runInContext(configSrc + '\n' + clientSrc + '\nthis.Api = Api;', sandbox);

  const Api = sandbox.Api;

  console.log('\nNormal case: update matches exactly one row ---------------------------');
  let threw = false;
  try {
    await Api.updatePlace('ok-place', { name: 'New Name', lat: 36.7, lng: 137.1 });
  } catch (e) {
    threw = true;
    console.log('  [diagnostic] unexpected throw:', e.message);
  }
  report('a normal, RLS-permitted update resolves without throwing', !threw);

  console.log('\nRLS-blocked case: PostgREST returns zero rows (simulating a rejected moderator update) ----');
  let blockedThrew = false;
  let blockedMessage = '';
  try {
    await Api.updatePlace('blocked-place', { name: 'New Name', lat: 36.9, lng: 137.3 });
  } catch (e) {
    blockedThrew = true;
    blockedMessage = e.message;
  }
  report('a zero-row (RLS-blocked) update THROWS instead of reporting false success', blockedThrew, blockedMessage);
  report('the thrown error is informative, not a generic/blank failure', blockedThrew && blockedMessage.length > 0, blockedMessage);

  server.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
