/**
 * Unita' virtuali e paradati del cantiere: unita' virtuali e paradati.
 * GET    /api/cantieri/:id/paradati/nodi        → nodi con i collegamenti + descrizione dei tipi
 * GET    /api/cantieri/:id/paradati/controlli   → cicli con le unita' virtuali e completezza dei paradati
 * GET    /api/cantieri/:id/paradati/uid?type=   → nome proposto per un nuovo nodo
 * POST   /api/cantieri/:id/paradati/nodi        → nuovo nodo
 * PUT    /api/paradati/nodi/:id                 → modifica (nome, descrizione, dati, collegamenti)
 * DELETE /api/paradati/nodi/:id                 → elimina il nodo e i suoi collegamenti
 */
import type { Express } from "express";
import type { WithProject } from "./types";
import { checkParadati } from "../paradati_checks";
import {
  LINK_FIELDS_BY_TYPE,
  LINK_SPECS,
  PARADATI_NODE_TYPES,
  NODE_TYPE_LABEL,
  ParadatiError,
  listNodes,
  saveNode,
  suggestUid,
  type ParadatiNodeType,
} from "../paradati";

export function registerParadatiRoutes(app: Express, withProject: WithProject) {
  const fail = (res: any, error: any) =>
    res.status(error instanceof ParadatiError ? error.status : 500).json({ error: error.message || "Errore" });

  app.get("/api/cantieri/:id/paradati/nodi", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    if (!ctx.storage.getCantiere(id)) return res.status(404).json({ error: "Cantiere non trovato" });
    res.json({
      nodes: listNodes(ctx.storage, id),
      tipi: PARADATI_NODE_TYPES.map((type) => ({
        type,
        label: NODE_TYPE_LABEL[type],
        fields: LINK_FIELDS_BY_TYPE[type].map((field) => ({
          field,
          label: LINK_SPECS[field].label,
          // tipi di nodo ammessi come altro estremo e se ammette le US
          accepts: { us: LINK_SPECS[field].other.us, em: LINK_SPECS[field].other.nodi },
        })),
      })),
    });
  }));

  app.get("/api/cantieri/:id/paradati/controlli", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    if (!ctx.storage.getCantiere(id)) return res.status(404).json({ error: "Cantiere non trovato" });
    res.json({ issues: checkParadati(ctx.storage, id) });
  }));

  app.get("/api/cantieri/:id/paradati/uid", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    if (!ctx.storage.getCantiere(id)) return res.status(404).json({ error: "Cantiere non trovato" });
    const type = String(req.query.type ?? "") as ParadatiNodeType;
    if (!(PARADATI_NODE_TYPES as readonly string[]).includes(type)) return res.status(400).json({ error: "Tipo non valido" });
    res.json({ uid: suggestUid(type, ctx.storage.getNodiParadati(id)) });
  }));

  app.post("/api/cantieri/:id/paradati/nodi", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    if (!ctx.storage.getCantiere(id)) return res.status(404).json({ error: "Cantiere non trovato" });
    try {
      res.json(saveNode(ctx.storage, id, { ...req.body, id: undefined }));
    } catch (error) {
      fail(res, error);
    }
  }));

  app.put("/api/paradati/nodi/:id", withProject((ctx, req, res) => {
    const node = ctx.storage.getNodoParadati(Number(req.params.id));
    if (!node) return res.status(404).json({ error: "Nodo non trovato" });
    try {
      res.json(saveNode(ctx.storage, node.cantiereId, { ...req.body, id: node.id, nodeType: node.nodeType }));
    } catch (error) {
      fail(res, error);
    }
  }));

  app.delete("/api/paradati/nodi/:id", withProject((ctx, req, res) => {
    if (!ctx.storage.deleteNodoParadati(Number(req.params.id))) return res.status(404).json({ error: "Nodo non trovato" });
    res.json({ ok: true });
  }));
}
