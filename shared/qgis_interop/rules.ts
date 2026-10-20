import rulesJson from "./rules.json";

export type QgisInteropRules = typeof rulesJson;

/**
 * Fonte di verita' unica per le regole di validazione dell'interoperabilita' QGIS <-> ArcheoDoc.
 * Il contenuto vive in rules.json (leggibile anche da un plugin QGIS in Python, senza dipendere da TS).
 * Non ridefinire qui i valori: importare e riesportare soltanto.
 */
export const qgisInteropRules: QgisInteropRules = rulesJson;

export const US_CODE_FIELD_CANDIDATES = qgisInteropRules.usCodeField.candidates;
export const INTEROP_FOLDER_NAME = qgisInteropRules.interopFolder.name;
export const INTEROP_FILE_NAMES = qgisInteropRules.interopFolder.files;
