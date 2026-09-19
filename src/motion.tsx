import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type DataConnection = EventTarget & { saveData?: boolean };
const preferenceKey = 'allowance-reduced-motion';
const MotionContext = createContext({
  reduced: false,
  requested: false,
  setRequested: (_: boolean) => {},
});

export function MotionProvider({ children }: { children: ReactNode }) {
  const [requested, setRequested] = useState(() => {
    try {
      return localStorage.getItem(preferenceKey) === 'true';
    } catch {
      return false;
    }
  });
  const [deviceReduced, setDeviceReduced] = useState(
    () =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      Boolean((navigator as Navigator & { connection?: DataConnection }).connection?.saveData)
  );
  const reduced = requested || deviceReduced;
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (navigator as Navigator & { connection?: DataConnection }).connection;
    const update = () => setDeviceReduced(media.matches || Boolean(connection?.saveData));
    media.addEventListener('change', update);
    connection?.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
      connection?.removeEventListener('change', update);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'standard';
    try {
      localStorage.setItem(preferenceKey, String(requested));
    } catch {
      // The current-page preference still works when browser storage is unavailable.
    }
  }, [reduced, requested]);
  return (
    <MotionContext.Provider value={{ reduced, requested, setRequested }}>
      {children}
    </MotionContext.Provider>
  );
}

export function useMotion() {
  return useContext(MotionContext);
}
