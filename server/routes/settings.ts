import type { Express } from "express";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import multer from "multer";
import Database from "better-sqlite3";
import type { WithProject } from "./types";
import { AI_AVAILABLE, AI_PROVIDER, reloadAIProvider } from "../ai";
import { getAnthropicModel } from "../anthropic_model";
import { isValidAnthropicModelId } from "@shared/anthropic_models";
import { getAllSettings, setSetting, resetToDefault } from "../ai_settings";
import { getQcUsConfig, setQcUsConfig, resetQcUsConfig } from "../qc_settings";
import { QC_US_RULES } from "@shared/qc_us_rules";
import { getLogPath, logger } from "../logger";
import { getStorageForProject } from "../projects";

type GitCommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  message?: string;
};

const AI_CONFIG_DEFAULT_FILES = ["contesto.md", "relazione.md", "schede.md", "stile.md"];
const AI_CONFIG_DEFAULT_CONTENT: Record<string, string> = {
  "contesto.md": "Descrivi qui contesto del sito, cronologia e metodologia di scavo.\n",
  "relazione.md": "Descrivi qui come impostare la relazione finale (struttura, stile, standard).\n",
  "schede.md": "Descrivi qui regole e convenzioni per compilare le schede US.\n",
  "stile.md": "Descrivi qui tono, lessico e convenzioni redazionali.\n",
};

function safeAiConfigFileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toLowerCase();
  if (!cleaned) return null;
  if (!/^[a-z0-9._-]+\.md$/.test(cleaned)) return null;
  return cleaned;
}

function runGitCommand(args: string[], cwd: string): GitCommandResult {
  try {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf-8",
      windowsHide: true,
      timeout: 15000,
    });
    const stdout = String(result.stdout || "").trim();
    const stderr = String(result.stderr || "").trim();

    if (result.error) {
      return {
        ok: false,
        stdout,
        stderr,
        message: result.error.message || "Errore esecuzione comando git",
      };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        stdout,
        stderr,
        message: stderr || `Comando git fallito (${args.join(" ")})`,
      };
    }
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function registerSettingsRoutes(app: Express, withProject: WithProject) {
  // ─── Impostazioni AI: lettura chiavi dal .env ─────────────────────────────
  app.get("/api/settings/ai", (_req, res) => {
    // Restituisce le chiavi mascherate (mostra solo se presenti, non il valore)
    const geminiKey = process.env.GEMINI_API_KEY?.trim() || "";
    const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() || "";
    const openaiKey = process.env.OPENAI_API_KEY?.trim() || "";
    const aiProvider = process.env.AI_PROVIDER?.trim() || "";
    res.json({
      geminiKeySet: geminiKey.length > 0,
      anthropicKeySet: anthropicKey.length > 0,
      openaiKeySet: openaiKey.length > 0,
      geminiKeyPreview: geminiKey.length > 6 ? geminiKey.slice(0, 4) + "..." + geminiKey.slice(-4) : (geminiKey.length > 0 ? "***" : ""),
      anthropicKeyPreview: anthropicKey.length > 6 ? anthropicKey.slice(0, 8) + "..." + anthropicKey.slice(-4) : (anthropicKey.length > 0 ? "***" : ""),
      openaiKeyPreview: openaiKey.length > 6 ? openaiKey.slice(0, 4) + "..." + openaiKey.slice(-4) : (openaiKey.length > 0 ? "***" : ""),
      aiProvider: aiProvider || "auto",
      anthropicModel: getAnthropicModel(),
      currentProvider: AI_PROVIDER,
      available: AI_AVAILABLE,
    });
  });

  // ─── Impostazioni AI: salvataggio chiavi nel .env ──────────────────────────
  app.post("/api/settings/ai", (req, res) => {
    const { geminiKey, anthropicKey, openaiKey, aiProvider, anthropicModel } = req.body as {
      geminiKey?: string;
      anthropicKey?: string;
      openaiKey?: string;
      aiProvider?: string;
      anthropicModel?: string;
    };
    if (anthropicModel !== undefined && !isValidAnthropicModelId(anthropicModel.trim())) {
      return res.status(400).json({ error: "ID modello Claude non valido" });
    }

    // Percorso del file .env nella root del progetto (accanto a package.json)
    const envPath = path.join(process.cwd(), ".env");

    // Leggi il .env esistente (se presente)
    let envContent = "";
    try {
      envContent = fs.readFileSync(envPath, "utf-8");
    } catch {
      envContent = "";
    }

    // Helper: aggiorna o inserisce una variabile nel contenuto .env
    function setEnvVar(content: string, key: string, value: string | undefined): string {
      if (value === undefined || value === null) return content; // non toccare se non passato
      const trimmed = value.trim();
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (trimmed === "") {
        // Rimuovi la riga se il valore è vuoto
        return content.replace(regex, "").replace(/\n{3,}/g, "\n\n").trim();
      }
      if (regex.test(content)) {
        return content.replace(regex, `${key}=${trimmed}`);
      }
      return content ? content.trimEnd() + `\n${key}=${trimmed}\n` : `${key}=${trimmed}\n`;
    }

    let updated = envContent;
    if (geminiKey !== undefined) updated = setEnvVar(updated, "GEMINI_API_KEY", geminiKey);
    if (anthropicKey !== undefined) updated = setEnvVar(updated, "ANTHROPIC_API_KEY", anthropicKey);
    if (openaiKey !== undefined) updated = setEnvVar(updated, "OPENAI_API_KEY", openaiKey);
    if (anthropicModel !== undefined) updated = setEnvVar(updated, "ANTHROPIC_MODEL", anthropicModel);
    if (aiProvider !== undefined) updated = setEnvVar(updated, "AI_PROVIDER", aiProvider === "auto" ? "" : aiProvider);

    try {
      fs.writeFileSync(envPath, updated.trimEnd() + "\n", "utf-8");
    } catch (e: any) {
      return res.status(500).json({ error: "Impossibile scrivere il file .env: " + e.message });
    }

    // Ricarica le variabili in process.env immediatamente
    if (geminiKey !== undefined) {
      const v = geminiKey.trim();
      if (v) process.env.GEMINI_API_KEY = v;
      else delete process.env.GEMINI_API_KEY;
    }
    if (anthropicKey !== undefined) {
      const v = anthropicKey.trim();
      if (v) process.env.ANTHROPIC_API_KEY = v;
      else delete process.env.ANTHROPIC_API_KEY;
    }
    if (openaiKey !== undefined) {
      const v = openaiKey.trim();
      if (v) process.env.OPENAI_API_KEY = v;
      else delete process.env.OPENAI_API_KEY;
    }
    if (anthropicModel !== undefined) {
      const v = anthropicModel.trim();
      if (v) process.env.ANTHROPIC_MODEL = v;
      else delete process.env.ANTHROPIC_MODEL;
    }
    if (aiProvider !== undefined) {
      if (aiProvider && aiProvider !== "auto") process.env.AI_PROVIDER = aiProvider.trim();
      else delete process.env.AI_PROVIDER;
    }

    // Ricarica il provider AI immediatamente (senza riavvio del server)
    const newState = reloadAIProvider();
    res.json({
      ok: true,
      provider: newState.provider,
      available: newState.available,
      message: "Impostazioni salvate. Il provider AI è stato aggiornato.",
    });
  });

  // AI status — verifica quale provider AI è configurato
  app.get("/api/ai/status", (_req, res) => {
    res.json({ available: AI_AVAILABLE, provider: AI_PROVIDER });
  });

  // Controllo aggiornamenti applicazione (on-demand dalla UI)
  app.get("/api/app/updates/check", (_req, res) => {
    const checkedAt = new Date().toISOString();
    const cwd = process.cwd();

    const gitVersion = runGitCommand(["--version"], cwd);
    if (!gitVersion.ok) {
      return res.json({
        checkedAt,
        gitAvailable: false,
        isRepo: false,
        hasUpdates: false,
        branch: null,
        behind: 0,
        ahead: 0,
        currentCommit: null,
        remoteCommit: null,
        remoteUrl: null,
        fetchError: null,
        message: "Git non disponibile in questo ambiente.",
      });
    }

    const repoCheck = runGitCommand(["rev-parse", "--is-inside-work-tree"], cwd);
    if (!repoCheck.ok || repoCheck.stdout !== "true") {
      return res.json({
        checkedAt,
        gitAvailable: true,
        isRepo: false,
        hasUpdates: false,
        branch: null,
        behind: 0,
        ahead: 0,
        currentCommit: null,
        remoteCommit: null,
        remoteUrl: null,
        fetchError: null,
        message: "Installazione locale non collegata a un repository Git.",
      });
    }

    const branchResult = runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    const branch = branchResult.ok && branchResult.stdout ? branchResult.stdout : "main";

    const remoteUrlResult = runGitCommand(["config", "--get", "remote.origin.url"], cwd);
    const remoteUrl = remoteUrlResult.ok && remoteUrlResult.stdout ? remoteUrlResult.stdout : null;

    const fetchResult = runGitCommand(["fetch", "origin", branch, "--quiet"], cwd);
    const fetchError = fetchResult.ok ? null : fetchResult.message || "Fetch origin fallita";
    if (fetchError) {
      logger.warn("Controllo aggiornamenti GitHub: fetch fallita", { branch, message: fetchError });
    }

    const behindResult = runGitCommand(["rev-list", "--count", `HEAD..origin/${branch}`], cwd);
    const aheadResult = runGitCommand(["rev-list", "--count", `origin/${branch}..HEAD`], cwd);
    const currentCommitResult = runGitCommand(["rev-parse", "HEAD"], cwd);
    const remoteCommitResult = runGitCommand(["rev-parse", `origin/${branch}`], cwd);

    const behindRaw = Number.parseInt(behindResult.stdout || "0", 10);
    const aheadRaw = Number.parseInt(aheadResult.stdout || "0", 10);
    const behind = Number.isFinite(behindRaw) ? behindRaw : 0;
    const ahead = Number.isFinite(aheadRaw) ? aheadRaw : 0;
    const hasUpdates = behind > 0;

    return res.json({
      checkedAt,
      gitAvailable: true,
      isRepo: true,
      hasUpdates,
      branch,
      behind,
      ahead,
      currentCommit: currentCommitResult.ok && currentCommitResult.stdout ? currentCommitResult.stdout : null,
      remoteCommit: remoteCommitResult.ok && remoteCommitResult.stdout ? remoteCommitResult.stdout : null,
      remoteUrl,
      fetchError,
      message: fetchError ? "Impossibile aggiornare i riferimenti remoti." : null,
    });
  });

  app.post("/api/app/updates/apply", (_req, res) => {
    const cwd = process.cwd();

    const gitVersion = runGitCommand(["--version"], cwd);
    if (!gitVersion.ok) {
      return res.status(400).json({
        ok: false,
        message: "Git non disponibile in questo ambiente.",
      });
    }

    const repoCheck = runGitCommand(["rev-parse", "--is-inside-work-tree"], cwd);
    if (!repoCheck.ok || repoCheck.stdout !== "true") {
      return res.status(400).json({
        ok: false,
        message: "Installazione locale non collegata a un repository Git.",
      });
    }

    const branchResult = runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    const branch = branchResult.ok && branchResult.stdout ? branchResult.stdout : "main";

    const fetchResult = runGitCommand(["fetch", "origin", branch, "--quiet"], cwd);
    if (!fetchResult.ok) {
      const message = fetchResult.message || "Fetch origin fallita";
      logger.warn("Aggiorna ora: fetch fallita", { branch, message });
      return res.status(500).json({
        ok: false,
        message,
      });
    }

    const beforeBehindResult = runGitCommand(["rev-list", "--count", `HEAD..origin/${branch}`], cwd);
    const beforeBehindRaw = Number.parseInt(beforeBehindResult.stdout || "0", 10);
    const beforeBehind = Number.isFinite(beforeBehindRaw) ? beforeBehindRaw : 0;

    if (beforeBehind <= 0) {
      const currentCommit = runGitCommand(["rev-parse", "HEAD"], cwd);
      const remoteCommit = runGitCommand(["rev-parse", `origin/${branch}`], cwd);
      return res.json({
        ok: true,
        branch,
        pulled: false,
        beforeBehind: 0,
        afterBehind: 0,
        updatedCommits: 0,
        message: "Nessun aggiornamento disponibile.",
        restartRecommended: false,
        currentCommit: currentCommit.ok && currentCommit.stdout ? currentCommit.stdout : null,
        remoteCommit: remoteCommit.ok && remoteCommit.stdout ? remoteCommit.stdout : null,
      });
    }

    const pullResult = runGitCommand(["pull", "--ff-only", "origin", branch], cwd);
    if (!pullResult.ok) {
      const message = pullResult.message || "git pull fallito";
      logger.error("Aggiorna ora: pull fallita", { branch, message });
      return res.status(500).json({
        ok: false,
        message,
      });
    }

    const afterBehindResult = runGitCommand(["rev-list", "--count", `HEAD..origin/${branch}`], cwd);
    const afterBehindRaw = Number.parseInt(afterBehindResult.stdout || "0", 10);
    const afterBehind = Number.isFinite(afterBehindRaw) ? afterBehindRaw : 0;
    const updatedCommits = Math.max(0, beforeBehind - afterBehind);
    const currentCommit = runGitCommand(["rev-parse", "HEAD"], cwd);
    const remoteCommit = runGitCommand(["rev-parse", `origin/${branch}`], cwd);

    logger.info("Aggiorna ora completato", {
      branch,
      updatedCommits,
      beforeBehind,
      afterBehind,
    });

    return res.json({
      ok: true,
      branch,
      pulled: true,
      beforeBehind,
      afterBehind,
      updatedCommits,
      message: `Aggiornamento completato su ${branch}.`,
      restartRecommended: true,
      currentCommit: currentCommit.ok && currentCommit.stdout ? currentCommit.stdout : null,
      remoteCommit: remoteCommit.ok && remoteCommit.stdout ? remoteCommit.stdout : null,
    });
  });

  // ─── Istruzioni AI personalizzabili ─────────────────────────────────────────
  app.get("/api/settings/ai-prompts", (_req, res) => {
    const settings = getAllSettings();
    res.json(settings);
  });

  app.put("/api/settings/ai-prompts/:key", (req, res) => {
    const { key } = req.params;
    const { value } = req.body as { value: string };
    if (!value || typeof value !== "string") {
      return res.status(400).json({ error: "value è obbligatorio" });
    }
    setSetting(key, value);
    res.json({ ok: true });
  });

  app.post("/api/settings/ai-prompts/reset", (req, res) => {
    const { key } = req.body as { key: string };
    const ok = resetToDefault(key);
    if (!ok) return res.status(404).json({ error: "Chiave non trovata o file default mancante" });
    const newValue = getAllSettings().find((s) => s.key === key)?.value ?? "";
    res.json({ ok: true, value: newValue });
  });

  // ─── Regole Controllo Qualità US personalizzabili ──────────────────────────
  app.get("/api/settings/qc-us-rules", (_req, res) => {
    res.json({ rules: QC_US_RULES, config: getQcUsConfig() });
  });

  app.put("/api/settings/qc-us-rules", (req, res) => {
    const body = (req.body ?? {}) as { levels?: unknown; thresholds?: unknown };
    const config = setQcUsConfig({
      levels: (body.levels && typeof body.levels === "object" ? body.levels : {}) as Record<string, any>,
      thresholds: (body.thresholds && typeof body.thresholds === "object" ? body.thresholds : {}) as Record<string, any>,
    });
    res.json({ ok: true, config });
  });

  app.post("/api/settings/qc-us-rules/reset", (_req, res) => {
    res.json({ ok: true, config: resetQcUsConfig() });
  });

  // ─── Log di sistema ────────────────────────────────────────────────────────
  app.get("/api/settings/ai-config", withProject((ctx, _req, res) => {
    fs.mkdirSync(ctx.project.aiConfigDir, { recursive: true });

    const names = fs
      .readdirSync(ctx.project.aiConfigDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "it"));

    for (const fallbackName of AI_CONFIG_DEFAULT_FILES) {
      if (names.includes(fallbackName)) continue;
      fs.writeFileSync(
        path.join(ctx.project.aiConfigDir, fallbackName),
        AI_CONFIG_DEFAULT_CONTENT[fallbackName] || "",
        "utf-8",
      );
      names.push(fallbackName);
    }

    const files = names
      .sort((a, b) => a.localeCompare(b, "it"))
      .map((name) => {
        const absolutePath = path.join(ctx.project.aiConfigDir, name);
        const stat = fs.statSync(absolutePath);
        return {
          name,
          content: fs.readFileSync(absolutePath, "utf-8"),
          updatedAt: stat.mtime.toISOString(),
          size: stat.size,
        };
      });

    res.json({
      projectId: ctx.project.id,
      directory: ctx.project.aiConfigDir,
      files,
    });
  }));

  app.put("/api/settings/ai-config/:name", withProject((ctx, req, res) => {
    const fileName = safeAiConfigFileName(req.params.name);
    if (!fileName) return res.status(400).json({ error: "Nome file non valido" });

    const content = typeof req.body?.content === "string" ? req.body.content : "";
    const absolutePath = path.join(ctx.project.aiConfigDir, fileName);

    fs.mkdirSync(ctx.project.aiConfigDir, { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf-8");

    const stat = fs.statSync(absolutePath);
    res.json({
      ok: true,
      file: {
        name: fileName,
        updatedAt: stat.mtime.toISOString(),
        size: stat.size,
      },
    });
  }));

  app.get("/api/logs", (_req, res) => {
    const logPath = getLogPath();
    if (!fs.existsSync(logPath)) return res.json({ lines: [], path: logPath, totalLines: 0 });
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const last200 = lines.slice(-200);
    res.json({ lines: last200, path: logPath, totalLines: lines.length });
  });

  app.get("/api/logs/download", (_req, res) => {
    const logPath = getLogPath();
    if (!fs.existsSync(logPath)) return res.status(404).json({ error: "Nessun file di log" });
    res.download(logPath, "archeodoc.log");
  });

  app.post("/api/logs/clear", (_req, res) => {
    const logPath = getLogPath();
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      // On Windows the file may be transiently locked; retry a few times before giving up
      let lastErr: any;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const fd = fs.openSync(logPath, "w");
          fs.closeSync(fd);
          lastErr = null;
          break;
        } catch (e: any) {
          lastErr = e;
          if (e?.code !== "EBUSY") break;
          // busy — wait 100 ms and retry
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        }
      }
      if (lastErr) throw lastErr;
      res.json({ ok: true, path: logPath });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Impossibile svuotare il file di log" });
    }
  });

  // ─── Dismiss QC logs ──────────────────────────────────────────────────────
  app.post("/api/qc-logs/:id/dismiss", withProject((ctx, req, res) => {
    const id = Number(req.params.id);
    const { dismissed } = req.body as { dismissed: boolean };
    if (dismissed) {
      ctx.storage.dismissQcLog(id);
    } else {
      ctx.storage.undismissQcLog(id);
    }
    res.json({ ok: true });
  }));

  // ─── Database admin ────────────────────────────────────────────────────────

  const PROTECTED_TABLES = new Set(["sqlite_master", "sqlite_sequence", "sqlite_stat1"]);
  const PROTECTED_COLUMNS: Record<string, Set<string>> = {
    cantieri: new Set(["id", "nome", "created_at"]),
    giornate: new Set(["id", "cantiere_id", "data"]),
    unita_stratigrafiche: new Set(["id", "cantiere_id", "numero"]),
    allegati: new Set(["id", "cantiere_id"]),
    qc_logs: new Set(["id"]),
  };

  function openProjectDb(project: { dbPath: string }): Database.Database {
    return new Database(project.dbPath, { fileMustExist: true });
  }

  app.get("/api/db/tables", withProject((ctx, _req, res) => {
    const db = openProjectDb(ctx.project);
    try {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all() as Array<{ name: string }>;
      const result = tables.map((t) => {
        const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all() as Array<{
          cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number;
        }>;
        const rowCount = (db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get() as { cnt: number }).cnt;
        return {
          name: t.name,
          rowCount,
          columns: cols.map((c) => ({
            cid: c.cid,
            name: c.name,
            type: c.type,
            notnull: c.notnull === 1,
            dflt_value: c.dflt_value,
            pk: c.pk === 1,
            protected: !!(PROTECTED_COLUMNS[t.name]?.has(c.name) || c.pk === 1),
          })),
        };
      });
      res.json(result);
    } finally {
      db.close();
    }
  }));

  app.get("/api/db/tables/:table/rows", withProject((ctx, req, res) => {
    const table = String(req.params.table);
    if (PROTECTED_TABLES.has(table)) return res.status(403).json({ error: "Tabella protetta" });
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const db = openProjectDb(ctx.project);
    try {
      const rows = db.prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`).all(limit, offset);
      res.json(rows);
    } finally {
      db.close();
    }
  }));

  app.delete("/api/db/tables/:table/rows/:id", withProject((ctx, req, res) => {
    const table = String(req.params.table);
    const id = Number(req.params.id);
    if (PROTECTED_TABLES.has(table)) return res.status(403).json({ error: "Tabella protetta" });
    if (!Number.isFinite(id)) return res.status(400).json({ error: "ID non valido" });
    const db = openProjectDb(ctx.project);
    try {
      const result = ctx.storage.history.trackTable(table, id, "delete", () =>
        db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id),
      );
      if (result.changes === 0) return res.status(404).json({ error: "Riga non trovata" });
      // Reload storage cache so ORM stays consistent
      getStorageForProject(ctx.project.id);
      res.json({ ok: true, deleted: id });
    } finally {
      db.close();
    }
  }));

  app.patch("/api/db/tables/:table/rows/:id", withProject((ctx, req, res) => {
    const table = String(req.params.table);
    const id = Number(req.params.id);
    if (PROTECTED_TABLES.has(table)) return res.status(403).json({ error: "Tabella protetta" });
    if (!Number.isFinite(id)) return res.status(400).json({ error: "ID non valido" });

    const { column, value } = req.body as { column: string; value: unknown };
    if (typeof column !== "string" || !column.trim()) {
      return res.status(400).json({ error: "Parametro 'column' mancante" });
    }

    const db = openProjectDb(ctx.project);
    try {
      const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; pk: number }>;
      const col = cols.find((c) => c.name === column);
      if (!col) return res.status(404).json({ error: "Colonna non trovata" });
      if (col.pk) return res.status(403).json({ error: "Impossibile modificare la chiave primaria" });

      const result = ctx.storage.history.trackTable(table, id, "update", () =>
        db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE id = ?`).run(
          value === "" || value === null ? null : value,
          id,
        ),
      );
      if (result.changes === 0) return res.status(404).json({ error: "Riga non trovata" });

      const updated = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
      res.json({ ok: true, row: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Errore aggiornamento" });
    } finally {
      db.close();
    }
  }));

  app.delete("/api/db/tables/:table/columns/:column", withProject((ctx, req, res) => {
    const table = String(req.params.table);
    const column = String(req.params.column);
    if (PROTECTED_TABLES.has(table)) return res.status(403).json({ error: "Tabella protetta" });
    if (PROTECTED_COLUMNS[table]?.has(column)) return res.status(403).json({ error: "Colonna protetta" });
    const db = openProjectDb(ctx.project);
    try {
      // Check column is PK
      const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; pk: number }>;
      const col = cols.find((c) => c.name === column);
      if (!col) return res.status(404).json({ error: "Colonna non trovata" });
      if (col.pk) return res.status(403).json({ error: "Impossibile eliminare una colonna chiave primaria" });

      // SQLite >= 3.35 supports DROP COLUMN natively
      db.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
      res.json({ ok: true, table, column });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Errore eliminazione colonna" });
    } finally {
      db.close();
    }
  }));

  // Backup download
  app.get("/api/db/backup", withProject(async (ctx, _req, res) => {
    const backupPath = ctx.project.dbPath + ".backup-admin.sqlite";
    const db = openProjectDb(ctx.project);
    try {
      await db.backup(backupPath);
      res.download(backupPath, `archeodoc-backup-${new Date().toISOString().slice(0, 10)}.sqlite`, () => {
        try { fs.unlinkSync(backupPath); } catch { /* ignore */ }
      });
    } catch (e: any) {
      try { db.close(); } catch { /* ignore */ }
      res.status(500).json({ error: e.message });
    }
  }));

  // Restore upload
  const dbUpload = multer({ dest: os.tmpdir() });
  app.post("/api/db/restore", dbUpload.single("db"), withProject(async (ctx, req, res) => {
    if (!req.file) return res.status(400).json({ error: "Nessun file caricato" });
    const tmpPath = req.file.path;
    try {
      // Validate it's a valid SQLite file
      const testDb = new Database(tmpPath, { fileMustExist: true });
      testDb.prepare("SELECT 1").get();
      testDb.close();

      // Backup current before overwrite
      const bakPath = ctx.project.dbPath + ".pre-restore.sqlite";
      fs.copyFileSync(ctx.project.dbPath, bakPath);

      fs.copyFileSync(tmpPath, ctx.project.dbPath);
      fs.unlinkSync(tmpPath);

      // Force reload storage
      getStorageForProject(ctx.project.id);

      res.json({ ok: true, message: "Database ripristinato. Riavviare l'applicazione per applicare le modifiche." });
    } catch (e: any) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      res.status(500).json({ error: e.message || "File non valido o errore durante il ripristino" });
    }
  }));
}
