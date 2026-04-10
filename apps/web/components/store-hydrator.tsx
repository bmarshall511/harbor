'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';

/**
 * Hydrates persisted store values from localStorage after client mount.
 *
 * Anything in here represents user preferences that should survive a
 * full reload: grid column width, video mute state, etc.
 *
 * NOTE: theater mode is intentionally NOT persisted. It's a per-session
 * focus mode — sticking it across reloads led to a regression where
 * users opened the lightbox and found every chrome control (slideshow,
 * favorite, add-to-collection, side-nav buttons, keyboard hints) gone
 * with no obvious way to recover. We also clear any stale value from
 * the previous persisted-mode build so existing users don't stay stuck.
 *
 * These can't go in the initial store state because the store is
 * imported on the server during SSR where `localStorage` is undefined.
 */
export function StoreHydrator() {
  const setGridColWidth = useAppStore((s) => s.setGridColWidth);
  const setVideoMuted = useAppStore((s) => s.setVideoMuted);

  useEffect(() => {
    try {
      const w = localStorage.getItem('harbor-grid-col-width');
      if (w) {
        const width = Number(w);
        if (width >= 80 && width <= 400) setGridColWidth(width);
      }

      const mute = localStorage.getItem('harbor-video-muted');
      // Default is muted; only flip to unmuted if the user explicitly set it.
      if (mute === '0') setVideoMuted(false);
      if (mute === '1') setVideoMuted(true);

      // Clean up stale theater-mode preference from earlier builds.
      localStorage.removeItem('harbor-theater-mode');
    } catch { /* localStorage unavailable */ }
  }, [setGridColWidth, setVideoMuted]);

  return null;
}
