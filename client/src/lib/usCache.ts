import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalida in un colpo solo tutte le query che dipendono dai dati US di un cantiere.
 * Serve a mantenere allineate "Schede US" ed "Elenco US" (e viste derivate: giornate,
 * Harris matrix, QC, relazioni inverse) qualunque sia la pagina da cui parte la modifica.
 *
 * L'invalidazione è per prefisso (match non esatto), quindi copre automaticamente le
 * varianti di chiave che includono l'id progetto attivo.
 */
export function invalidateUsRelatedQueries(qc: QueryClient, cid: string | number | undefined | null): void {
  const key = cid == null ? null : String(cid);
  qc.invalidateQueries({
    predicate: (query) => {
      const k = query.queryKey;
      if (!Array.isArray(k)) return false;
      const [root, c, section] = k as unknown[];
      if (root === "/api/us") return true; // pending-inverses, delete-impact, ecc.
      if (root !== "/api/cantieri") return false;
      if (key != null && String(c) !== key) return false;
      return (
        section === "us" ||
        section === "elenco-us" ||
        section === "giornate" ||
        section === "matrix" ||
        section === "qc"
      );
    },
  });
}
