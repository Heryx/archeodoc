import { BASE_US_MODEL_KEY, isCheckedValue, type USModelDefinition, type USModelField } from "@shared/us_models";
import {
  normalizeUsDefinizioneWithVocabulary,
  normalizeUsTipoWithVocabulary,
  type USThesaurusConfig,
  US_TIPO_THESAURUS,
} from "@shared/us_thesaurus";

export const tipiUS = [...US_TIPO_THESAURUS];

export type USForm = {
  codiceUS: string;
  tipo: string;
  definizione: string;
  descrizione: string;
  interpretazione: string;
  quota: string;
  quotaPianoCampagna: string;
  settore: string;
  giornataId: string;
  coperto_da: string;
  copre: string;
  si_lega_a: string;
  uguale_a: string;
  periodoIniziale: string;
  periodoFinale: string;
  materialiRinvenuti: string;
  campioni: string;
  schedaModelKey: string;
  schedaData: Record<string, string>;
};

export type USDeleteImpact = {
  allegatiCount: number;
};

export const emptyUSForm: USForm = {
  codiceUS: "",
  tipo: "",
  definizione: "",
  descrizione: "",
  interpretazione: "",
  quota: "",
  quotaPianoCampagna: "",
  settore: "",
  giornataId: "",
  coperto_da: "",
  copre: "",
  si_lega_a: "",
  uguale_a: "",
  periodoIniziale: "",
  periodoFinale: "",
  materialiRinvenuti: "",
  campioni: "",
  schedaModelKey: BASE_US_MODEL_KEY,
  schedaData: {},
};

function asNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNullableNumber(value: string): number | null {
  const normalized = String(value || "").trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMultiSelectValue(raw: unknown): string[] {
  const text = String(raw || "").trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    // fallback for legacy delimited values
  }

  return text
    .split(/[|,;\n]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringifyMultiSelect(values: string[]): string {
  const normalized = Array.from(new Set(values.map((item) => String(item || "").trim()).filter(Boolean)));
  return normalized.length > 0 ? JSON.stringify(normalized) : "";
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "si" || normalized === "yes";
}

const SIMPLE_SCHEDE_KEYS: string[] = [
  "nCatalogoGenerale",
  "nCatalogoInternazionale",
  "localita",
  "anno",
  "area",
  "saggio",
  "quadrati",
  "soprintendenza",
  "tabelleMaterialiRa",
  "tabelleMaterialiN",
  "piante",
  "sezioni",
  "prospetti",
  "criteriDistinzione",
  "modoFormazione",
  "modoFormazioneOrigine",
  "densitaInorganici",
  "densitaOrganici",
  "consistenza",
  "colore",
  "misure",
  "statoConservazione",
  "danneggiatoDa",
  "gliSiAppoggia",
  "siAppoggia",
  "tagliatoDa",
  "taglia",
  "riempitoDa",
  "riempie",
  "sequenzaFisica",
  "corrispondeAltraUnita",
  "altroScavo",
  "elementiDatanti",
  "elementiDatantiFonte",
  "epoca",
  "datazione",
  "periodoFase",
  "datiQuantitativiReperti",
  "campionatureN",
  "flottazioneTipo",
  "setacciaturaTipo",
  "affidabilitaStratigrafica",
  "responsabileSabap",
  "responsabileScavo",
];

const INORGANIC_CHECKBOX_MAP: Array<{ option: string; key: string }> = [
  { option: "Materiale da costruzione", key: "compMaterialeCostruzione" },
  { option: "Ceramica", key: "compCeramica" },
  { option: "Metalli", key: "compMetalli" },
  { option: "Vetro", key: "compVetro" },
  { option: "Ciottoli", key: "compCiottoli" },
  { option: "Ghiaia", key: "compGhiaia" },
];

const ORGANIC_CHECKBOX_MAP: Array<{ option: string; key: string }> = [
  { option: "Reperti faunistici", key: "compFauna" },
  { option: "Fauna", key: "compFauna" },
  { option: "Osso", key: "compOsso" },
  { option: "Corno", key: "compCorno" },
  { option: "Semi", key: "compSemi" },
  { option: "Frutti", key: "compFrutti" },
  { option: "Carboni", key: "compCarboni" },
  { option: "Legno", key: "compLegno" },
  { option: "Tessuti", key: "compTessuti" },
];

/** Colonna della US che corrisponde a ciascun checkbox `chkXxx` dei template (stessi confronti dell'export DOCX).
 * `value` assente = colonna booleana; "*" = qualsiasi testo non vuoto. */
const CHECKBOX_COLUMN_MAP: Record<string, { column: string; value?: string }> = {
  chkArtificiale: { column: "modoFormazione", value: "artificiale" },
  chkNaturale: { column: "modoFormazione", value: "naturale" },
  chkMaterialeCostruzione: { column: "compMaterialeCostruzione" },
  chkCeramica: { column: "compCeramica" },
  chkMetalli: { column: "compMetalli" },
  chkVetro: { column: "compVetro" },
  chkCiottoli: { column: "compCiottoli" },
  chkGhiaia: { column: "compGhiaia" },
  chkDensitaInorgFitta: { column: "densitaInorganici", value: "fitta" },
  chkDensitaInorgMedia: { column: "densitaInorganici", value: "media" },
  chkDensitaInorgRada: { column: "densitaInorganici", value: "rada" },
  chkFauna: { column: "compFauna" },
  chkOsso: { column: "compOsso" },
  chkCorno: { column: "compCorno" },
  chkSemi: { column: "compSemi" },
  chkFrutti: { column: "compFrutti" },
  chkCarboni: { column: "compCarboni" },
  chkLegno: { column: "compLegno" },
  chkTessuti: { column: "compTessuti" },
  chkDensitaOrgFitta: { column: "densitaOrganici", value: "fitta" },
  chkDensitaOrgMedia: { column: "densitaOrganici", value: "media" },
  chkDensitaOrgRada: { column: "densitaOrganici", value: "rada" },
  chkIntatto: { column: "statoConservazione", value: "Intatto" },
  chkBuono: { column: "statoConservazione", value: "Buono" },
  chkDiscreto: { column: "statoConservazione", value: "Discreto" },
  chkMediocre: { column: "statoConservazione", value: "Mediocre" },
  chkPessimo: { column: "statoConservazione", value: "Pessimo" },
  chkScavataIntegralmente: { column: "scavataIntegralmente" },
  chkScavataParzialmente: { column: "scavataParzialmente" },
  chkCorrispondeAltraUnita: { column: "corrispondeAltraUnita", value: "*" },
  chkAsportataConAltriStrati: { column: "asportataConAltriStrati" },
  chkAltroScavo: { column: "altroScavo", value: "*" },
  chkSequenzaStratigrafica: { column: "elementiDatanti", value: "Sequenza stratigrafica" },
  chkRepertiDiagnostici: { column: "elementiDatanti", value: "Reperti diagnostici" },
  chkFlottazioneTutta: { column: "flottazioneTipo", value: "di tutta l'unità" },
  chkFlottazioneParziale: { column: "flottazioneTipo", value: "parziale" },
  chkSetacciaturaTutta: { column: "setacciaturaTipo", value: "di tutta l'unità" },
  chkSetacciaturaParziale: { column: "setacciaturaTipo", value: "parziale" },
  chkAffidNessuna: { column: "affidabilitaStratigrafica", value: "nessuna" },
  chkAffidModesta: { column: "affidabilitaStratigrafica", value: "modesta" },
  chkAffidBuona: { column: "affidabilitaStratigrafica", value: "buona" },
};

function isCheckboxColumnSet(us: any, spec: { column: string; value?: string }): boolean {
  const raw = us[spec.column];
  if (spec.value === undefined) return asBoolean(raw);
  const text = String(raw ?? "").trim();
  if (spec.value === "*") return text.length > 0;
  return text.toLowerCase() === spec.value.toLowerCase();
}

export function mapUsToForm(us: any, model?: USModelDefinition): USForm {
  let schedaData: Record<string, string> = {};
  if (typeof us.schedaData === "string" && us.schedaData.trim()) {
    try {
      const parsed = JSON.parse(us.schedaData);
      if (parsed && typeof parsed === "object") {
        schedaData = Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>((acc, [k, v]) => {
          if (v == null) return acc;
          acc[k] = Array.isArray(v) ? JSON.stringify(v) : String(v);
          return acc;
        }, {});
      }
    } catch {
      schedaData = {};
    }
  }

  for (const key of SIMPLE_SCHEDE_KEYS) {
    if (schedaData[key]) continue;
    if (us[key] == null) continue;
    const text = String(us[key]).trim();
    if (!text) continue;
    schedaData[key] = text;
  }
  if (!schedaData.quoteSlm && us.quota != null) {
    schedaData.quoteSlm = String(us.quota);
  }
  if (!schedaData.quotePianoCampagna && us.quotaPianoCampagna != null) {
    schedaData.quotePianoCampagna = String(us.quotaPianoCampagna);
  }
  if (!schedaData.siAppoggiaA && asNullable(String(us.siAppoggia || ""))) {
    schedaData.siAppoggiaA = String(us.siAppoggia);
  }

  if (!schedaData.componentiInorganici) {
    const selected = INORGANIC_CHECKBOX_MAP
      .filter((item) => asBoolean(us[item.key]))
      .map((item) => item.option);
    if (selected.length > 0) {
      schedaData.componentiInorganici = stringifyMultiSelect(selected);
    }
  }
  if (!schedaData.componentiInorganiciAltro && us.compAltroInorganico) {
    schedaData.componentiInorganiciAltro = String(us.compAltroInorganico);
  }

  if (!schedaData.componentiOrganici) {
    const selected = ORGANIC_CHECKBOX_MAP
      .filter((item) => asBoolean(us[item.key]))
      .map((item) => item.option);
    if (selected.length > 0) {
      schedaData.componentiOrganici = stringifyMultiSelect(selected);
    }
  }
  if (!schedaData.componentiOrganiciAltro && us.compAltroOrganico) {
    schedaData.componentiOrganiciAltro = String(us.compAltroOrganico);
  }

  if (!schedaData.metodoScavo) {
    const methods: string[] = [];
    if (asBoolean(us.scavataIntegralmente)) methods.push("Unita scavata integralmente");
    if (asBoolean(us.scavataParzialmente)) methods.push("Unita scavata parzialmente");
    if (String(us.corrispondeAltraUnita || "").trim()) methods.push("Corrisponde ad altra unita in altro punto");
    if (asBoolean(us.asportataConAltriStrati)) methods.push("Asportata insieme ad altri strati");
    if (methods.length > 0) {
      schedaData.metodoScavo = stringifyMultiSelect(methods);
    }
  }
  if (!schedaData.metodoScavoAltro && us.altroScavo) {
    schedaData.metodoScavoAltro = String(us.altroScavo);
  }

  // Checkbox del modello (da template DOCX): se la scheda non li ha ancora salvati, partono da quanto
  // già registrato nelle colonne della US (es. compilata con un altro modello o importata).
  for (const field of model?.fields ?? []) {
    if (field.type !== "checkbox" || schedaData[field.key] !== undefined) continue;
    const spec = CHECKBOX_COLUMN_MAP[field.key];
    if (spec && isCheckboxColumnSet(us, spec)) schedaData[field.key] = "true";
  }

  return {
    codiceUS: us.codiceUS || "",
    tipo: us.tipo || "",
    definizione: us.definizione || "",
    descrizione: us.descrizione || "",
    interpretazione: us.interpretazione || "",
    quota: us.quota != null ? String(us.quota) : "",
    quotaPianoCampagna: us.quotaPianoCampagna != null ? String(us.quotaPianoCampagna) : "",
    settore: us.settore || "",
    giornataId: us.giornataId != null ? String(us.giornataId) : "",
    coperto_da: us.coperto_da || "",
    copre: us.copre || "",
    si_lega_a: us.si_lega_a || "",
    uguale_a: us.uguale_a || "",
    periodoIniziale: us.periodoIniziale || "",
    periodoFinale: us.periodoFinale || "",
    materialiRinvenuti: us.materialiRinvenuti || "",
    campioni: us.campioni || "",
    schedaModelKey: us.schedaModelKey || BASE_US_MODEL_KEY,
    schedaData,
  };
}

export function usPayload(form: USForm, thesaurus?: USThesaurusConfig) {
  const tipoNormalized = normalizeUsTipoWithVocabulary(form.tipo, thesaurus?.tipo);
  const definizioneNormalized = normalizeUsDefinizioneWithVocabulary(
    form.definizione,
    tipoNormalized ?? form.tipo,
    thesaurus?.definizione,
  );

  const schedaDataClean = Object.entries(form.schedaData || {}).reduce<Record<string, string>>((acc, [key, value]) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return acc;
    acc[key] = trimmed;
    return acc;
  }, {});

  const inorganici = parseMultiSelectValue(schedaDataClean.componentiInorganici);
  const organici = parseMultiSelectValue(schedaDataClean.componentiOrganici);
  const metodoScavo = parseMultiSelectValue(schedaDataClean.metodoScavo);
  const elementiDatantiFonte = parseMultiSelectValue(schedaDataClean.elementiDatantiFonte);

  const structuredColumns: Record<string, unknown> = {};
  for (const key of SIMPLE_SCHEDE_KEYS) {
    if (!schedaDataClean[key]) continue;
    structuredColumns[key] = schedaDataClean[key];
  }

  structuredColumns.compAltroInorganico = asNullable(schedaDataClean.componentiInorganiciAltro || "");
  structuredColumns.compAltroOrganico = asNullable(schedaDataClean.componentiOrganiciAltro || "");
  structuredColumns.scavataIntegralmente = metodoScavo.includes("Unita scavata integralmente");
  structuredColumns.scavataParzialmente = metodoScavo.includes("Unita scavata parzialmente");
  structuredColumns.corrispondeAltraUnita = metodoScavo.includes("Corrisponde ad altra unita in altro punto") ? "si" : null;
  structuredColumns.asportataConAltriStrati = metodoScavo.includes("Asportata insieme ad altri strati");
  structuredColumns.altroScavo = asNullable(schedaDataClean.metodoScavoAltro || "");
  structuredColumns.elementiDatantiFonte = elementiDatantiFonte.length > 0 ? elementiDatantiFonte.join(", ") : null;

  for (const item of INORGANIC_CHECKBOX_MAP) {
    structuredColumns[item.key] = inorganici.includes(item.option);
  }
  for (const item of ORGANIC_CHECKBOX_MAP) {
    structuredColumns[item.key] = organici.includes(item.option);
  }

  structuredColumns.gliSiAppoggia = asNullable(schedaDataClean.gliSiAppoggia || "");
  structuredColumns.siAppoggia = asNullable(schedaDataClean.siAppoggiaA || schedaDataClean.siAppoggia || "");
  structuredColumns.tagliatoDa = asNullable(schedaDataClean.tagliatoDa || "");
  structuredColumns.taglia = asNullable(schedaDataClean.taglia || "");
  structuredColumns.riempitoDa = asNullable(schedaDataClean.riempitoDa || "");
  structuredColumns.riempie = asNullable(schedaDataClean.riempie || "");
  structuredColumns.sequenzaFisica = asNullable(schedaDataClean.ugualeAStratigrafico || "");

  // Checkbox del modello da template: tenuti allineati alle colonne della US, così Matrix, elenchi ed
  // export vedono gli stessi valori. Si agisce solo sui checkbox toccati nella scheda (chiave presente).
  for (const [key, spec] of Object.entries(CHECKBOX_COLUMN_MAP)) {
    if (form.schedaData[key] === undefined) continue;
    const checked = isCheckedValue(form.schedaData[key]);
    if (spec.value === undefined) {
      structuredColumns[spec.column] = checked;
    } else if (spec.value === "*") {
      if (spec.column === "corrispondeAltraUnita") structuredColumns[spec.column] = checked ? "si" : null;
    } else if (checked) {
      structuredColumns[spec.column] = spec.value;
    } else if (String(structuredColumns[spec.column] ?? "").toLowerCase() === spec.value.toLowerCase()) {
      structuredColumns[spec.column] = null;
    }
  }

  return {
    codiceUS: form.codiceUS.trim(),
    tipo: asNullable(tipoNormalized || ""),
    definizione: asNullable(definizioneNormalized || ""),
    descrizione: asNullable(form.descrizione),
    interpretazione: asNullable(form.interpretazione),
    quota: toNullableNumber(form.quota || schedaDataClean.quoteSlm || ""),
    quotaPianoCampagna: toNullableNumber(form.quotaPianoCampagna || schedaDataClean.quotePianoCampagna || ""),
    settore: asNullable(form.settore),
    giornataId: form.giornataId ? Number(form.giornataId) : null,
    coperto_da: asNullable(form.coperto_da),
    copre: asNullable(form.copre),
    si_lega_a: asNullable(form.si_lega_a),
    uguale_a: asNullable(form.uguale_a),
    periodoIniziale: asNullable(form.periodoIniziale),
    periodoFinale: asNullable(form.periodoFinale),
    materialiRinvenuti: asNullable(form.materialiRinvenuti),
    campioni: asNullable(form.campioni),
    ...structuredColumns,
    schedaModelKey: form.schedaModelKey || BASE_US_MODEL_KEY,
    schedaData: Object.keys(schedaDataClean).length > 0 ? JSON.stringify(schedaDataClean) : null,
  };
}

/** Voci del template che sono la quota s.l.m. della US ({quoteSlm}, {quotaSlm}, {quotaSml}): nella scheda
 * si leggono e si scrivono sul campo `quota`, non su una copia in schedaData. */
export const QUOTA_MODEL_FIELD_KEYS = new Set(["quoteSlm", "quotaSlm", "quotaSml"]);

export function getModelFieldValue(form: USForm, field: USModelField): string {
  if (QUOTA_MODEL_FIELD_KEYS.has(field.key)) return form.quota || "";
  return form.schedaData[field.key] || "";
}

export function missingRequiredModelFields(form: USForm, model?: USModelDefinition): string[] {
  if (!model) return [];
  return model.fields
    .filter((field) => field.required)
    .filter((field) => !getModelFieldValue(form, field).trim())
    .map((field) => field.label);
}
