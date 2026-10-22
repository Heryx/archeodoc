/**
 * Corrispondenza fra i nomi interni di ArcheoDoc (unita' virtuali e paradati)
 * e i nomi usati dal formato di scambio .em.json di EM Studio.
 * Serve solo a export e import: il resto del programma usa i nomi interni.
 */

export const EM_TYPE_OF: Record<string, string> = {
  uv_strutturale: "USVs",
  uv_non_strutturale: "USVn",
  reperto_virtuale: "VSF",
  documento: "document",
  estrattore: "extractor",
  combinatore: "combiner",
  proprieta: "property",
};

export const INTERNAL_TYPE_OF: Record<string, string> = Object.fromEntries(
  Object.entries(EM_TYPE_OF).map(([internal, em]) => [em, internal]),
);

export const EM_EDGE_OF: Record<string, string> = {
  sequenza: "is_after",
  estratto_da: "extracted_from",
  combina: "combines",
  ha_proprieta: "has_property",
  ha_provenienza: "has_data_provenance",
};

export const INTERNAL_EDGE_OF: Record<string, string> = Object.fromEntries(
  Object.entries(EM_EDGE_OF).map(([internal, em]) => [em, internal]),
);
