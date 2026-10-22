import type { Express } from "express";
import type { WithProject } from "./types";
import { checkAllUS, checkCicliStratigrafici, checkCoerenzaStratigrafica, checkGiornata, checkUS } from "../qc";
import { getQcUsConfigForProject } from "../qc_settings";
import { AI_AVAILABLE, analizzaRelazioniQC } from "../ai";

export function registerQCRoutes(app: Express, withProject: WithProject) {
  // QC
  app.post("/api/giornate/:id/qc", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const giornata = ctx.storage.getGiornata(id);
    if (!giornata) return res.status(404).json({ error: "Giornata non trovata" });

    const allegatiGiornata = ctx.storage.getAllegati(giornata.cantiereId, id);
    const result = checkGiornata(giornata, allegatiGiornata);

    ctx.storage.updateGiornata(id, { qcStatus: result.status, qcReport: JSON.stringify(result.issues) });
    ctx.storage.deleteQcLogsByGiornata(id);

    for (const issue of result.issues) {
      ctx.storage.createQcLog({
        cantiereId: giornata.cantiereId,
        giornataId: id,
        usId: null,
        livello: issue.livello,
        categoria: issue.categoria,
        messaggio: issue.messaggio,
        campoInteressato: issue.campoInteressato || null,
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

    // QC giornate (solo dati di giornata, non US)
    for (const giornata of giornate) {
      const allegatiGiornata = ctx.storage.getAllegati(cid, giornata.id);
      const result = checkGiornata(giornata, allegatiGiornata);

      ctx.storage.updateGiornata(giornata.id, { qcStatus: result.status, qcReport: JSON.stringify(result.issues) });
      ctx.storage.deleteQcLogsByGiornata(giornata.id);

      for (const issue of result.issues) {
        ctx.storage.createQcLog({
          cantiereId: cid,
          giornataId: giornata.id,
          usId: null,
          livello: issue.livello,
          categoria: issue.categoria,
          messaggio: issue.messaggio,
          campoInteressato: issue.campoInteressato || null,
        });
      }

      if (result.status === "ok") totalOk++;
      else if (result.status === "warning") totalWarning++;
      else totalError++;
    }

    // QC US indipendente dalle giornate
    const usResult = checkAllUS(tutteLeUS, (usId) => ctx.storage.getAllegati(cid, undefined, usId), getQcUsConfigForProject(ctx.project));
    for (const us of tutteLeUS) {
      const usIssues = usResult.issues.filter((i) => i.usId === us.id);
      ctx.storage.updateUS(us.id, {
        qcStatus: usIssues.some((i) => i.livello === "error") ? "error"
          : usIssues.some((i) => i.livello === "warning") ? "warning" : "ok",
        qcProblemi: JSON.stringify(usIssues),
      });
      ctx.storage.deleteQcLogsByUS(us.id);
      for (const issue of usIssues) {
        ctx.storage.createQcLog({
          cantiereId: cid,
          giornataId: null,
          usId: us.id,
          livello: issue.livello,
          categoria: issue.categoria,
          messaggio: issue.messaggio,
          campoInteressato: issue.campoInteressato || null,
        });
      }
    }

    res.json({ ok: true, giornate: giornate.length, us: tutteLeUS.length, totalOk, totalWarning, totalError });
  }));

  app.post("/api/us/:id/qc", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });

    const allegatiUS = ctx.storage.getAllegati(us.cantiereId, undefined, id);
    const tutteLeUS = ctx.storage.getUSList(us.cantiereId);

    const qcConfig = getQcUsConfigForProject(ctx.project);
    const usIssues = checkUS(us, allegatiUS, qcConfig);
    const coerenzaIssues = [
      ...checkCoerenzaStratigrafica(tutteLeUS, qcConfig),
      ...checkCicliStratigrafici(tutteLeUS, qcConfig),
    ].filter((issue) => issue.usId === id);
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

  app.get("/api/us/:id/qc-logs", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const us = ctx.storage.getUS(id);
    if (!us) return res.status(404).json({ error: "US non trovata" });
    res.json(ctx.storage.getQcLogsByUS(us.cantiereId, id));
  }));

  app.post("/api/cantieri/:cid/us-qc-all", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const tutteLeUS = ctx.storage.getUSList(cid);
    const usResult = checkAllUS(tutteLeUS, (usId) => ctx.storage.getAllegati(cid, undefined, usId), getQcUsConfigForProject(ctx.project));

    for (const us of tutteLeUS) {
      const usIssues = usResult.issues.filter((i) => i.usId === us.id);
      ctx.storage.updateUS(us.id, {
        qcStatus: usIssues.some((i) => i.livello === "error") ? "error"
          : usIssues.some((i) => i.livello === "warning") ? "warning" : "ok",
        qcProblemi: JSON.stringify(usIssues),
      });
      ctx.storage.deleteQcLogsByUS(us.id);
      for (const issue of usIssues) {
        ctx.storage.createQcLog({
          cantiereId: cid,
          giornataId: null,
          usId: us.id,
          livello: issue.livello,
          categoria: issue.categoria,
          messaggio: issue.messaggio,
          campoInteressato: issue.campoInteressato || null,
        });
      }
    }

    const totalOk = tutteLeUS.filter((u) => !usResult.issues.some((i) => i.usId === u.id)).length;
    const totalError = tutteLeUS.filter((u) => usResult.issues.some((i) => i.usId === u.id && i.livello === "error")).length;
    const totalWarning = tutteLeUS.filter((u) =>
      !usResult.issues.some((i) => i.usId === u.id && i.livello === "error") &&
      usResult.issues.some((i) => i.usId === u.id && i.livello === "warning")
    ).length;

    res.json({ ok: true, us: tutteLeUS.length, totalOk, totalWarning, totalError });
  }));

  // ── AI QC relazioni stratigrafiche ─────────────────────────────────────────
  app.post("/api/cantieri/:cid/qc-relazioni-ai", withProject(async (ctx, req, res) => {
    if (!AI_AVAILABLE) {
      return res.status(503).json({ error: "Nessun provider AI configurato. Configura una chiave API nelle Impostazioni." });
    }
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const tutteLeUS = ctx.storage.getUSList(cid);
    if (tutteLeUS.length === 0) {
      return res.json({ testo: "Nessuna US presente nel cantiere." });
    }

    try {
      const testo = await analizzaRelazioniQC(tutteLeUS);
      res.json({ testo });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Errore QC AI relazioni" });
    }
  }));
}
