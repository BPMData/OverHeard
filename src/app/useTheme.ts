import { useEffect, useState } from 'react';

export function useTheme(pipWindow: Window | null) {
  // Theme state (Dark mode default for projector legibility)
  const [isDark, setIsDark] = useState<boolean>(true);

  // Sync dark mode class on <html> and <body>
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      document.body.className =
        'bg-[#090D16] text-[#F8FAFC] antialiased selection:bg-[#5843A5]/35';
    } else {
      root.classList.remove('dark');
      document.body.className =
        'bg-[#F8FAFC] text-[#0F172A] antialiased selection:bg-[#5843A5]/20';
    }
  }, [isDark, pipWindow]);

  return { isDark, setIsDark };
}
