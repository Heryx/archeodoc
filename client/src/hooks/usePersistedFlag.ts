import { useCallback, useState } from "react";

/** Booleano ricordato in localStorage (es. barra laterale chiusa o aperta). */
export function usePersistedFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : raw === "1";
    } catch {
      return initial;
    }
  });
  const set = useCallback((v: boolean) => {
    setValue(v);
    try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* storage non disponibile */ }
  }, [key]);
  return [value, set];
}
