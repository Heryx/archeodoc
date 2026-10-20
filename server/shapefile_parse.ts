/**
 * Parsing shapefile (.shp/.dbf) minimale per uso server-side.
 *
 * Non importare "shpjs" con lo specifier normale: il suo entry point ("exports"
 * in package.json) tira dentro un modulo di unzip che referenzia la globale
 * browser `self`, inesistente in Node — fa crashare `node dist/index.cjs` in
 * produzione con "ReferenceError: self is not defined", anche se qui non serve
 * mai la funzionalita' di unzip. shpjs non espone i suoi moduli interni via
 * "exports" (Node rifiuta "shpjs/lib/parseShp.js" con ERR_PACKAGE_PATH_NOT_EXPORTED),
 * quindi si risolve il path assoluto del file e lo si importa direttamente:
 * la restrizione "exports" si applica solo alla risoluzione di specifier del
 * pacchetto, non a un path assoluto gia' calcolato.
 */
import path from "path";
import { pathToFileURL } from "url";
import { createRequire } from "module";
import proj4 from "proj4";
// @ts-expect-error nessun tipo pubblicato per il default export di parsedbf
import parseDbfBuffer from "parsedbf";

/**
 * In dev (tsx, ESM vero) serve createRequire(import.meta.url). Nel bundle di produzione
 * (esbuild -> dist/index.cjs) "import.meta.url" diventa undefined — createRequire(undefined)
 * crasha l'avvio — ma in quel contesto CJS il parametro `require` del modulo e' gia'
 * disponibile nello scope. Nota: la variabile locale NON puo' chiamarsi "require" (temporal
 * dead zone: leggerebbe se stessa invece del require esterno, prima di essere inizializzata).
 */
declare const require: NodeRequire | undefined;
const nodeRequire: NodeRequire = typeof require === "function" ? require : createRequire(pathToFileURL(path.join(process.cwd(), "package.json")).href);

type ParseShpFn = (dataView: DataView, trans: proj4.Converter | false) => GeoJSON.Geometry[];

let parseShpFnPromise: Promise<ParseShpFn> | null = null;

function loadParseShpFn(): Promise<ParseShpFn> {
  if (!parseShpFnPromise) {
    // require.resolve risolve solo il path (condizione "require" -> dist/shp.js), non lo esegue.
    const shpjsDistEntry = nodeRequire.resolve("shpjs");
    const shpjsRoot = path.dirname(path.dirname(shpjsDistEntry)); // .../shpjs/dist/shp.js -> .../shpjs
    const parseShpPath = path.join(shpjsRoot, "lib", "parseShp.js");
    parseShpFnPromise = import(pathToFileURL(parseShpPath).href).then((mod) => mod.default as ParseShpFn);
  }
  return parseShpFnPromise;
}

function toDataView(buffer: Buffer): DataView {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export async function parseShp(shpBuffer: Buffer, prjText?: string): Promise<GeoJSON.Geometry[]> {
  const parseShpFn = await loadParseShpFn();
  let trans: proj4.Converter | false = false;
  if (prjText) {
    try {
      trans = proj4(prjText);
    } catch {
      trans = false;
    }
  }
  return parseShpFn(toDataView(shpBuffer), trans);
}

export function parseDbf(dbfBuffer: Buffer, cpg?: string): Array<Record<string, unknown>> {
  return parseDbfBuffer(toDataView(dbfBuffer), cpg);
}

export function combineShp(
  shp: GeoJSON.Geometry[],
  dbf: Array<Record<string, unknown>> | undefined,
): GeoJSON.FeatureCollection {
  const rows = dbf || [];
  return {
    type: "FeatureCollection",
    features: shp.map((geometry, i) => ({
      type: "Feature",
      geometry,
      properties: rows[i] || {},
    })),
  };
}
