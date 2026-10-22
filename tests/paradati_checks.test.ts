import test from "node:test";
import assert from "node:assert/strict";
import { saveNode } from "../server/paradati";
import { checkParadati } from "../server/paradati_checks";

async function withStorage<T>(fn: (storage: any, cid: number) => T | Promise<T>) {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const { createStorage } = await import("../server/storage");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "emchecks-"));
  const storage = createStorage(path.join(dir, "t.db"));
  try {
    const c = storage.createCantiere({ codice: "T", nome: "T", localita: "x" } as any);
    storage.createUS({ cantiereId: c.id, codiceUS: "1", copre: "2" } as any);
    storage.createUS({ cantiereId: c.id, codiceUS: "2", coperto_da: "1" } as any);
    return await fn(storage, c.id);
  } finally {
    (storage as any).db?.$client?.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("nessuna segnalazione per una catena di paradati completa", async () => {
  await withStorage((storage, cid) => {
    saveNode(storage, cid, { nodeType: "uv_strutturale", links: { sopraA: ["2"], sottoA: ["1"] } });
    saveNode(storage, cid, { nodeType: "documento" });
    saveNode(storage, cid, { nodeType: "estrattore", links: { fonti: ["DOC.1"] } });
    saveNode(storage, cid, {
      nodeType: "proprieta", nome: "material", descrizione: "tufo",
      links: { appartieneA: ["UVS1"], provenienza: ["EST.1"] },
    });
    assert.deepEqual(checkParadati(storage, cid), []);
  });
});

test("paradati incompleti e unita' virtuale isolata", async () => {
  await withStorage((storage, cid) => {
    saveNode(storage, cid, { nodeType: "uv_non_strutturale" });
    saveNode(storage, cid, { nodeType: "documento" });
    saveNode(storage, cid, { nodeType: "estrattore" });
    saveNode(storage, cid, { nodeType: "combinatore" });
    saveNode(storage, cid, { nodeType: "proprieta", descrizione: "rosso" });
    const text = checkParadati(storage, cid).map((i) => `${i.livello}|${i.messaggio}`).join("\n");
    assert.match(text, /warning\|UVN1 non è collegata alla sequenza/);
    assert.match(text, /warning\|L'estrattore EST\.1 non indica da quale fonte/);
    assert.match(text, /warning\|Il combinatore COMB\.1 non combina nessun estrattore/);
    assert.match(text, /warning\|La proprietà PROP\.1 non appartiene a nessuna/);
    assert.match(text, /warning\|La proprietà PROP\.1 .*non ha provenienza/);
    assert.match(text, /info\|Il documento DOC.1 non è la fonte di nessun estrattore/);
    assert.match(text, /info\|L'estrattore EST\.1 non è usato/);
  });
});

test("ciclo che passa per un'unita' virtuale", async () => {
  await withStorage((storage, cid) => {
    // 1 copre 2, ma la virtuale sta sotto la 2 e sopra la 1: 1 > 2 > V > 1
    saveNode(storage, cid, { nodeType: "uv_strutturale", links: { sopraA: ["1"], sottoA: ["2"] } });
    const issues = checkParadati(storage, cid).filter((i) => i.livello === "error");
    assert.equal(issues.length, 1);
    assert.match(issues[0].messaggio, /Ciclo nella sequenza tra 1, 2, UVS1/);
    assert.equal(issues[0].nodo, "UVS1");
  });
});
