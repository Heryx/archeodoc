import type { Express } from "express";
import fs from "fs";
import path from "path";
import type { WithProject } from "./types";
import { AI_AVAILABLE, AI_PROVIDER, reloadAIProvider } from "../ai";
import { getAllSettings, setSetting, resetToDefault } from "../ai_settings";
import { getLogPath } from "../logger";

export function registerSettingsRoutes(app: Express, withProject: WithProject) {
  // ─── Impostazioni AI: lettura chiavi dal .env ─────────────────────────────
  app.get("/api/settings/ai", (_req, res) => {
    // Restituisce le chiavi mascherate (mostra solo se presenti, non il valore)
    const geminiKey = process.env.GEMINI_API_KEY?.trim() || "";
    const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() || "";
    const aiProvider = process.env.AI_PROVIDER?.trim() || "";
    res.json({
      geminiKeySet: geminiKey.length > 0,
      anthropicKeySet: anthropicKey.length > 0,
      geminiKeyPreview: geminiKey.length > 6 ? geminiKey.slice(0, 4) + "..." + geminiKey.slice(-4) : (geminiKey.length > 0 ? "***" : ""),
      anthropicKeyPreview: anthropicKey.length > 6 ? anthropicKey.slice(0, 8) + "..." + anthropicKey.slice(-4) : (anthropicKey.length > 0 ? "***" : ""),
      aiProvider: aiProvider || "auto",
      currentProvider: AI_PROVIDER,
      available: AI_AVAILABLE,
    });
  });

  // ─── Impostazioni AI: salvataggio chiavi nel .env ──────────────────────────
  app.post("/api/settings/ai", (req, res) => {
    const { geminiKey, anthropicKey, aiProvider } = req.body as {
      geminiKey?: string;
      anthropicKey?: string;
      aiProvider?: string;
    };

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

  // ─── Log di sistema ────────────────────────────────────────────────────────
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
}
