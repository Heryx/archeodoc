import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createStorage } from "../server/storage";

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archeodoc-history-"));
  const storage = createStorage(path.join(dir, "project.sqlite"));
  const cantiere = storage.createCantiere({ codice: "T1", nome: "Test", localita: "Firenze" } as any);
  const us = storage.createUS({ cantiereId: cantiere.id, codiceUS: "10", copre: "11, 12", descrizione: "Strato" } as any);
  return { dir, storage, cantiere, us };
}

test("una modifica salva lo stato precedente in un file JSON", () => {
  const { dir, storage, us } = setup();
  storage.updateUS(us.id, { copre: "11" });

  const files = fs.readdirSync(path.join(dir, "storico", "us", String(us.id)));
  assert.equal(files.length, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "storico", "us", String(us.id), files[0]), "utf8"));
  assert.equal(saved.before.copre, "11, 12");
  assert.deepEqual(saved.changes, { copre: "11" });
  assert.equal(saved.entityType, "us");
});

test("le modifiche che non cambiano nulla (o solo campi automatici) non creano versioni", () => {
  const { storage, us } = setup();
  storage.updateUS(us.id, { copre: "11, 12" });
  storage.updateUS(us.id, { qcStatus: "ok", qcProblemi: "[]" });
  assert.equal(storage.history.list({ entityType: "us", entityId: us.id }).length, 0);
});

test("salvataggi ravvicinati restano una sola versione, con lo stato di prima della prima modifica", () => {
  const { storage, us } = setup();
  storage.updateUS(us.id, { copre: "11" });
  storage.updateUS(us.id, { copre: "11", descrizione: "Nuovo testo" });
  storage.updateUS(us.id, { copre: "" });

  const versions = storage.history.list({ entityType: "us", entityId: us.id });
  assert.equal(versions.length, 1);
  const detail = storage.history.get(versions[0].id)!;
  const copre = detail.fields.find((f) => f.key === "copre")!;
  assert.equal(copre.before, "11, 12");
  assert.equal(copre.after, "");
});

test("si puo' annullare un solo campo lasciando gli altri come sono ora", () => {
  const { storage, us } = setup();
  storage.updateUS(us.id, { copre: "", descrizione: "Testo sbagliato" });
  const [version] = storage.history.list({ entityType: "us", entityId: us.id });

  const result = storage.history.restore(version.id, ["copre"]);
  assert.deepEqual(result.restored, ["Copre"]);
  const now = storage.getUS(us.id)!;
  assert.equal(now.copre, "11, 12");
  assert.equal(now.descrizione, "Testo sbagliato");
});

test("i campi della scheda (JSON) si ripristinano uno per uno", () => {
  const { storage, cantiere } = setup();
  const us = storage.createUS({
    cantiereId: cantiere.id,
    codiceUS: "20",
    schedaData: JSON.stringify({ colore: "bruno", misure: "2x3" }),
  } as any);
  storage.updateUS(us.id, { schedaData: JSON.stringify({ colore: "grigio", misure: "9x9" }) });

  const [version] = storage.history.list({ entityType: "us", entityId: us.id });
  const detail = storage.history.get(version.id)!;
  assert.deepEqual(detail.fields.map((f) => f.key).sort(), ["scheda_data.colore", "scheda_data.misure"]);

  storage.history.restore(version.id, ["scheda_data.colore"]);
  assert.deepEqual(JSON.parse(storage.getUS(us.id)!.schedaData!), { colore: "bruno", misure: "9x9" });
});

test("il ripristino e' a sua volta annullabile", () => {
  const { storage, us } = setup();
  storage.updateUS(us.id, { descrizione: "Prima modifica" });
  const [first] = storage.history.list({ entityType: "us", entityId: us.id });
  storage.history.restore(first.id);
  assert.equal(storage.getUS(us.id)!.descrizione, "Strato");

  const versions = storage.history.list({ entityType: "us", entityId: us.id });
  const undo = versions.find((v) => v.source === "ripristino" || v.id !== first.id);
  assert.ok(undo, "il ripristino deve comparire in cronologia");
  storage.history.restore(undo!.id);
  assert.equal(storage.getUS(us.id)!.descrizione, "Prima modifica");
});

test("una US eliminata si recupera con i suoi allegati e i collegamenti", () => {
  const { storage, cantiere, us } = setup();
  const allegato = storage.createAllegato({
    cantiereId: cantiere.id, usId: us.id, tipo: "foto", nomeFile: "a.jpg", percorso: "1/a.jpg",
  } as any);
  const ra = storage.createRaRecord({ cantiereId: cantiere.id, usId: us.id, codice: "RA1" } as any);

  assert.equal(storage.deleteUS(us.id), true);
  assert.equal(storage.getUS(us.id), undefined);
  assert.equal(storage.getAllegato(allegato.id), undefined);
  assert.equal(storage.getRaRecord(ra.id)!.usId, null);

  const [version] = storage.history.list({ entityType: "us", action: "delete", cantiereId: cantiere.id });
  assert.equal(version.label, "US 10");
  assert.equal(version.relatedCount, 1);

  const result = storage.history.restore(version.id);
  assert.deepEqual(result.attachmentPaths, ["1/a.jpg"]);
  assert.equal(storage.getUS(us.id)!.copre, "11, 12");
  assert.equal(storage.getAllegato(allegato.id)!.nomeFile, "a.jpg");
  assert.equal(storage.getRaRecord(ra.id)!.usId, us.id);
  assert.throws(() => storage.history.restore(version.id), /esiste già/);
});

test("eliminare un cantiere salva prima una copia completa del database", () => {
  const { dir, storage, cantiere } = setup();
  storage.deleteCantiere(cantiere.id);
  const backups = fs.readdirSync(path.join(dir, "backups"));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^pre-elimina-cantiere-\d+-.*\.sqlite$/);
});

test("gli id di versione non permettono di uscire dalla cartella dello storico", () => {
  const { storage } = setup();
  assert.equal(storage.history.get("us~1~../../project"), null);
  assert.equal(storage.history.get("../x~1~y"), null);
  assert.throws(() => storage.history.restore("us~1~../../x"), /non trovata/);
});
