// ============================================================================
// mock-supabase.js — A minimal in-memory fake of the Supabase JS client,
// just enough surface area to functionally exercise js/supabase-client.js
// in Node without a real network/database. This catches logic bugs (wrong
// field names, bad chaining assumptions, payload shape mistakes) that pure
// syntax-checking can't.
// ============================================================================

function createMockSupabase(initialData = {}) {
  const tables = {
    profiles: [],
    categories: [],
    tags: [],
    places: [],
    place_tags: [],
    place_photos: [],
    place_reports: [],
    ...initialData,
  };

  let currentSession = null;
  const storageFiles = [];

  function matchFilters(row, filters) {
    return filters.every(({ type, col, val }) => {
      if (type === 'eq') return row[col] === val;
      if (type === 'gte') return row[col] >= val;
      if (type === 'lte') return row[col] <= val;
      if (type === 'in') return val.includes(row[col]);
      return true;
    });
  }

  function makeQueryBuilder(tableName) {
    let filters = [];
    let selectCols = null;
    let isSingle = false;
    let orderCol = null;
    let orderDesc = false;
    let limitN = null;
    let pendingOp = null; // { type: 'insert'|'update'|'delete'|'upsert', payload }

    const builder = {
      select(cols) {
        selectCols = cols;
        return builder;
      },
      eq(col, val) { filters.push({ type: 'eq', col, val }); return builder; },
      gte(col, val) { filters.push({ type: 'gte', col, val }); return builder; },
      lte(col, val) { filters.push({ type: 'lte', col, val }); return builder; },
      in(col, val) { filters.push({ type: 'in', col, val }); return builder; },
      order(col, opts) { orderCol = col; orderDesc = !!(opts && opts.ascending === false); return builder; },
      limit(n) { limitN = n; return builder; },
      single() { isSingle = true; return builder; },

      insert(payload) {
        pendingOp = { type: 'insert', payload: Array.isArray(payload) ? payload : [payload] };
        return builder;
      },
      upsert(payload, opts) {
        pendingOp = { type: 'upsert', payload: Array.isArray(payload) ? payload : [payload], opts };
        return builder;
      },
      update(payload) {
        pendingOp = { type: 'update', payload };
        return builder;
      },
      delete() {
        pendingOp = { type: 'delete' };
        return builder;
      },

      // Thenable so `await` works directly on the builder, mirroring
      // the real supabase-js client's behavior.
      then(resolve, reject) {
        try {
          const result = execute();
          resolve(result);
        } catch (e) {
          reject ? reject(e) : (() => { throw e; })();
        }
      },
    };

    function execute() {
      const table = tables[tableName];
      if (!table) throw new Error(`Mock table "${tableName}" not defined`);

      if (pendingOp?.type === 'insert') {
        const inserted = pendingOp.payload.map((row) => ({
          id: row.id || `mock-id-${Math.random().toString(36).slice(2, 10)}`,
          created_at: new Date().toISOString(),
          status: tableName === 'places' ? 'pending' : undefined,
          featured: tableName === 'places' ? false : undefined,
          ...row,
        }));
        table.push(...inserted);
        return { data: isSingle ? inserted[0] : inserted, error: null };
      }

      if (pendingOp?.type === 'upsert') {
        const conflictCol = pendingOp.opts?.onConflict;
        for (const row of pendingOp.payload) {
          const existing = conflictCol ? table.find((r) => r[conflictCol] === row[conflictCol]) : null;
          if (existing) {
            Object.assign(existing, row);
          } else {
            table.push({ id: `mock-id-${Math.random().toString(36).slice(2, 10)}`, ...row });
          }
        }
        return { data: pendingOp.payload, error: null };
      }

      if (pendingOp?.type === 'update') {
        const matched = table.filter((row) => matchFilters(row, filters));
        matched.forEach((row) => Object.assign(row, pendingOp.payload));
        return { data: isSingle ? matched[0] : matched, error: null };
      }

      if (pendingOp?.type === 'delete') {
        const toDelete = table.filter((row) => matchFilters(row, filters));
        toDelete.forEach((row) => {
          const idx = table.indexOf(row);
          table.splice(idx, 1);
        });
        return { data: toDelete, error: null };
      }

      // select
      let rows = table.filter((row) => matchFilters(row, filters));
      if (orderCol) {
        rows = [...rows].sort((a, b) => (a[orderCol] > b[orderCol] ? 1 : -1));
        if (orderDesc) rows.reverse();
      }
      if (limitN != null) rows = rows.slice(0, limitN);

      // The mock doesn't implement generic relational embedding (the
      // real Supabase/PostgREST `select('foo ( bar )')` join syntax) —
      // selectCols is otherwise ignored entirely. The one join shape
      // actually exercised by tests (place_tags joined to tags, used by
      // replaceTagsForPlace) is special-cased here rather than building
      // a general-purpose join engine that could itself diverge subtly
      // from real Postgres behavior and give false test confidence.
      if (tableName === 'place_tags' && selectCols && selectCols.includes('tags')) {
        rows = rows.map((row) => ({
          ...row,
          tags: tables.tags.find((t) => t.id === row.tag_id) || null,
        }));
      }

      if (isSingle) {
        if (rows.length === 0) return { data: null, error: { message: 'No rows found' } };
        return { data: rows[0], error: null };
      }
      return { data: rows, error: null };
    }

    return builder;
  }

  return {
    from(tableName) {
      return makeQueryBuilder(tableName);
    },
    auth: {
      async signUp({ email, password, options }) {
        const user = { id: `user-${Math.random().toString(36).slice(2, 8)}`, email };
        tables.profiles.push({
          id: user.id,
          display_name: options?.data?.display_name || email.split('@')[0],
          role: 'user',
        });
        return { data: { user, session: null }, error: null };
      },
      async signInWithPassword({ email, password }) {
        const profile = tables.profiles.find((p) => p.display_name === email.split('@')[0]) || tables.profiles[0];
        if (!profile) return { data: null, error: { message: 'Invalid login credentials' } };
        currentSession = { user: { id: profile.id, email } };
        return { data: { session: currentSession }, error: null };
      },
      async signOut() {
        currentSession = null;
        return { error: null };
      },
      async getSession() {
        return { data: { session: currentSession }, error: null };
      },
      onAuthStateChange(cb) {
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, file, opts) {
            storageFiles.push({ bucket, path });
            return { data: { path }, error: null };
          },
          getPublicUrl(path) {
            return { data: { publicUrl: `https://mock-storage.test/${bucket}/${path}` } };
          },
        };
      },
    },
    _setSession(session) {
      currentSession = session;
    },
    _tables: tables,
    _storageFiles: storageFiles,
  };
}

module.exports = { createMockSupabase };
