/**
 * useWPSSO — WordPress Silent Sign-On
 *
 * Flow:
 *  1. WordPress plugin generates a signed token: HMAC-SHA256(timestamp, WP_SSO_SECRET)
 *  2. Redirects user to this app: /?wp_token=<timestamp>:<base64_hmac>
 *  3. This hook fires on mount, validates the token (checks HMAC + 5-min expiry)
 *  4. If valid, auto-signs into Supabase using the dedicated portal account
 *  5. Cleans the token from the URL so it doesn't get bookmarked
 *
 * Environment variables needed in .env:
 *   VITE_WP_SSO_SECRET    — shared secret (must match the WP plugin)
 *   VITE_PORTAL_EMAIL     — dedicated Supabase agent account email
 *   VITE_PORTAL_PASSWORD  — dedicated Supabase agent account password
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const WP_SSO_SECRET = import.meta.env.VITE_WP_SSO_SECRET as string;
const PORTAL_EMAIL = import.meta.env.VITE_PORTAL_EMAIL as string;
const PORTAL_PASSWORD = import.meta.env.VITE_PORTAL_PASSWORD as string;

async function validateWPToken(token: string): Promise<boolean> {
  try {
    if (!WP_SSO_SECRET) return false;

    const colonIdx = token.indexOf(':');
    if (colonIdx === -1) return false;

    const timestampStr = token.slice(0, colonIdx);
    const receivedHmac = token.slice(colonIdx + 1);

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) return false;

    // Token must be less than 5 minutes old
    const now = Math.floor(Date.now() / 1000);
    if (now - timestamp > 300) {
      console.warn('[WP SSO] Token expired');
      return false;
    }

    // Validate HMAC-SHA256 using Web Crypto API
    const encoder = new TextEncoder();
    const keyData = encoder.encode(WP_SSO_SECRET);
    const msgData = encoder.encode(timestampStr);

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // The WP plugin sends base64-encoded binary HMAC
    const sigBytes = Uint8Array.from(atob(receivedHmac), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, msgData);
    return valid;
  } catch (err) {
    console.error('[WP SSO] Validation error:', err);
    return false;
  }
}

function cleanTokenFromURL() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('wp_token');
    window.history.replaceState({}, '', url.toString());
  } catch {}
}

export function useWPSSO(): { ssoReady: boolean } {
  const [ssoReady, setSsoReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wpToken = params.get('wp_token');

    if (!wpToken) {
      // No WP token — skip SSO, proceed normally
      setSsoReady(true);
      return;
    }

    (async () => {
      const valid = await validateWPToken(wpToken);

      if (valid) {
        if (!PORTAL_EMAIL || !PORTAL_PASSWORD) {
          console.error('[WP SSO] VITE_PORTAL_EMAIL or VITE_PORTAL_PASSWORD not set in .env');
        } else {
          const { error } = await supabase.auth.signInWithPassword({
            email: PORTAL_EMAIL,
            password: PORTAL_PASSWORD,
          });
          if (error) {
            console.error('[WP SSO] Supabase sign-in failed:', error.message);
          }
        }
      } else {
        console.warn('[WP SSO] Invalid or expired token — proceeding without auto-login');
      }

      cleanTokenFromURL();
      setSsoReady(true);
    })();
  }, []);

  return { ssoReady };
}
