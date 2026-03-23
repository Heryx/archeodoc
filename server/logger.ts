import fs from "fs";
import path from "path";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export function getLogPath(): string {
  return process.env.ARCHEODOC_LOG_PATH || path.join(process.cwd(), "logs", "archeodoc.log");
}

function ensureLogDir() {
  const dir = path.dirname(getLogPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function rotate() {
  const p = getLogPath();
  if (fs.existsSync(p) && fs.statSync(p).size > MAX_SIZE) {
    fs.renameSync(p, p + ".1");
  }
}

function write(level: string, msg: string, ctx?: unknown) {
  try {
    ensureLogDir();
    rotate();
    const ts = new Date().toISOString();
    const ctxStr = ctx !== undefined ? " " + JSON.stringify(ctx) : "";
    const line = `[${ts}] [${level}] ${msg}${ctxStr}\n`;
    fs.appendFileSync(getLogPath(), line, "utf-8");
  } catch { /* non bloccare mai il server per un errore di log */ }
}

export const logger = {
  debug: (msg: string, ctx?: unknown) => write("DEBUG", msg, ctx),
  info:  (msg: string, ctx?: unknown) => write("INFO",  msg, ctx),
  warn:  (msg: string, ctx?: unknown) => write("WARN",  msg, ctx),
  error: (msg: string, ctx?: unknown) => write("ERROR", msg, ctx),
};
