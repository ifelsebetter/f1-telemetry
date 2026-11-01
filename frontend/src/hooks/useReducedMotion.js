import { useState, useEffect } from 'react';

export function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (e) => setReducedMotion(Boolean(e.matches));
    setReducedMotion(Boolean(mq.matches));

    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handleChange);
      return () => mq.removeEventListener('change', handleChange);
    }
    if (typeof mq.addListener === 'function') {
      mq.addListener(handleChange);
      return () => mq.removeListener(handleChange);
    }
    return undefined;
  }, []);

  return reducedMotion;
}
