import type { Express } from "express";
import type { WithProject } from "./types";
import { checkCoerenzaStratigrafica, checkGiornata, checkUS } from "../qc";

export function registerQCRoutes(app: Express, withProject: WithProject) {
  // QC
  app.post("/api/giornate/:id/qc", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const giornata = ctx.storage.getGiornata(id);
    if (!giornata) return res.status(404).json({ error: "Giornata non trovata" });

    const usList = ctx.storage.getUSList(giornata.cantiereId, id);
    const allegatiGiornata = ctx.storage.getAllegati(giornata.cantiereId, id);
    const tutteLeUS = ctx.storage.getUSList(giornata.cantiereId);
    const result = checkGiornata(giornata, usList, allegatiGiornata, tutteLeUS);

    ctx.storage.updateGiornata(id, { qcStatus: result.status, qcReport: JSON.stringify(result.issues) });
    ctx.storage.deleteQcLogsByGiornata(id);

    for (const issue of result.issues) {
      ctx.storage.createQcLog({
        cantiereId: giornata.cantiereId,
        giornataId: id,
        usId: issue.usId || null,
        livello: issue.livello,
        categoria: issue.categoria,
        messaggio: issue.messaggio,
        campoInteressato: issue.campoInteressato || null,
      });
    }

    for (const us of usList) {
      const usIssues = result.issues.filter((i) => i.usId === us.id);
      ctx.storage.updateUS(us.id, {
        qcStatus: usIssues.some((i) => i.livello === "error")
          ? "error"
          : usIssues.some((i) => i.livello === "warning")
            ? "warning"
            : "ok",
        qcProblemi: JSON.stringify(usIssues),
      });
    }

    res.json(result);
  }));

  // QC globale cantiere: esegue QC su tutte le giornate
  app.post("/api/cantieri/:cid/qc-all", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const giornate = ctx.storage.getGiornate(cid);
    const tutteLeUS = ctx.storage.getUSList(cid);
    let totalOk = 0, totalWarning = 0, totalError = 0;

    for (const giornata of giornate) {
      const usList = ctx.storage.getUSList(cid, giornata.id);
      const allegatiGiornata = ctx.storage.getAllegati(cid, giornata.id);
      const result = checkGiornata(giornata, usList, allegatiGiornata, tutteLeUS);

      ctx.storage.updateGiornata(giornata.id, { qcStatus: result.status, qcReport: JSON.stringify(result.issues) });
      ctx.storage.deleteQcLogsByGiornata(giornata.id);

      for (const issue of result.issues) {
        ctx.storage.createQcLog({
          cantiereId: cid,
          giornataId: giornata.id,
          usId: issue.usId || null,
          livello: issue.livello,
          categoria: issue.categoria,
          messaggio: issue.messaggio,
          campoInteressato: issue.campoInteressato || null,
        });
      }

      for (const us of usList) {
        const usIssues = result.issues.filter((i) => i.usId === us.id);
        ctx.storage.updateUS(us.id, {
          qcStatus: usIssues.some((i) => i.livello === "error") ? "error"
            : usIssues.some((i) => i.livello === "warning") ? "warning" : "ok",
          qcProblemi: JSON.stringify(usIssues),
        });
      }

      if (result.status === "ok") totalOk++;
      else if (result.status === "warning") totalWarning++;
      else totalError++;
    }

    res.json({ ok: true, giornate: giornate.length, totalOk, totalWarning, totalError });
  }));

  app.post("/api/us/:id/qc", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });

    const allegatiUS = ctx.storage.getAllegati(us.cantiereId, undefined, id);
    const tutteLeUS = ctx.storage.getUSList(us.cantiereId);

    const usIssues = checkUS(us, allegatiUS);
    const coerenzaIssues = checkCoerenzaStratigrafica(tutteLeUS).filter((issue) => issue.usId === id);
    const issues = [...usIssues, ...coerenzaIssues];

    const hasError = issues.some((issue) => issue.livello === "error");
    const hasWarning = issues.some((issue) => issue.livello === "warning");
    const status = hasError ? "error" : hasWarning ? "warning" : "ok";

    ctx.storage.updateUS(id, {
      qcStatus: status,
      qcProblemi: JSON.stringify(issues),
    });

    ctx.storage.deleteQcLogsByUS(id);
    for (const issue of issues) {
      ctx.storage.createQcLog({
        cantiereId: us.cantiereId,
        giornataId: us.giornataId || null,
        usId: id,
        livello: issue.livello,
        categoria: issue.categoria,
        messaggio: issue.messaggio,
        campoInteressato: issue.campoInteressato || null,
      });
    }

    res.json({
      usId: id,
      codiceUS: us.codiceUS,
      status,
      issues,
    });
  }));

  app.get("/api/giornate/:id/qc-logs", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const giornata = ctx.storage.getGiornata(id);
    if (!giornata) return res.status(404).json({ error: "Giornata non trovata" });
    res.json(ctx.storage.getQcLogs(giornata.cantiereId, id));
  }));
}
