/**
 * Nodi Extended Matrix del cantiere: unita' virtuali e paradati.
 * GET    /api/cantieri/:id/em/nodi        → nodi con i collegamenti + descrizione dei tipi
 * GET    /api/cantieri/:id/em/controlli   → cicli con le unita' virtuali e completezza dei paradati
 * GET    /api/cantieri/:id/em/uid?type=   → nome proposto per un nuovo nodo
 * POST   /api/cantieri/:id/em/nodi        → nuovo nodo
 * PUT    /api/em/nodi/:id                 → modifica (nome, descrizione, dati, collegamenti)
 * DELETE /api/em/nodi/:id                 → elimina il nodo e i suoi collegamenti
 */
import type { Express } from "express";
import type { WithProject } from "./types";
import { checkExtendedMatrix } from "../em_checks";
import {
  EM_FIELDS_BY_TYPE,
  EM_LINK_SPECS,
  EM_NODE_TYPES,
  EM_TYPE_LABEL,
  EmError,
  listEmNodes,
  saveEmNode,
  suggestUid,
  type EmNodeType,
} from "../em_native";

export function registerEmNodiRoutes(app: Express, withProject: WithProject) {
  const fail = (res: any, error: any) =>
    res.status(error instanceof EmError ? error.status : 500).json({ error: error.message || "Errore" });

  app.get("/api/cantieri/:id/em/nodi", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    if (!ctx.storage.getCantiere(id)) return res.status(404).json({ error: "Cantiere non trovato" });
    res.json({
      nodes: listEmNodes(ctx.storage, id),
      tipi: EM_NODE_TYPES.map((type) => ({
        type,
        label: EM_TYPE_LABEL[type],
        fields: EM_FIELDS_BY_TYPE[type].map((field) => ({
          field,
          label: EM_LINK_SPECS[field].label,
          // tipi di nodo ammessi come altro estremo e se ammette le US
          accepts: { us: EM_LINK_SPECS[field].other.us, em: EM_LINK_SPECS[field].other.em },
        })),
      })),
    });
  }));

  app.get("/api/cantieri/:id/em/controlli", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    if (!ctx.storage.getCantiere(id)) return res.status(404).json({ error: "Cantiere non trovato" });
    res.json({ issues: checkExtendedMatrix(ctx.storage, id) });
  }));

  app.get("/api/cantieri/:id/em/uid", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    if (!ctx.storage.getCantiere(id)) return res.status(404).json({ error: "Cantiere non trovato" });
    const type = String(req.query.type ?? "") as EmNodeType;
    if (!(EM_NODE_TYPES as readonly string[]).includes(type)) return res.status(400).json({ error: "Tipo non valido" });
    res.json({ uid: suggestUid(type, ctx.storage.getEmNodi(id)) });
  }));

  app.post("/api/cantieri/:id/em/nodi", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    if (!ctx.storage.getCantiere(id)) return res.status(404).json({ error: "Cantiere non trovato" });
    try {
      res.json(saveEmNode(ctx.storage, id, { ...req.body, id: undefined }));
    } catch (error) {
      fail(res, error);
    }
  }));

  app.put("/api/em/nodi/:id", withProject((ctx, req, res) => {
    const node = ctx.storage.getEmNodo(Number(req.params.id));
    if (!node) return res.status(404).json({ error: "Nodo non trovato" });
    try {
      res.json(saveEmNode(ctx.storage, node.cantiereId, { ...req.body, id: node.id, nodeType: node.nodeType }));
    } catch (error) {
      fail(res, error);
    }
  }));

  app.delete("/api/em/nodi/:id", withProject((ctx, req, res) => {
    if (!ctx.storage.deleteEmNodo(Number(req.params.id))) return res.status(404).json({ error: "Nodo non trovato" });
    res.json({ ok: true });
  }));
}
