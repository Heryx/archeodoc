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
