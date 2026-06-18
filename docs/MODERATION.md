# Moderation Guide

How the review/approval workflow works, and how to manage it day to day.

---

## The lifecycle of a submitted place

```
  visitor submits a place
          │
          ▼
   status = 'pending'   ← invisible to the public map, visible only to
          │                the submitter (their own pin) and moderators
          │
          ▼
  moderator reviews via "Review queue"
          │
   ┌──────┴──────┐
   ▼             ▼
approve        reject
   │             │
   ▼             ▼
status =      status = 'rejected'
'approved'    (rejection_reason stored,
   │           visible to the submitter
   ▼            via "My submissions" —
visible to     not yet built into the UI,
everyone       but the data is there)
   │
   ▼
optionally mark
featured = true
   │
   ▼
appears in the public
`featured_places` view
(for the future homepage banner)
```

A submitter can still edit or delete their own place **only while it's
pending**. Once approved, edits require a moderator (this is enforced by
Row-Level Security in `sql/02_policies.sql`, not just hidden in the UI —
even a technically savvy user can't bypass it by calling the API directly).

---

## Who can moderate

Anyone with `role = 'moderator'` or `role = 'admin'` on their
`public.profiles` row. There's no limit on how many moderators you can
have, and no behavioral difference between the two roles yet — `admin`
exists so you have room to restrict certain actions (like managing the
fixed category list) to a smaller group later without a schema migration.

**To promote someone**, run in the Supabase SQL Editor:
```sql
update public.profiles
set role = 'moderator'   -- or 'admin'
where id = (select id from auth.users where email = 'their-email@example.com');
```

**To demote someone back to a regular user:**
```sql
update public.profiles set role = 'user' where id = '...';
```

---

## Reviewing submissions

1. Sign in with a moderator/admin account.
2. Click **"Review queue"** in the top bar.
3. Each pending place shows its name, category, submitter, and
   description. Three actions:
   - **Approve** — makes it visible on the public map immediately.
   - **Approve & feature** — approves it AND sets `featured = true`, so it
     becomes eligible for the future cross-site homepage banner.
   - **Reject** — prompts for a reason (stored in `rejection_reason`),
     which is visible to the submitter via their own row (not yet surfaced
     in a dedicated "my submissions" screen in the UI, but the data is
     there if you want to build that next).

There's currently no "unpublish" button in the UI for already-approved
places — to take a place down, a moderator can do it directly in
Supabase's **Table Editor** (find the row in `places`, set
`status = 'rejected'` or delete it), or it can be scripted/added to the UI
later (`Api.rejectPlace()` already supports being called on any place
ID, not only pending ones, since RLS allows moderators to update any row
regardless of current status).

---

## Reports

Anyone signed in can click **"Report an issue"** on a place's detail card.
Reports are stored in `place_reports` and are visible only to
moderators/admins (not publicly browsable — a public list of "flagged
content" would just be a how-to-vandalize guide). There's currently no
dedicated "reports inbox" screen in the UI; check the `place_reports`
table directly in Supabase's Table Editor, filtering `status = 'open'`.
Building a small reports panel into the moderation queue would be a
natural next addition (`Api.getPendingPlaces`-style query against
`place_reports` joined to `places`).

---

## Categories vs. tags

- **Categories** are the fixed top-level list (Tourist Spot, Abandoned
  Place, Interesting Road, etc.) stored in `public.categories`. Only
  moderators/admins can add or edit them (see `sql/02_policies.sql`), by
  design — they're meant to stay a small, curated, consistent set that
  drives marker colors on the map.
- **Tags** are free-form and can be created by any signed-in user while
  submitting a place (e.g. "sunset", "free-entry", "car-accessible").
  There's no moderation step for tags themselves yet; if tag spam ever
  becomes a problem, the simplest fix is restricting `insert` on
  `public.tags` to moderators too (one policy change in
  `sql/02_policies.sql`), with users limited to selecting from existing tags.
