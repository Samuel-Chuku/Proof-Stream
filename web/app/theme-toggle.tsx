'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/// Two designed palettes, not a filter — see tokens.css.
///
/// Default is whatever the operating system asks for; the toggle is an explicit
/// override that persists. Once a choice is stored, `data-theme` on <html> wins
/// over the media query in both directions.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  // Read the resolved theme after mount. Rendering the glyph on the server
  // would guarantee a hydration mismatch, because the server cannot know the
  // viewer's stored preference or their OS setting.
  useEffect(() => {
    const stored = localStorage.getItem('ps-theme') as Theme | null;
    setTheme(stored ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('ps-theme', next);
    document.documentElement.dataset.theme = next;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="ps-theme-toggle"
      aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      // Empty until mounted so the two renders agree; the button keeps its
      // footprint so nothing shifts when the glyph arrives.
      suppressHydrationWarning
    >
      {theme === null ? '' : theme === 'dark' ? '○' : '●'}
    </button>
  );
}

/// Applies the stored theme before first paint.
///
/// Without this the page renders in the OS theme and then snaps to the stored
/// one — a flash of the wrong palette on every load. It has to be inline and
/// synchronous in <head>; a React effect runs far too late.
export const themeScript = `(function(){try{var t=localStorage.getItem('ps-theme');if(t){document.documentElement.dataset.theme=t}}catch(e){}})()`;
