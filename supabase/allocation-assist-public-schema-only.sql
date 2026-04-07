-- ===================================================================
-- Allocation Assist Portal — Public Schema Setup
-- Run AFTER creating the auth user via Supabase Dashboard UI
--
-- HOW TO USE:
--   1. Go to Supabase Dashboard → Authentication → Users
--   2. Click "Add user" → "Create new user"
--      Email: portal@allocation-assist.com
--      Password: Universe2003!
--      Check "Auto Confirm User"  →  Save
--   3. Click the new user row → copy its UUID
--   4. Paste that UUID below where it says PASTE_UUID_HERE
--   5. Run this script in SQL Editor
-- ===================================================================

DO $$
DECLARE
  -- ▼ Paste the UUID from the Supabase Auth dashboard here ▼
  v_user_id  uuid := 'PASTE_UUID_HERE';
  -- ▲ ─────────────────────────────────────────────────────────── ▲

  v_email    text := 'portal@allocation-assist.com';
  v_prop_id  uuid := gen_random_uuid();
BEGIN

  -- Sanity check: make sure the UUID is filled in
  IF v_user_id::text = 'PASTE_UUID_HERE' THEN
    RAISE EXCEPTION 'You must replace PASTE_UUID_HERE with the real UUID from the Auth dashboard';
  END IF;

  -- ── 1. Profile ──────────────────────────────────────────────────
  -- (Supabase trigger may have already created a row — ON CONFLICT handles it)
  INSERT INTO public.profiles (
    user_id, email, full_name,
    two_factor_enabled, session_timeout_minutes,
    created_at, updated_at
  ) VALUES (
    v_user_id, v_email, 'Allocation Assist Portal',
    false, 60, now(), now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    full_name               = EXCLUDED.full_name,
    session_timeout_minutes = EXCLUDED.session_timeout_minutes,
    updated_at              = now();
  RAISE NOTICE 'Profile upserted';

  -- ── 2. Role: client → routes to /dashboard after WP SSO ────────
  INSERT INTO public.user_roles (user_id, role, created_at)
  VALUES (v_user_id, 'client', now())
  ON CONFLICT DO NOTHING;
  RAISE NOTICE 'Role: client assigned (or already existed)';

  -- ── 3. Property ─────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM public.properties
    WHERE user_id = v_user_id AND domain = 'allocationassist.com'
  ) THEN
    INSERT INTO public.properties (
      id, user_id,
      name, domain,
      geo_filter_mode, geo_allowed_states,
      widget_color, greeting,
      created_at, updated_at
    ) VALUES (
      v_prop_id, v_user_id,
      'Allocation Assist', 'allocationassist.com',
      'off', ARRAY[]::text[],
      'hsl(171, 60%, 45%)',
      'Hi! How can we help with your allocation today?',
      now(), now()
    );
    RAISE NOTICE 'Property created: %', v_prop_id;
  ELSE
    RAISE NOTICE 'Property already exists';
  END IF;

  -- ── 4. Comp subscription (bypass all Stripe/plan checks) ────────
  INSERT INTO public.subscriptions (
    user_id, plan_id, status, is_comped,
    current_period_start, current_period_end,
    created_at, updated_at
  ) VALUES (
    v_user_id,
    'enterprise',
    'active',
    true,
    now(),
    now() + interval '100 years',
    now(), now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    is_comped  = true,
    status     = 'active',
    updated_at = now();
  RAISE NOTICE 'Subscription: comped enterprise';

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Done! User ID: %', v_user_id;
  RAISE NOTICE '========================================';

END $$;
