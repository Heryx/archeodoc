import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { SquareArrowOutDownRight } from "lucide-react";

// Barra multifunzione in stile Office: schede in alto, gruppi di comandi sotto.
// Le schede contestuali (Tabella, Figura) compaiono quando il cursore è dentro l'oggetto;
// l'icona nell'angolo di un gruppo apre il pannello laterale con le impostazioni di dettaglio.

export type RibbonTabDef = { id: string; label: string; contextual?: boolean };

export function RibbonTabs({ tabs, active, onChange }: { tabs: RibbonTabDef[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex items-end gap-0.5 px-2 pt-1 border-b border-border bg-muted/40">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(t.id)}
          className={`relative px-3 py-1.5 text-xs font-medium rounded-t border border-b-0 -mb-px ${
            active === t.id
              ? "bg-background border-border text-foreground"
              : "border-transparent text-muted-foreground hover:bg-background/60"
          } ${t.contextual ? "text-primary" : ""}`}
        >
          {t.contextual && <span className="absolute inset-x-0 top-0 h-0.5 rounded-t bg-primary" />}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function RibbonBody({ children }: { children: React.ReactNode }) {
  return <div className="flex items-stretch overflow-x-auto bg-background border-b border-border px-1 py-1 min-h-[86px]">{children}</div>;
}

export function RibbonGroup({ label, onLauncher, launcherTitle, children }: {
  label: string; onLauncher?: () => void; launcherTitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-col border-r border-border px-2 last:border-r-0">
      <div className="flex flex-1 items-center gap-1">{children}</div>
      <div className="relative flex h-4 items-center justify-center text-[10px] text-muted-foreground">
        {label}
        {onLauncher && (
          <button
            type="button"
            title={launcherTitle || "Altre impostazioni nel pannello laterale"}
            aria-label={launcherTitle || "Altre impostazioni nel pannello laterale"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onLauncher}
            className="absolute -right-1 top-0 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <SquareArrowOutDownRight size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

export const RibbonSep = () => <span className="mx-0.5 h-6 w-px shrink-0 bg-border" />;

// Più righe di comandi piccoli, una sopra l'altra
export const RibbonStack = ({ children }: { children: React.ReactNode }) => <div className="flex flex-col justify-center gap-0.5">{children}</div>;
export const RibbonRow = ({ children }: { children: React.ReactNode }) => <div className="flex items-center gap-0.5">{children}</div>;

// Comando grande: icona sopra, etichetta sotto
export const RibbonBig = React.forwardRef<HTMLButtonElement, {
  label: string; icon: React.ReactNode; onClick?: () => void; title?: string; active?: boolean; disabled?: boolean; danger?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "title">>(
  ({ label, icon, onClick, title, active, disabled, danger, ...rest }, ref) => (
    <button
      {...rest}
      ref={ref}
      type="button"
      title={title || label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-[58px] w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded px-0.5 text-center text-[10px] leading-tight disabled:opacity-40 ${
        active ? "bg-primary/15 text-primary" : danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-muted"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  ),
);
RibbonBig.displayName = "RibbonBig";

// Comando piccolo: solo icona, con etichetta opzionale accanto
export const RibbonBtn = React.forwardRef<HTMLButtonElement, {
  title: string; icon: React.ReactNode; onClick?: () => void; label?: string; active?: boolean; disabled?: boolean; danger?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "title">>(
  ({ title, icon, onClick, label, active, disabled, danger, ...rest }, ref) => (
    <button
      {...rest}
      ref={ref}
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded text-xs disabled:opacity-40 ${label ? "px-1.5" : "w-7"} ${
        active ? "bg-primary/15 text-primary" : danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-muted"
      }`}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  ),
);
RibbonBtn.displayName = "RibbonBtn";

export const ribbonSelect = "h-7 rounded border border-input bg-background px-1.5 text-xs";

// Campo numerico che si conferma con Invio o uscendo dal campo; vuoto = nessun valore
export function NumField({ value, onCommit, suffix, min = 0, max, placeholder, className = "w-16", title }: {
  value: number | null; onCommit: (n: number | null) => void; suffix?: string; min?: number; max?: number;
  placeholder?: string; className?: string; title?: string;
}) {
  const show = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(show(value)); }, [value]);
  const commit = () => {
    const raw = text.trim().replace(",", ".");
    if (raw === "") return onCommit(null);
    let n = Number(raw);
    if (!Number.isFinite(n)) return setText(show(value));
    n = Math.max(min, max != null ? Math.min(max, n) : n);
    onCommit(Math.round(n * 100) / 100);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        title={title}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
        onBlur={() => { focused.current = false; commit(); }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setText(show(value)); e.currentTarget.blur(); } }}
        className={`h-7 rounded border border-input bg-background px-1.5 text-xs tabular-nums ${className}`}
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </span>
  );
}

// Titolo di sezione del pannello laterale
export function PanelSection({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="space-y-1.5 pt-3 border-t border-border first:border-0 first:pt-0 scroll-mt-2">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}

// Pulsante del pannello laterale
export function PanelTool({ label, icon, onClick, active, disabled, danger }: {
  label: string; icon: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded border px-2 py-1.5 text-left text-xs disabled:opacity-40 ${
        active ? "border-primary bg-primary/10 text-primary" : danger ? "border-border text-destructive hover:bg-destructive/10" : "border-border hover:bg-muted"
      }`}
    >
      {icon}
      <span className="leading-tight">{label}</span>
    </button>
  );
}

// Porta in vista una sezione del pannello laterale appena aperto
export function useScrollToSection(section: string | undefined, nonce: number) {
  useEffect(() => {
    if (!section) return;
    const t = setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    return () => clearTimeout(t);
  }, [section, nonce]);
}
