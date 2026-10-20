import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type AiAssistantContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  /** Insieme di id US applicato come filtro alle pagine US/Elenco, o null se nessun filtro. */
  selectionFilter: number[] | null;
  setSelectionFilter: (ids: number[] | null) => void;
};

const AiAssistantContext = createContext<AiAssistantContextValue | null>(null);

const LS_OPEN = "archeodoc.aiAssistant.open";
const LS_EXPANDED = "archeodoc.aiAssistant.expanded";

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function AiAssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState<boolean>(() => readFlag(LS_OPEN));
  const [expanded, setExpandedState] = useState<boolean>(() => readFlag(LS_EXPANDED));
  const [selectionFilter, setSelectionFilterState] = useState<number[] | null>(null);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    writeFlag(LS_OPEN, next);
  }, []);

  const setExpanded = useCallback((next: boolean) => {
    setExpandedState(next);
    writeFlag(LS_EXPANDED, next);
  }, []);

  const toggleOpen = useCallback(() => {
    setOpenState((prev) => {
      const next = !prev;
      writeFlag(LS_OPEN, next);
      return next;
    });
  }, []);

  const setSelectionFilter = useCallback((ids: number[] | null) => {
    setSelectionFilterState(ids && ids.length > 0 ? Array.from(new Set(ids)) : null);
  }, []);

  const value = useMemo<AiAssistantContextValue>(
    () => ({ open, setOpen, toggleOpen, expanded, setExpanded, selectionFilter, setSelectionFilter }),
    [open, setOpen, toggleOpen, expanded, setExpanded, selectionFilter, setSelectionFilter],
  );

  return <AiAssistantContext.Provider value={value}>{children}</AiAssistantContext.Provider>;
}

export function useAiAssistant(): AiAssistantContextValue {
  const ctx = useContext(AiAssistantContext);
  if (!ctx) {
    throw new Error("useAiAssistant deve essere usato dentro <AiAssistantProvider>");
  }
  return ctx;
}

/** Variante che non lancia se il provider non è montato (per pagine renderizzate fuori shell). */
export function useAiAssistantOptional(): AiAssistantContextValue | null {
  return useContext(AiAssistantContext);
}
