import type { Dispatch, SetStateAction } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { Label } from "@/components/ui/label";
import type { USForm } from "@/components/us/types";
import { RelationTagInput } from "@/components/us/RelationTagInput";

type USRelazioniProps = {
  form: USForm;
  setForm: Dispatch<SetStateAction<USForm>>;
  /** All US codes in the cantiere for autocomplete & missing-US warnings */
  usCodeSuggestions?: string[];
  /** Full US objects for inverse consistency indicators */
  usFullList?: any[];
  /** Called when user clicks a relation tag to navigate to that US */
  onNavigateToUS?: (code: string) => void;
};

export const MANAGED_RELATION_MODEL_KEYS = new Set<string>([
  "riempie",
  "riempitoDa",
  "taglia",
  "tagliatoDa",
  "siAppoggiaA",
  "gliSiAppoggia",
  "ugualeAStratigrafico",
  "posterioreA",
  "anterioreA",
]);

function setSchedaValue(
  setForm: Dispatch<SetStateAction<USForm>>,
  fieldKey: string,
  value: string,
) {
  setForm((prev) => ({
    ...prev,
    schedaData: {
      ...prev.schedaData,
      [fieldKey]: value,
    },
  }));
}

function parseTokens(raw: string): string[] {
  return raw
    .split(/[,;|\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Returns the subset of tokens that are NOT in the known US codes set.
 * Used to show warnings about referenced but non-existent US.
 */
function missingCodes(raw: string, suggestions: string[]): string[] {
  if (!suggestions.length) return [];
  const known = new Set(suggestions.map((s) => s.trim().toUpperCase()));
  return parseTokens(raw).filter((t) => !known.has(t.trim().toUpperCase()));
}

function MissingWarning({ codes }: { codes: string[] }) {
  if (!codes.length) return null;
  return (
    <div className="flex items-start gap-1.5 mt-1 text-xs text-amber-700">
      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
      <span>
        US non ancora create: <span className="font-mono">{codes.join(", ")}</span> — devono essere compilate (es. tramite caricamento del giornale di scavo).
      </span>
    </div>
  );
}

const INVERSE_MAP: Record<string, string> = {
  copre: "coperto_da",
  coperto_da: "copre",
  si_lega_a: "si_lega_a",
  uguale_a: "uguale_a",
  taglia: "tagliatoDa",
  tagliatoDa: "taglia",
  riempie: "riempitoDa",
  riempitoDa: "riempie",
  siAppoggiaA: "gliSiAppoggia",
  gliSiAppoggia: "siAppoggiaA",
  posterioreA: "anterioreA",
  anterioreA: "posterioreA",
};

const TOP_LEVEL_FIELDS = new Set(["copre", "coperto_da", "si_lega_a", "uguale_a"]);

function getRelValue(us: any, field: string): string {
  if (TOP_LEVEL_FIELDS.has(field)) return String(us[field] || "");
  try {
    const sd = typeof us.schedaData === "string" ? JSON.parse(us.schedaData) : (us.schedaData || {});
    return String(sd[field] || "");
  } catch { return ""; }
}

function parseTokensSet(raw: string): Set<string> {
  return new Set(
    raw.split(/[,;|\n]+/).map((t) => t.trim().toUpperCase()).filter(Boolean)
  );
}

function CoherenceIndicator({
  fieldName,
  rawValue,
  sourceCode,
  usFullList,
}: {
  fieldName: string;
  rawValue: string;
  sourceCode: string;
  usFullList: any[];
}) {
  const inverseField = INVERSE_MAP[fieldName];
  if (!inverseField || !rawValue.trim() || !sourceCode.trim() || !usFullList.length) return null;

  const referencedCodes = parseTokensSet(rawValue);
  const byCode = new Map<string, any>();
  for (const us of usFullList) {
    if (us.codiceUS?.trim()) byCode.set(us.codiceUS.trim().toUpperCase(), us);
  }

  const results: { code: string; ok: boolean }[] = [];
  for (const code of Array.from(referencedCodes)) {
    const target = byCode.get(code);
    if (!target) continue;
    const inverseVal = getRelValue(target, inverseField);
    const inverseCodes = parseTokensSet(inverseVal);
    results.push({ code: target.codiceUS, ok: inverseCodes.has(sourceCode.trim().toUpperCase()) });
  }

  if (!results.length) return null;

  const allOk = results.every((r) => r.ok);
  const missing = results.filter((r) => !r.ok).map((r) => r.code);

  return (
    <div className={`flex items-start gap-1.5 mt-1 text-xs ${allOk ? "text-emerald-700" : "text-amber-600"}`}>
      {allOk
        ? <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
        : <CircleDashed size={12} className="mt-0.5 shrink-0" />}
      <span>
        {allOk
          ? "Relazione inversa presente"
          : <>Inversa mancante in: <span className="font-mono">{missing.join(", ")}</span> — verrà proposta al salvataggio.</>}
      </span>
    </div>
  );
}

export function USRelazioni({ form, setForm, usCodeSuggestions = [], usFullList = [], onNavigateToUS }: USRelazioniProps) {
  const schedaValue = (fieldKey: string) => form.schedaData[fieldKey] || "";
  const sourceCode = form.codiceUS?.trim() || "";

  return (
    <section className="rounded-md border border-border bg-background">
      <div className="border-b border-border bg-muted/20 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Relazioni stratigrafiche</p>
      </div>
      <div className="space-y-4 p-3">
        <div>
          <p className="text-sm font-medium">Sequenza fisica (contatti reali)</p>
          <p className="text-xs text-muted-foreground">Digita un codice US e premi Invio o virgola per aggiungerlo. Le relazioni inverse vengono compilate automaticamente.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Coperto da</Label>
            <RelationTagInput
              value={form.coperto_da}
              onChange={(val) => setForm((f) => ({ ...f, coperto_da: val }))}
              suggestions={usCodeSuggestions}
              onNavigate={onNavigateToUS}
            />
            <MissingWarning codes={missingCodes(form.coperto_da, usCodeSuggestions)} />
            <CoherenceIndicator fieldName="coperto_da" rawValue={form.coperto_da} sourceCode={sourceCode} usFullList={usFullList} />
          </div>
          <div>
            <Label>Copre</Label>
            <RelationTagInput
              value={form.copre}
              onChange={(val) => setForm((f) => ({ ...f, copre: val }))}
              suggestions={usCodeSuggestions}
              onNavigate={onNavigateToUS}
            />
            <MissingWarning codes={missingCodes(form.copre, usCodeSuggestions)} />
            <CoherenceIndicator fieldName="copre" rawValue={form.copre} sourceCode={sourceCode} usFullList={usFullList} />
          </div>
          <div>
            <Label>Riempie</Label>
            <RelationTagInput
              value={schedaValue("riempie")}
              onChange={(val) => setSchedaValue(setForm, "riempie", val)}
              suggestions={usCodeSuggestions}
              onNavigate={onNavigateToUS}
            />
            <MissingWarning codes={missingCodes(schedaValue("riempie"), usCodeSuggestions)} />
            <CoherenceIndicator fieldName="riempie" rawValue={schedaValue("riempie")} sourceCode={sourceCode} usFullList={usFullList} />
          </div>
          <div>
            <Label>Riempita da</Label>
            <RelationTagInput
              value={schedaValue("riempitoDa")}
              onChange={(val) => setSchedaValue(setForm, "riempitoDa", val)}
              suggestions={usCodeSuggestions}
              onNavigate={onNavigateToUS}
            />
            <MissingWarning codes={missingCodes(schedaValue("riempitoDa"), usCodeSuggestions)} />
            <CoherenceIndicator fieldName="riempitoDa" rawValue={schedaValue("riempitoDa")} sourceCode={sourceCode} usFullList={usFullList} />
          </div>
          <div>
            <Label>Taglia</Label>
            <RelationTagInput
              value={schedaValue("taglia")}
              onChange={(val) => setSchedaValue(setForm, "taglia", val)}
              suggestions={usCodeSuggestions}
              onNavigate={onNavigateToUS}
            />
            <MissingWarning codes={missingCodes(schedaValue("taglia"), usCodeSuggestions)} />
            <CoherenceIndicator fieldName="taglia" rawValue={schedaValue("taglia")} sourceCode={sourceCode} usFullList={usFullList} />
          </div>
          <div>
            <Label>Tagliata da</Label>
            <RelationTagInput
              value={schedaValue("tagliatoDa")}
              onChange={(val) => setSchedaValue(setForm, "tagliatoDa", val)}
              suggestions={usCodeSuggestions}
              onNavigate={onNavigateToUS}
            />
            <MissingWarning codes={missingCodes(schedaValue("tagliatoDa"), usCodeSuggestions)} />
            <CoherenceIndicator fieldName="tagliatoDa" rawValue={schedaValue("tagliatoDa")} sourceCode={sourceCode} usFullList={usFullList} />
          </div>
          <div>
            <Label>Si appoggia a</Label>
            <RelationTagInput
              value={schedaValue("siAppoggiaA")}
              onChange={(val) => setSchedaValue(setForm, "siAppoggiaA", val)}
              suggestions={usCodeSuggestions}
              onNavigate={onNavigateToUS}
            />
            <MissingWarning codes={missingCodes(schedaValue("siAppoggiaA"), usCodeSuggestions)} />
            <CoherenceIndicator fieldName="siAppoggiaA" rawValue={schedaValue("siAppoggiaA")} sourceCode={sourceCode} usFullList={usFullList} />
          </div>
          <div>
            <Label>Gli si appoggia</Label>
            <RelationTagInput
              value={schedaValue("gliSiAppoggia")}
              onChange={(val) => setSchedaValue(setForm, "gliSiAppoggia", val)}
              suggestions={usCodeSuggestions}
              onNavigate={onNavigateToUS}
            />
            <MissingWarning codes={missingCodes(schedaValue("gliSiAppoggia"), usCodeSuggestions)} />
            <CoherenceIndicator fieldName="gliSiAppoggia" rawValue={schedaValue("gliSiAppoggia")} sourceCode={sourceCode} usFullList={usFullList} />
          </div>
          <div>
            <Label>Si lega a</Label>
            <RelationTagInput
              value={form.si_lega_a}
              onChange={(val) => setForm((f) => ({ ...f, si_lega_a: val }))}
              suggestions={usCodeSuggestions}
              onNavigate={onNavigateToUS}
            />
            <MissingWarning codes={missingCodes(form.si_lega_a, usCodeSuggestions)} />
            <CoherenceIndicator fieldName="si_lega_a" rawValue={form.si_lega_a} sourceCode={sourceCode} usFullList={usFullList} />
          </div>
          <div>
            <Label>Uguale a</Label>
            <RelationTagInput
              value={form.uguale_a}
              onChange={(val) => setForm((f) => ({ ...f, uguale_a: val }))}
              suggestions={usCodeSuggestions}
              onNavigate={onNavigateToUS}
            />
            <MissingWarning codes={missingCodes(form.uguale_a, usCodeSuggestions)} />
            <CoherenceIndicator fieldName="uguale_a" rawValue={form.uguale_a} sourceCode={sourceCode} usFullList={usFullList} />
          </div>
        </div>

        <div className="pt-1">
          <p className="text-sm font-medium">Sequenza stratigrafica (essenziale Matrix)</p>
          <p className="text-xs text-muted-foreground">Registra solo i rapporti minimi: posteriore a / anteriore a.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Posteriore a</Label>
            <RelationTagInput
              value={schedaValue("posterioreA")}
              onChange={(val) => setSchedaValue(setForm, "posterioreA", val)}
              suggestions={usCodeSuggestions}
              onNavigate={onNavigateToUS}
            />
            <MissingWarning codes={missingCodes(schedaValue("posterioreA"), usCodeSuggestions)} />
            <CoherenceIndicator fieldName="posterioreA" rawValue={schedaValue("posterioreA")} sourceCode={sourceCode} usFullList={usFullList} />
          </div>
          <div>
            <Label>Anteriore a</Label>
            <RelationTagInput
              value={schedaValue("anterioreA")}
              onChange={(val) => setSchedaValue(setForm, "anterioreA", val)}
              suggestions={usCodeSuggestions}
              onNavigate={onNavigateToUS}
            />
            <MissingWarning codes={missingCodes(schedaValue("anterioreA"), usCodeSuggestions)} />
            <CoherenceIndicator fieldName="anterioreA" rawValue={schedaValue("anterioreA")} sourceCode={sourceCode} usFullList={usFullList} />
          </div>
        </div>
      </div>
    </section>
  );
}
