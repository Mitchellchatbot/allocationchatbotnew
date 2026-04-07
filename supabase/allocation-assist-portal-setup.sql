-- ===================================================================
-- Allocation Assist Portal — One-time Supabase Setup
-- Run in: Supabase Dashboard → SQL Editor
-- Project: qnafaecxrokafizyozpx
-- Safe to re-run: guards check existence before every insert
-- ===================================================================

DO $$
DECLARE
  v_user_id  uuid;
  v_email    text := 'portal@allocation-assist.com';
  v_password text := 'Universe2003!';
  v_prop_id  uuid := gen_random_uuid();
BEGIN

  -- ── 1. Auth user ────────────────────────────────────────────────
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role,
      email, encrypted_password,
      email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin, created_at, updated_at
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Allocation Assist Portal"}',
      false, now(), now()
    );
    RAISE NOTICE 'Auth user created: %', v_user_id;
  ELSE
    RAISE NOTICE 'Auth user already exists: %', v_user_id;
  END IF;

  -- ── 2. Auth identity ────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE provider = 'email' AND provider_id = v_email
  ) THEN
    INSERT INTO auth.identities (
      id, provider_id, user_id,
      identity_data,
      provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_email,
      v_user_id,
      jsonb_build_object(
        'sub',            v_user_id::text,
        'email',          v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email', now(), now(), now()
    );
    RAISE NOTICE 'Auth identity created';
  ELSE
    RAISE NOTICE 'Auth identity already exists';
  END IF;

  -- ── 3. Profile ──────────────────────────────────────────────────
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

  -- ── 4. Role: client → routes to /dashboard after WP SSO ─────────
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_user_id AND role = 'client'
  ) THEN
    INSERT INTO public.user_roles (user_id, role, created_at)
    VALUES (v_user_id, 'client', now());
    RAISE NOTICE 'Role assigned: client';
  ELSE
    RAISE NOTICE 'Role already assigned: client';
  END IF;

  -- ── 5. Property ──────────────────────────────────────────────────
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

  -- ── Done ─────────────────────────────────────────────────────────
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Setup complete';
  RAISE NOTICE '  Email:   %', v_email;
  RAISE NOTICE '  User ID: %', v_user_id;
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Set in .env:';
  RAISE NOTICE '  VITE_PORTAL_EMAIL=portal@allocation-assist.com';
  RAISE NOTICE '  VITE_PORTAL_PASSWORD=Universe2003!';
  RAISE NOTICE '========================================';

END $$;
