import { ExternalLink, FilePlus2, X } from "lucide-react";
import { formatUsCode, type TombaCodeStyle } from "@shared/us_code";
import { usCodeKey } from "@shared/normalize_us_code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelSection } from "@/components/relazioni/Ribbon";

export type UsItem = Record<string, any> & { id: number; codiceUS: string; tipo: string | null; definizione: string | null };

// Anteprima in sola lettura della scheda US, mostrata nel pannello laterale dell'editor.
// I rapporti stratigrafici sono cliccabili: portano all'anteprima della US indicata.

const FIELDS: { title: string; keys: [string, string][] }[] = [
  { title: "Descrizione", keys: [["descrizione", "Descrizione"], ["interpretazione", "Interpretazione"]] },
  {
    title: "Caratteri",
    keys: [
      ["settore", "Settore"], ["area", "Area"], ["quota", "Quota"], ["quotaPianoCampagna", "Quota dal piano di campagna"],
      ["colore", "Colore"], ["consistenza", "Consistenza"], ["misure", "Misure"], ["statoConservazione", "Conservazione"],
      ["modoFormazione", "Formazione"],
    ],
  },
  {
    title: "Cronologia",
    keys: [
      ["periodoFase", "Periodo / fase"], ["datazione", "Datazione"], ["epoca", "Epoca"], ["elementiDatanti", "Elementi datanti"],
      ["materialiRinvenuti", "Materiali rinvenuti"], ["campioni", "Campioni"],
    ],
  },
];

const RELATIONS: [string, string][] = [
  ["copre", "Copre"], ["coperto_da", "Coperto da"], ["taglia", "Taglia"], ["tagliatoDa", "Tagliato da"],
  ["riempie", "Riempie"], ["riempitoDa", "Riempito da"], ["si_lega_a", "Si lega a"], ["uguale_a", "Uguale a"],
  ["siAppoggia", "Si appoggia a"], ["gliSiAppoggia", "Gli si appoggia"],
];

const tokens = (raw: unknown): string[] =>
  String(raw ?? "").split(/[,;|\n]+/).map((t) => t.trim()).filter(Boolean);

const hasValue = (v: unknown) => v != null && String(v).trim() !== "";

export function UsPreviewPanel({ us, usList, tombaStyle, linked, onSelect, onOpenFull, onInsert, onClose }: {
  us: UsItem | null;
  usList: UsItem[];
  tombaStyle: TombaCodeStyle;
  linked: boolean;
  onSelect: (id: number) => void;
  onOpenFull: (id: number) => void;
  onInsert: (u: UsItem) => void;
  onClose: () => void;
}) {
  const label = (u: UsItem) => formatUsCode(u.codiceUS, u.tipo, tombaStyle);
  const byKey = new Map<string, UsItem>();
  for (const u of usList) byKey.set(usCodeKey(u.codiceUS), u);

  if (!us) {
    return (
      <p className="rounded bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
        Clicca su una US citata nel testo, o su una delle US collegate, per vederne qui l'anteprima.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-base font-semibold text-primary">{label(us)}</span>
            {us.tipo && <Badge variant="outline" className="text-[10px]">{us.tipo}</Badge>}
            {linked && <Badge variant="secondary" className="text-[10px]">citata nel testo</Badge>}
          </div>
          {us.definizione && <div className="mt-0.5 text-sm font-medium leading-snug">{us.definizione}</div>}
        </div>
        <button type="button" title="Chiudi l'anteprima" aria-label="Chiudi l'anteprima" onClick={onClose}
          className="h-6 w-6 shrink-0 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted">
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => onOpenFull(us.id)}
          title="Apre la scheda completa nella pagina delle US">
          <ExternalLink size={13} /> Scheda completa
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => onInsert(us)}
          title="Inserisce nel testo, alla posizione del cursore, il riferimento a questa US">
          <FilePlus2 size={13} /> Cita nel testo
        </Button>
      </div>

      {FIELDS.map((group) => {
        const rows = group.keys.filter(([k]) => hasValue(us[k]));
        if (!rows.length) return null;
        return (
          <PanelSection key={group.title} title={group.title}>
            <dl className="space-y-1.5">
              {rows.map(([k, name]) => (
                <div key={k}>
                  <dt className="text-[11px] font-medium text-muted-foreground">{name}</dt>
                  <dd className="whitespace-pre-wrap text-xs leading-snug">{String(us[k])}</dd>
                </div>
              ))}
            </dl>
          </PanelSection>
        );
      })}

      {RELATIONS.some(([k]) => tokens(us[k]).length) && (
        <PanelSection title="Rapporti stratigrafici">
          <dl className="space-y-1.5">
            {RELATIONS.filter(([k]) => tokens(us[k]).length).map(([k, name]) => (
              <div key={k}>
                <dt className="text-[11px] font-medium text-muted-foreground">{name}</dt>
                <dd className="flex flex-wrap gap-1">
                  {tokens(us[k]).map((t) => {
                    const target = byKey.get(usCodeKey(t));
                    return target ? (
                      <button key={t} type="button" onClick={() => onSelect(target.id)} title="Mostra l'anteprima di questa US"
                        className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary hover:bg-primary/20">
                        {label(target)}
                      </button>
                    ) : (
                      <span key={t} title="US non ancora creata" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{t}</span>
                    );
                  })}
                </dd>
              </div>
            ))}
          </dl>
        </PanelSection>
      )}
    </div>
  );
}
