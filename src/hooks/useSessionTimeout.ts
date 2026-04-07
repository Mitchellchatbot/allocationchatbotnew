import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

const DEFAULT_TIMEOUT_MINUTES = 15;
const WARNING_BEFORE_SECONDS = 60; // warn 60s before logout

export function useSessionTimeout() {
  const { user, signOut } = useAuth();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutMinutesRef = useRef(DEFAULT_TIMEOUT_MINUTES);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);
  }, []);

  const handleLogout = useCallback(async () => {
    clearTimers();
    toast.info('Session expired due to inactivity. Please sign in again.');
    await signOut();
  }, [signOut, clearTimers]);

  const resetTimer = useCallback(() => {
    clearTimers();
    if (!user) return;

    const timeoutMs = timeoutMinutesRef.current * 60 * 1000;
    const warningMs = timeoutMs - WARNING_BEFORE_SECONDS * 1000;

    // Warning toast removed – was too intrusive

    timeoutRef.current = setTimeout(handleLogout, timeoutMs);
  }, [user, clearTimers, handleLogout]);

  // Fetch user's session timeout preference
  useEffect(() => {
    if (!user) return;

    const fetchTimeout = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('session_timeout_minutes')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data?.session_timeout_minutes) {
        timeoutMinutesRef.current = data.session_timeout_minutes;
      }
      resetTimer();
    };

    fetchTimeout();
  }, [user, resetTimer]);

  // Listen for user activity
  useEffect(() => {
    if (!user) return;

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];
    
    // Throttle activity detection
    let lastActivity = Date.now();
    const handleActivity = () => {
      const now = Date.now();
      if (now - lastActivity > 30000) { // Only reset every 30s to avoid excessive resets
        lastActivity = now;
        resetTimer();
      }
    };

    events.forEach(event => window.addEventListener(event, handleActivity, { passive: true }));

    return () => {
      clearTimers();
      events.forEach(event => window.removeEventListener(event, handleActivity));
    };
  }, [user, resetTimer, clearTimers]);

  return { resetTimer };
}
