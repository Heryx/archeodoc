import test from "node:test";
import assert from "node:assert/strict";
import { ParadatiError, listNodes, saveNode, suggestUid } from "../server/paradati";

async function withStorage<T>(fn: (storage: any, cid: number) => T | Promise<T>) {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const { createStorage } = await import("../server/storage");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "emnative-"));
  const storage = createStorage(path.join(dir, "t.db"));
  try {
    const c = storage.createCantiere({ codice: "T", nome: "T", localita: "x" } as any);
    for (const code of ["1", "2", "3"]) storage.createUS({ cantiereId: c.id, codiceUS: code } as any);
    return await fn(storage, c.id);
  } finally {
    (storage as any).db?.$client?.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("unita' virtuale: sequenza con US e altre unita' virtuali", async () => {
  await withStorage((storage, cid) => {
    const v1 = saveNode(storage, cid, { nodeType: "uv_strutturale", links: { sopraA: ["US 1"], sottoA: [] } });
    assert.equal(v1.uid, "UVS1");
    const v2 = saveNode(storage, cid, { nodeType: "uv_non_strutturale", uid: "UVN10", links: { sopraA: ["UVS1"], sottoA: ["3"] } });
    assert.deepEqual(v2.links.sopraA, ["UVS1"]);
    assert.deepEqual(v2.links.sottoA, ["3"]);
    // l'altro estremo vede lo stesso arco dal suo lato
    assert.deepEqual(listNodes(storage, cid).find((n) => n.uid === "UVS1")!.links.sottoA, ["UVN10"]);
    const archi = storage.getArchiParadati(cid);
    assert.ok(archi.some((e: any) => e.edgeType === "sequenza" && e.sourceRef === "UVN10" && e.targetRef === "UVS1"));
    assert.ok(archi.some((e: any) => e.edgeType === "sequenza" && e.sourceKind === "us" && e.sourceRef === "US 3"));

    // un campo non indicato resta invariato, uno vuoto svuota
    saveNode(storage, cid, { id: v2.id, links: { sopraA: [] } });
    const again = listNodes(storage, cid).find((n) => n.uid === "UVN10")!;
    assert.deepEqual(again.links.sopraA, []);
    assert.deepEqual(again.links.sottoA, ["3"]);
  });
});

test("paradati: documento -> estrattore -> proprieta' con provenienza", async () => {
  await withStorage((storage, cid) => {
    const doc = saveNode(storage, cid, { nodeType: "documento", descrizione: "Rilievo 1987" });
    const ex = saveNode(storage, cid, { nodeType: "estrattore", links: { fonti: [doc.uid] } });
    const comb = saveNode(storage, cid, { nodeType: "combinatore", links: { estrattori: [ex.uid] } });
    assert.deepEqual([doc.uid, ex.uid, comb.uid], ["DOC.1", "EST.1", "COMB.1"]);
    const prop = saveNode(storage, cid, {
      nodeType: "proprieta",
      nome: "materiale",
      descrizione: "tufo",
      dati: { tipo_proprieta: "materiale" },
      links: { appartieneA: ["US 2"], provenienza: [comb.uid] },
    });
    assert.deepEqual(prop.links, { appartieneA: ["2"], provenienza: ["COMB.1"] });
    assert.equal(prop.dati.tipo_proprieta, "materiale");
    assert.equal(suggestUid("documento", storage.getNodiParadati(cid)), "DOC.2");
  });
});

test("validazioni: tipi ammessi, duplicati, rinomina e cancellazione", async () => {
  await withStorage((storage, cid) => {
    const doc = saveNode(storage, cid, { nodeType: "documento" });
    const ex = saveNode(storage, cid, { nodeType: "estrattore", links: { fonti: ["DOC.1"] } });
    assert.throws(() => saveNode(storage, cid, { nodeType: "combinatore", links: { estrattori: ["DOC.1"] } }), /non ammesso/);
    assert.throws(() => saveNode(storage, cid, { nodeType: "estrattore", links: { fonti: ["US 99"] } }), /non trovato/);
    assert.throws(() => saveNode(storage, cid, { nodeType: "documento", uid: "DOC.1" }), (e: any) => e instanceof ParadatiError && e.status === 409);
    assert.throws(() => saveNode(storage, cid, { nodeType: "documento", uid: "US 2" }), /coincide/);
    assert.throws(() => saveNode(storage, cid, { nodeType: "bogus" }), /non valido/);
    assert.throws(() => saveNode(storage, cid, { id: ex.id, nodeType: "documento" }), /non si può cambiare/);

    // rinomina: gli archi seguono
    saveNode(storage, cid, { id: doc.id, uid: "DOC.Rilievo" });
    assert.deepEqual(listNodes(storage, cid).find((n) => n.id === ex.id)!.links.fonti, ["DOC.Rilievo"]);

    assert.equal(storage.deleteNodoParadati(doc.id), true);
    assert.deepEqual(listNodes(storage, cid).find((n) => n.id === ex.id)!.links.fonti, []);
    storage.deleteCantiere(cid);
    assert.deepEqual(storage.getNodiParadati(cid), []);
    assert.deepEqual(storage.getArchiParadati(cid), []);
  });
});

test("esporta e reimporta unita' virtuali e paradati", async () => {
  const { buildEmJson } = await import("../server/em_json");
  const { loadGraph } = await import("../server/paradati");
  const { planEmImport, applyEmImport } = await import("../server/em_json_import");
  let doc: any;
  let cantiere: any;
  await withStorage((storage, cid) => {
    cantiere = storage.getCantiere(cid);
    saveNode(storage, cid, { nodeType: "uv_strutturale", links: { sopraA: ["US 1"], sottoA: ["US 3"] } });
    const d = saveNode(storage, cid, { nodeType: "documento", descrizione: "Rilievo 1987" });
    const x = saveNode(storage, cid, { nodeType: "estrattore", links: { fonti: [d.uid] } });
    saveNode(storage, cid, {
      nodeType: "proprieta", nome: "materiale", descrizione: "tufo", dati: { tipo_proprieta: "materiale" },
      links: { appartieneA: ["UVS1"], provenienza: [x.uid] },
    });
    doc = buildEmJson(cantiere, storage.getUSList(cid), { paradatiGraph: loadGraph(storage, cid), includeEpochs: false });
  });

  const byType = (t: string) => doc.graph.nodes.filter((n: any) => n.node_type === t);
  assert.equal(byType("USVs").length, 1);
  assert.equal(byType("property")[0].name, "materiale");
  assert.equal(byType("property")[0].description, "tufo");
  assert.ok(doc.graph.edges.some((e: any) => e.edge_type === "is_after" && e.source === "UVS1" && e.target === "1"));
  assert.ok(doc.graph.edges.some((e: any) => e.edge_type === "is_after" && e.source === "3" && e.target === "UVS1"));
  assert.ok(doc.graph.edges.some((e: any) => e.edge_type === "extracted_from" && e.source === "EST.1" && e.target === "DOC.1"));
  assert.ok(doc.graph.edges.some((e: any) => e.edge_type === "has_property" && e.source === "UVS1"));

  // in un cantiere con le stesse US ma senza nodi EM: tutto da importare, poi piu' nulla
  await withStorage((storage, cid) => {
    const text = JSON.stringify(doc);
    const plan = planEmImport(text, storage.getUSList(cid), [], loadGraph(storage, cid));
    assert.deepEqual(plan.emNodes.map((n) => n.uid).sort(), ["DOC.1", "UVS1", "EST.1", expect_prop(plan)].sort());
    assert.equal(plan.emLinks.length, 5);
    const res = applyEmImport(storage, storage.getCantiere(cid), text, [...plan.emNodes.map((n) => n.key), ...plan.emLinks.map((l) => l.key)]);
    assert.equal(res.createdEmNodes, 4);
    assert.equal(res.addedEmLinks, 5);
    const again = planEmImport(text, storage.getUSList(cid), [], loadGraph(storage, cid));
    assert.deepEqual([again.emNodes.length, again.emLinks.length], [0, 0]);
    const v = listNodes(storage, cid).find((n) => n.uid === "UVS1")!;
    assert.deepEqual([v.links.sopraA, v.links.sottoA], [["1"], ["3"]]);
  });
});

function expect_prop(plan: { emNodes: { uid: string; nodeType: string }[] }) {
  return plan.emNodes.find((n) => n.nodeType === "proprieta")!.uid;
}

test("matrix: le unita' virtuali sono nodi della sequenza (non in modalita' fisica)", async () => {
  const { buildMatrixGraph, exportHarrisMatrixPdf } = await import("../server/matrix_export");
  const { loadGraph } = await import("../server/paradati");
  await withStorage(async (storage, cid) => {
    storage.updateUS(storage.getUSList(cid)[0].id, { copre: "2" });
    saveNode(storage, cid, { nodeType: "uv_strutturale", links: { sopraA: ["US 2"], sottoA: ["US 1"] } });
    const paradatiGraph = loadGraph(storage, cid);
    const g = buildMatrixGraph(storage.getUSList(cid), "all", {}, paradatiGraph);
    const v = g.nodes.find((n) => n.label === "UVS1")!;
    assert.equal(v.forma, "virtuale");
    const n1 = g.nodes.find((n) => n.label === "1")!;
    const n2 = g.nodes.find((n) => n.label === "2")!;
    assert.ok(n1.y < v.y && v.y < n2.y, "1 sopra la virtuale, la virtuale sopra 2");
    assert.ok(g.edges.some((e) => e.from === n1.key && e.to === v.key && e.type === "posteriore"));
    assert.equal(buildMatrixGraph(storage.getUSList(cid), "fisica", {}, paradatiGraph).nodes.some((n) => n.forma === "virtuale"), false);
    const pdf = await exportHarrisMatrixPdf(storage.getCantiere(cid), storage.getUSList(cid), "all", { paradatiGraph });
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  });
});

test("migrazione: un database con le vecchie tabelle viene rinominato e tradotto", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const Database = (await import("better-sqlite3")).default;
  const { createStorage } = await import("../server/storage");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paradati-mig-"));
  const file = path.join(dir, "old.db");
  const old = new Database(file);
  old.exec(`
    CREATE TABLE em_nodi (id INTEGER PRIMARY KEY AUTOINCREMENT, cantiere_id INTEGER NOT NULL, uid TEXT NOT NULL,
      node_type TEXT NOT NULL, nome TEXT, descrizione TEXT, dati TEXT, created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX idx_em_nodi_cantiere_uid ON em_nodi (cantiere_id, uid);
    CREATE TABLE em_archi (id INTEGER PRIMARY KEY AUTOINCREMENT, cantiere_id INTEGER NOT NULL, edge_type TEXT NOT NULL,
      source_kind TEXT NOT NULL, source_ref TEXT NOT NULL, target_kind TEXT NOT NULL, target_ref TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO em_nodi (cantiere_id, uid, node_type, nome, dati, created_at) VALUES
      (1, 'USVs1', 'USVs', NULL, NULL, 'x'),
      (1, 'P1', 'property', 'material', '{"property_type":"material"}', 'x');
    INSERT INTO em_archi (cantiere_id, edge_type, source_kind, source_ref, target_kind, target_ref, created_at)
      VALUES (1, 'has_property', 'em', 'USVs1', 'em', 'P1', 'x'), (1, 'is_after', 'us', 'US 1', 'em', 'USVs1', 'x');
  `);
  old.close();
  const storage = createStorage(file);
  try {
    const nodi = storage.getNodiParadati(1);
    assert.deepEqual(nodi.map((n) => [n.uid, n.nodeType]), [["P1", "proprieta"], ["USVs1", "uv_strutturale"]].sort());
    assert.deepEqual(JSON.parse(nodi.find((n) => n.uid === "P1")!.dati!), { tipo_proprieta: "material" });
    const archi = storage.getArchiParadati(1);
    assert.deepEqual(archi.map((a) => [a.edgeType, a.sourceKind, a.targetKind]), [["ha_proprieta", "nodo", "nodo"], ["sequenza", "us", "nodo"]]);
  } finally {
    (storage as any).db?.$client?.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
