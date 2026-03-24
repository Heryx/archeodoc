import { BASE_US_MODEL_KEY, type USModelDefinition, type USModelField } from "@shared/us_models";
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
  "responsabileArcheosistemi",
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

export function mapUsToForm(us: any): USForm {
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

  return {
    codiceUS: us.codiceUS || "",
    tipo: us.tipo || "",
    definizione: us.definizione || "",
    descrizione: us.descrizione || "",
    interpretazione: us.interpretazione || "",
    quota: us.quota != null ? String(us.quota) : "",
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

  return {
    codiceUS: form.codiceUS.trim(),
    tipo: asNullable(tipoNormalized || ""),
    definizione: asNullable(definizioneNormalized || ""),
    descrizione: asNullable(form.descrizione),
    interpretazione: asNullable(form.interpretazione),
    quota: form.quota ? Number(form.quota) : null,
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

export function getModelFieldValue(form: USForm, field: USModelField): string {
  return form.schedaData[field.key] || "";
}

export function missingRequiredModelFields(form: USForm, model?: USModelDefinition): string[] {
  if (!model) return [];
  return model.fields
    .filter((field) => field.required)
    .filter((field) => !getModelFieldValue(form, field).trim())
    .map((field) => field.label);
}
