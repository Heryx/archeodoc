import type { UnitaStratigrafica, Giornata, Allegato } from "@shared/schema";
import {
  resolveQcUsConfig,
  type QcUsConfig,
  type QcUsConfigInput,
} from "@shared/qc_us_rules";
import { parseUsCode, usPrefixMismatch } from "@shared/us_code";

export interface QcIssue {
  livello: "error" | "warning" | "info";
  categoria: "completezza" | "coerenza" | "nomenclatura" | "associazione";
  messaggio: string;
  campoInteressato?: string;
  usId?: number;
}

/**
 * Aggiunge un problema QC applicando il livello configurato per la regola.
 * Se la regola è impostata su "off" (disattivata) il problema non viene emesso.
 */
function emit(
  issues: QcIssue[],
  config: QcUsConfig,
  ruleId: string,
  base: Omit<QcIssue, "livello">,
): void {
  const level = config.levels[ruleId];
  if (!level || level === "off") return;
  issues.push({ ...base, livello: level });
}

type RelationFieldValue = {
  campo: string;
  val: unknown;
};

const EXTRA_RELATION_FIELD_MAP: Record<string, string> = {
  riempie: "riempie",
  riempitoDa: "riempitoDa",
  riempita_da: "riempitoDa",
  riempito_da: "riempitoDa",
  taglia: "taglia",
  tagliatoDa: "tagliatoDa",
  tagliata_da: "tagliatoDa",
  siAppoggiaA: "siAppoggiaA",
  si_appoggia_a: "siAppoggiaA",
  gliSiAppoggia: "gliSiAppoggia",
  gli_si_appoggia: "gliSiAppoggia",
  ugualeAStratigrafico: "ugualeAStratigrafico",
  posterioreA: "posterioreA",
  posteriore_a: "posterioreA",
  anterioreA: "anterioreA",
  anteriore_a: "anterioreA",
};

function normalizeCode(value: string): string {
  // Ignora il prefisso "US" davanti a un numero: "US 102", "US102" e "102" sono lo stesso codice
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase()
    .replace(/^US\.?\s*(?=\d)/, "");
}

function parseSchedaData(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseRelationCodes(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];

  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const value of raw) {
      out.push(...parseRelationCodes(value));
    }
    return out;
  }

  const text = String(raw).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parseRelationCodes(parsed);
    }
  } catch {
    // fallback plain text split
  }

  const tokens = text
    .split(/[;,|\n\r]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const digitsOnly = token.match(/^\d+$/);
    const normalizedToken = digitsOnly ? `US ${Number(token)}` : token;
    const key = normalizeCode(normalizedToken);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(normalizedToken);
  }

  return out;
}

function extractRelationFields(us: UnitaStratigrafica): RelationFieldValue[] {
  const refs: RelationFieldValue[] = [
    { campo: "coperto_da", val: us.coperto_da },
    { campo: "copre", val: us.copre },
    { campo: "si_lega_a", val: us.si_lega_a },
    { campo: "uguale_a", val: us.uguale_a },
  ];

  const schedaData = parseSchedaData(us.schedaData);
  for (const [key, value] of Object.entries(schedaData)) {
    const mapped = EXTRA_RELATION_FIELD_MAP[key];
    if (!mapped) continue;
    refs.push({ campo: mapped, val: value });
  }

  return refs;
}

export function checkUS(
  us: UnitaStratigrafica,
  allegatiUS: Allegato[],
  configInput?: QcUsConfigInput | QcUsConfig | null,
): QcIssue[] {
  const config = resolveQcUsConfig(configInput ?? null);
  const issues: QcIssue[] = [];

  if (us.daRivedere) {
    emit(issues, config, "da_rivedere", {
      categoria: "completezza",
      messaggio: `US ${us.codiceUS}: importata automaticamente dall'elenco US, da rivedere e completare`,
      campoInteressato: "daRivedere",
      usId: us.id,
    });
  }

  // Completezza campi obbligatori
  if (!us.tipo) {
    emit(issues, config, "tipo_mancante", {
      categoria: "completezza",
      messaggio: `US ${us.codiceUS}: tipo non compilato`,
      campoInteressato: "tipo",
      usId: us.id,
    });
  }
  if (!us.descrizione || us.descrizione.trim().length < config.thresholds.descrizione_min) {
    emit(issues, config, "descrizione_breve", {
      categoria: "completezza",
      messaggio: `US ${us.codiceUS}: descrizione assente o troppo breve`,
      campoInteressato: "descrizione",
      usId: us.id,
    });
  }
  if (!us.definizione) {
    emit(issues, config, "definizione_mancante", {
      categoria: "completezza",
      messaggio: `US ${us.codiceUS}: definizione non compilata`,
      campoInteressato: "definizione",
      usId: us.id,
    });
  }
  if (
    (us.quota === null || us.quota === undefined) &&
    (us.quotaPianoCampagna === null || us.quotaPianoCampagna === undefined)
  ) {
    emit(issues, config, "quota_mancante", {
      categoria: "completezza",
      messaggio: `US ${us.codiceUS}: quota non rilevata (s.l.m. o da piano campagna)`,
      campoInteressato: "quota",
      usId: us.id,
    });
  }
  if (!us.settore) {
    emit(issues, config, "settore_mancante", {
      categoria: "completezza",
      messaggio: `US ${us.codiceUS}: settore non indicato`,
      campoInteressato: "settore",
      usId: us.id,
    });
  }

  // Nomenclatura
  if (!parseUsCode(us.codiceUS)) {
    emit(issues, config, "codice_formato", {
      categoria: "nomenclatura",
      messaggio: `US ${us.codiceUS}: formato codice non conforme (atteso: 001, US 001, T.001, SB 001)`,
      campoInteressato: "codice_us",
      usId: us.id,
    });
  }

  const mismatch = usPrefixMismatch(us.codiceUS, us.tipo);
  if (mismatch) {
    emit(issues, config, "codice_prefisso_incoerente", {
      categoria: "nomenclatura",
      messaggio: `US ${us.codiceUS}: prefisso del codice incoerente con il tipo (${mismatch})`,
      campoInteressato: "codice_us",
      usId: us.id,
    });
  }

  // Associazione foto/disegno
  const foto = allegatiUS.filter((a) => a.tipo === "foto");
  const disegni = allegatiUS.filter((a) => a.tipo === "planimetria" || a.tipo === "disegno");

  if (foto.length === 0) {
    emit(issues, config, "foto_mancante", {
      categoria: "associazione",
      messaggio: `US ${us.codiceUS}: nessuna fotografia allegata`,
      campoInteressato: "ha_foto",
      usId: us.id,
    });
  }
  if (disegni.length === 0 && us.tipo !== "interfaccia") {
    emit(issues, config, "disegno_mancante", {
      categoria: "associazione",
      messaggio: `US ${us.codiceUS}: nessun disegno/planimetria allegata`,
      campoInteressato: "ha_disegno",
      usId: us.id,
    });
  }

  // Tomba: campi specifici
  if (us.tipo === "tomba" || us.codiceUS.toUpperCase().startsWith("T.") || us.codiceUS.toUpperCase().startsWith("T ")) {
    if (!us.periodoIniziale) {
      emit(issues, config, "tomba_periodo_mancante", {
        categoria: "completezza",
        messaggio: `US ${us.codiceUS}: per una tomba indicare il periodo/datazione`,
        campoInteressato: "periodo_iniziale",
        usId: us.id,
      });
    }
    if (!us.interpretazione) {
      emit(issues, config, "tomba_interpretazione_mancante", {
        categoria: "completezza",
        messaggio: `US ${us.codiceUS}: interpretazione non compilata per la tomba`,
        campoInteressato: "interpretazione",
        usId: us.id,
      });
    }
  }

  // Consistenza interna campi testuali (troppo corti o generici)
  const genericPhrases = ["nd", "n.d.", "non determinato", "da definire", "da verificare", "vedi descrizione"];
  if (us.definizione) {
    const def = us.definizione.trim().toLowerCase();
    if (def.length < config.thresholds.definizione_generica_min || genericPhrases.includes(def)) {
      emit(issues, config, "definizione_generica", {
        categoria: "completezza",
        messaggio: `US ${us.codiceUS}: definizione troppo generica o non compilata`,
        campoInteressato: "definizione",
        usId: us.id,
      });
    }
  }

  if (us.interpretazione) {
    const interp = us.interpretazione.trim().toLowerCase();
    if (interp.length < config.thresholds.interpretazione_generica_min || genericPhrases.includes(interp)) {
      emit(issues, config, "interpretazione_generica", {
        categoria: "completezza",
        messaggio: `US ${us.codiceUS}: interpretazione troppo generica`,
        campoInteressato: "interpretazione",
        usId: us.id,
      });
    }
  }

  // Verifica quota: valore fuori range plausibile
  if (us.quota !== null && us.quota !== undefined) {
    if (us.quota > config.thresholds.quota_slm_max || us.quota < config.thresholds.quota_slm_min) {
      emit(issues, config, "quota_slm_range", {
        categoria: "coerenza",
        messaggio: `US ${us.codiceUS}: quota s.l.m. fuori range plausibile (${us.quota}m)`,
        campoInteressato: "quota",
        usId: us.id,
      });
    }
  }
  if (us.quotaPianoCampagna !== null && us.quotaPianoCampagna !== undefined) {
    if (
      us.quotaPianoCampagna > config.thresholds.quota_pc_max ||
      us.quotaPianoCampagna < config.thresholds.quota_pc_min
    ) {
      emit(issues, config, "quota_pc_range", {
        categoria: "coerenza",
        messaggio: `US ${us.codiceUS}: quota da piano campagna fuori range plausibile (${us.quotaPianoCampagna}m)`,
        campoInteressato: "quotaPianoCampagna",
        usId: us.id,
      });
    }
  }

  return issues;
}

export function checkCoerenzaStratigrafica(
  usList: UnitaStratigrafica[],
  configInput?: QcUsConfigInput | QcUsConfig | null,
): QcIssue[] {
  const config = resolveQcUsConfig(configInput ?? null);
  const issues: QcIssue[] = [];
  const codici = new Set<string>();

  for (const us of usList) {
    codici.add(normalizeCode(us.codiceUS));
  }

  const seen = new Set<string>();

  for (const us of usList) {
    const sourceCode = normalizeCode(us.codiceUS);
    const refs = extractRelationFields(us);

    for (const ref of refs) {
      const targets = parseRelationCodes(ref.val);

      for (const targetRaw of targets) {
        const target = normalizeCode(targetRaw);
        if (!target) continue;

        const key = `${us.id}:${ref.campo}:${target}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (target === sourceCode) {
          emit(issues, config, "rel_autoriferimento", {
            categoria: "coerenza",
            messaggio: `US ${us.codiceUS}: il campo "${ref.campo}" contiene un auto-riferimento (${targetRaw})`,
            campoInteressato: ref.campo,
            usId: us.id,
          });
          continue;
        }

        if (!codici.has(target)) {
          emit(issues, config, "rel_target_mancante", {
            categoria: "coerenza",
            messaggio: `US ${us.codiceUS}: il campo "${ref.campo}" fa riferimento a "${targetRaw}" non presente nel cantiere`,
            campoInteressato: ref.campo,
            usId: us.id,
          });
        }
      }
    }
  }

  // Verifica reciprocità relazioni inverse
  const INVERSE_PAIRS: [string, string][] = [
    ["copre", "coperto_da"],
    ["coperto_da", "copre"],
    ["taglia", "tagliatoDa"],
    ["tagliatoDa", "taglia"],
    ["riempie", "riempitoDa"],
    ["riempitoDa", "riempie"],
    ["siAppoggiaA", "gliSiAppoggia"],
    ["gliSiAppoggia", "siAppoggiaA"],
  ];

  const codeToUS = new Map<string, UnitaStratigrafica>();
  for (const us of usList) {
    codeToUS.set(normalizeCode(us.codiceUS), us);
  }

  const reciprocalSeen = new Set<string>();

  for (const us of usList) {
    const sourceCode = normalizeCode(us.codiceUS);
    const refs = extractRelationFields(us);

    for (const ref of refs) {
      const inverseField = INVERSE_PAIRS.find(([campo]) => campo === ref.campo)?.[1];
      if (!inverseField) continue;

      const targets = parseRelationCodes(ref.val);
      for (const targetRaw of targets) {
        const targetCode = normalizeCode(targetRaw);
        if (!targetCode || targetCode === sourceCode) continue;

        const key = `${sourceCode}:${ref.campo}:${targetCode}`;
        if (reciprocalSeen.has(key)) continue;
        reciprocalSeen.add(key);

        const targetUS = codeToUS.get(targetCode);
        if (!targetUS) continue;

        const inverseRefs = extractRelationFields(targetUS);
        const inverseRef = inverseRefs.find((r) => r.campo === inverseField);
        const inverseCodes = parseRelationCodes(inverseRef?.val).map(normalizeCode);

        if (!inverseCodes.includes(sourceCode)) {
          emit(issues, config, "rel_inversa_mancante", {
            categoria: "coerenza",
            messaggio: `US ${us.codiceUS} "${ref.campo}" → ${targetRaw}, ma ${targetRaw} non ha "${inverseField}" → ${us.codiceUS}`,
            campoInteressato: ref.campo,
            usId: us.id,
          });
        }
      }
    }
  }

  return issues;
}

export interface GiornataQcResult {
  issues: QcIssue[];
  status: "ok" | "warning" | "error";
}

export function checkGiornata(
  giornata: Giornata,
  allegatiGiornata: Allegato[],
): GiornataQcResult {
  const issues: QcIssue[] = [];

  const hasPersonale =
    !!giornata.operatori ||
    !!giornata.scavatori ||
    !!giornata.archeologi ||
    !!giornata.topografo;
  if (!hasPersonale) {
    issues.push({
      livello: "error",
      categoria: "completezza",
      messaggio: "Personale non indicato per la giornata (scavatori, archeologi o topografo)",
      campoInteressato: "scavatori",
    });
  }
  if (!giornata.attivitaSvolta) {
    issues.push({
      livello: "warning",
      categoria: "completezza",
      messaggio: "Attività svolta non compilata",
      campoInteressato: "attivitaSvolta",
    });
  }
  if (!giornata.tipoScavo) {
    issues.push({
      livello: "warning",
      categoria: "completezza",
      messaggio: "Tipo di scavo non indicato (manuale/meccanico/misto)",
      campoInteressato: "tipoScavo",
    });
  }
  if (!giornata.settore) {
    issues.push({
      livello: "warning",
      categoria: "completezza",
      messaggio: "Settore non indicato per la giornata",
      campoInteressato: "settore",
    });
  }

  // Verifica allegati di giornata (almeno una foto)
  const fotoGiornata = allegatiGiornata.filter((a) => a.tipo === "foto" && !a.usId);
  if (fotoGiornata.length === 0) {
    issues.push({
      livello: "info",
      categoria: "associazione",
      messaggio: "Nessuna fotografia di giornata allegata",
      campoInteressato: "ha_foto",
    });
  }

  const hasError = issues.some((issue) => issue.livello === "error");
  const hasWarning = issues.some((issue) => issue.livello === "warning");
  const status = hasError ? "error" : hasWarning ? "warning" : "ok";

  return { issues, status };
}

export function checkAllUS(
  usList: UnitaStratigrafica[],
  allegatiPerUS: (usId: number) => Allegato[],
  configInput?: QcUsConfigInput | QcUsConfig | null,
): { issues: QcIssue[]; status: "ok" | "warning" | "error" } {
  const config = resolveQcUsConfig(configInput ?? null);
  const issues: QcIssue[] = [];
  for (const us of usList) {
    issues.push(...checkUS(us, allegatiPerUS(us.id), config));
  }
  issues.push(...checkCoerenzaStratigrafica(usList, config));
  const hasError = issues.some((i) => i.livello === "error");
  const hasWarning = issues.some((i) => i.livello === "warning");
  return { issues, status: hasError ? "error" : hasWarning ? "warning" : "ok" };
}
