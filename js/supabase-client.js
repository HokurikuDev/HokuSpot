// ============================================================================
// supabase-client.js — Thin wrapper around the Supabase JS client.
//
// Centralizes every database/auth/storage call the app makes, so the rest
// of the codebase never touches the Supabase SDK directly. This makes it
// easy to see, in one file, exactly what data operations exist and what
// they're allowed to do (which should always match sql/02_policies.sql).
// ============================================================================

const supabaseClient = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

const Api = {
  // -------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------
  async signUp(email, password, displayName) {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) throw error;
    return data;
  },

  async signIn(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
  },

  async getSession() {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  onAuthChange(callback) {
    return supabaseClient.auth.onAuthStateChange((_event, session) => callback(session));
  },

  async getMyProfile() {
    const session = await this.getSession();
    if (!session) return null;
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('id, display_name, avatar_url, role')
      .eq('id', session.user.id)
      .single();
    if (error) throw error;
    return data;
  },

  // -------------------------------------------------------------------
  // Categories & tags (public reference data)
  // -------------------------------------------------------------------
  async getCategories() {
    const { data, error } = await supabaseClient
      .from('categories')
      .select('*')
      .order('sort_order');
    if (error) throw error;
    return data;
  },

  async getAllTags() {
    const { data, error } = await supabaseClient.from('tags').select('*').order('label');
    if (error) throw error;
    return data;
  },

  async ensureTags(labels) {
    // Inserts any tags that don't already exist, ignoring conflicts.
    // Returns the full set of tag rows (existing + newly created) matching labels.
    const cleaned = [...new Set(labels.map((l) => l.trim().toLowerCase()).filter(Boolean))];
    if (cleaned.length === 0) return [];

    const { error: insertError } = await supabaseClient
      .from('tags')
      .upsert(cleaned.map((label) => ({ label })), { onConflict: 'label', ignoreDuplicates: true });
    if (insertError) throw insertError;

    const { data, error } = await supabaseClient.from('tags').select('*').in('label', cleaned);
    if (error) throw error;
    return data;
  },

  // -------------------------------------------------------------------
  // Places — public reads
  // -------------------------------------------------------------------
  async getApprovedPlacesInBounds(bbox) {
    // bbox: [west, south, east, north]. RLS already restricts this to
    // status='approved' for anonymous/regular reads — we don't need to
    // (and shouldn't) filter status client-side as a security measure.
    const { data, error } = await supabaseClient
      .from('places')
      .select('id, name, category_id, lat, lng, featured')
      .gte('lng', bbox[0])
      .lte('lng', bbox[2])
      .gte('lat', bbox[1])
      .lte('lat', bbox[3]);
    if (error) throw error;
    return data;
  },

  async getPlaceDetail(placeId) {
    const { data, error } = await supabaseClient
      .from('places')
      .select(`
        id, name, description, highlights, address, category_id, lat, lng,
        status, featured, created_at, created_by,
        place_photos ( id, storage_path, external_url, caption, sort_order ),
        place_tags ( tags ( id, label ) )
      `)
      .eq('id', placeId)
      .single();
    if (error) throw error;
    return data;
  },

  async getMySubmissions() {
    const session = await this.getSession();
    if (!session) return [];
    const { data, error } = await supabaseClient
      .from('places')
      .select('id, name, category_id, status, rejection_reason, created_at')
      .eq('created_by', session.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  // -------------------------------------------------------------------
  // Places — submission & editing (regular users)
  // -------------------------------------------------------------------
  async submitPlace({ name, description, highlights, address, categoryId, lat, lng, tagLabels, photos }) {
    const session = await this.getSession();
    if (!session) throw new Error('You must be signed in to add a place.');

    // status/featured are intentionally omitted — the database defaults
    // (pending/false) apply, and the RLS insert policy would reject any
    // attempt to set them otherwise. See sql/02_policies.sql.
    const { data: place, error } = await supabaseClient
      .from('places')
      .insert({
        name, description, highlights, address,
        category_id: categoryId, lat, lng,
        created_by: session.user.id,
      })
      .select()
      .single();
    if (error) throw error;

    if (tagLabels && tagLabels.length > 0) {
      const tags = await this.ensureTags(tagLabels);
      const { error: tagLinkError } = await supabaseClient
        .from('place_tags')
        .insert(tags.map((t) => ({ place_id: place.id, tag_id: t.id })));
      if (tagLinkError) throw tagLinkError;
    }

    if (photos && photos.length > 0) {
      for (const [i, photo] of photos.entries()) {
        await this.attachPhotoToPlace(place.id, photo, i);
      }
    }

    return place;
  },

  async attachPhotoToPlace(placeId, photo, sortOrder = 0) {
    // photo is either { file: File, caption } for upload
    // or { externalUrl: string, caption } for a pasted link.
    const session = await this.getSession();
    if (!session) throw new Error('You must be signed in to add photos.');

    let insertPayload = {
      place_id: placeId,
      caption: photo.caption || null,
      sort_order: sortOrder,
      uploaded_by: session.user.id,
    };

    if (photo.file) {
      const ext = photo.file.name.split('.').pop();
      const path = `${session.user.id}/${placeId}-${Date.now()}-${sortOrder}.${ext}`;
      const { error: uploadError } = await supabaseClient.storage
        .from('place-photos')
        .upload(path, photo.file, { contentType: photo.file.type });
      if (uploadError) throw uploadError;
      insertPayload.storage_path = path;
    } else if (photo.externalUrl) {
      insertPayload.external_url = photo.externalUrl;
    } else {
      throw new Error('Photo must have either a file or an external URL.');
    }

    const { error } = await supabaseClient.from('place_photos').insert(insertPayload);
    if (error) throw error;
  },

  getPhotoPublicUrl(storagePath) {
    const { data } = supabaseClient.storage.from('place-photos').getPublicUrl(storagePath);
    return data.publicUrl;
  },

  async updateMyPendingPlace(placeId, updates) {
    const { error } = await supabaseClient
      .from('places')
      .update(updates)
      .eq('id', placeId);
    if (error) throw error;
  },

  async deleteMyPendingPlace(placeId) {
    const { error } = await supabaseClient.from('places').delete().eq('id', placeId);
    if (error) throw error;
  },

  // -------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------
  async reportPlace(placeId, reason) {
    const session = await this.getSession();
    if (!session) throw new Error('You must be signed in to report a place.');
    const { error } = await supabaseClient
      .from('place_reports')
      .insert({ place_id: placeId, reported_by: session.user.id, reason });
    if (error) throw error;
  },

  // -------------------------------------------------------------------
  // Moderation (requires moderator/admin role — enforced by RLS regardless
  // of whether the UI happens to show these controls)
  // -------------------------------------------------------------------
  async getPendingPlaces() {
    // `places` has two foreign keys into `profiles` (created_by and
    // reviewed_by), so PostgREST can't infer which one to embed from a
    // bare `profiles ( ... )` — it needs to be told explicitly via the
    // `!column_name` hint. Without this, the query fails with: "Could not
    // embed because more than one relationship was found for 'places'
    // and 'profiles'".
    const { data, error } = await supabaseClient
      .from('places')
      .select('id, name, category_id, lat, lng, description, created_at, created_by, profiles!created_by ( display_name )')
      .eq('status', 'pending')
      .order('created_at');
    if (error) throw error;
    return data;
  },

  async approvePlace(placeId) {
    const session = await this.getSession();
    const { error } = await supabaseClient
      .from('places')
      .update({ status: 'approved', reviewed_by: session.user.id, reviewed_at: new Date().toISOString() })
      .eq('id', placeId);
    if (error) throw error;
  },

  async rejectPlace(placeId, reason) {
    const session = await this.getSession();
    const { error } = await supabaseClient
      .from('places')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        reviewed_by: session.user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', placeId);
    if (error) throw error;
  },

  async setFeatured(placeId, featured) {
    const { error } = await supabaseClient.from('places').update({ featured }).eq('id', placeId);
    if (error) throw error;
  },
};
