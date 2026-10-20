// Sólo pruebas sintéticas: npx, age y reloj simulados. Python usa SQLite real
// para comprobar que el SQL puede aplicarse, sin Cloudflare ni secretos.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const exportar = join(root, "herramientas", "respaldo-d1-cifrado.sh");
const restaurar = join(root, "herramientas", "verificar-restauracion-d1-local.sh");
const testDb = "castano-respaldo-sintetico-20261020";
const idDb = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const idProd = "cccccccc-1111-4222-8333-dddddddddddd";
const fakeNpx = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "echo INVOCADO >> \"$MOCK_CALLED_FILE\"",
  "[ \"$1\" = '--yes' ] && [ \"$2\" = 'wrangler@4.151.2' ] && [ \"$3\" = 'd1' ] && [ \"$4\" = 'export' ] || exit 91",
  "[ \"$5\" = 'castano-respaldo-sintetico-20261020' ] || exit 92",
  "[ \"$MOCK_EXPORT_FAIL\" != 'SI' ] || exit 35",
  "while [ \"$#\" -gt 0 ]; do",
  "  if [ \"$1\" = '--output' ]; then",
  "    printf '%s\\n' 'CREATE TABLE ejemplo(id INTEGER PRIMARY KEY, valor INTEGER);' 'INSERT INTO ejemplo VALUES(1,7600);' 'INSERT INTO ejemplo VALUES(2,2500);' > \"$2\"",
  "    exit 0",
  "  fi",
  "  shift",
  "done",
  "exit 93"
].join("\n") + "\n";
const fakeSqlite = [
  "#!/usr/bin/env python3",
  "import sys, sqlite3",
  "if sys.argv[1]=='-readonly':",
  "    c=sqlite3.connect('file:'+sys.argv[2]+'?mode=ro',uri=True)",
  "    r=c.execute(sys.argv[3]).fetchone()",
  "    print(r[0] if r else '')",
  "    c.close()",
  "else:",
  "    c=sqlite3.connect(sys.argv[1])",
  "    c.executescript(sys.stdin.read())",
  "    c.commit()",
  "    assert c.execute('SELECT sum(valor) FROM ejemplo').fetchone()[0]==10100",
  "    c.close()"
].join("\n") + "\n";
const fakeAge = [
  "#!/usr/bin/env python3",
  "# NO CIFRA NADA; exclusivamente comprueba el flujo del programa.",
  "import sys,pathlib",
  "a=sys.argv[1:]",
  "if '-o' not in a: sys.exit(88)",
  "o=pathlib.Path(a[a.index('-o')+1])",
  "if '--decrypt' in a:",
  "    data=pathlib.Path(a[-1]).read_bytes()",
  "    if not data.startswith(b'ENSAYO_NO_CIFRADO:'): sys.exit(30)",
  "    o.write_bytes(data[len(b'ENSAYO_NO_CIFRADO:'):])",
  "else:",
  "    if '-r' not in a: sys.exit(89)",
  "    o.write_bytes(b'ENSAYO_NO_CIFRADO:'+pathlib.Path(a[-1]).read_bytes())"
].join("\n") + "\n";
function escenario() {
  const base = mkdtempSync(join(tmpdir(), "castano-d1-fase2-"));
  const bin = join(base, "bin"), salida = join(base, "privada");
  mkdirSync(bin); mkdirSync(salida); chmodSync(salida, 0o700);
  const ejecutable = (nombre, contenido) => {
    const p = join(bin, nombre); writeFileSync(p, contenido); chmodSync(p, 0o755); return p;
  };
  ejecutable("npx", fakeNpx);
  ejecutable("sqlite3", fakeSqlite);
  ejecutable("age", fakeAge);
  ejecutable("date", "#!/usr/bin/env bash\nprintf '20261020T000000Z\\n'\n");
  const config = join(base, "wrangler.respaldo-ensayo.jsonc");
  const conf = {
    name: "castano-respaldo-ensayo",
    d1_databases: [{ binding: "DB", database_name: testDb, database_id: idDb }]
  };
  writeFileSync(config, JSON.stringify(conf));
  const key = join(base, "clave-falsa-local");
  writeFileSync(key, "NO ES UNA CLAVE PRIVADA REAL");
  const llamado = join(base, "npx-llamado");
  const env = {
    ...process.env, PATH: bin + ":" + process.env.PATH,
    BACKUP_ACTIVE: "SI", BACKUP_MODO: "ENSAYO",
    BACKUP_TEST_DATABASE: testDb, BACKUP_TEST_DATABASE_ID: idDb,
    BACKUP_PRODUCTION_DATABASE_ID: idProd, BACKUP_TEST_CONFIG: config,
    BACKUP_DEST: salida, AGE_RECIPIENT: "age1" + "q".repeat(58),
    AGE_KEY_FILE: key, CLOUDFLARE_API_TOKEN: "FICTICIO_SIN_AUTORIDAD",
    MOCK_CALLED_FILE: llamado, MOCK_EXPORT_FAIL: "NO"
  };
  return { base, bin, salida, config, conf, key, llamado, env, ejecutable,
    run: (script, args=[], changes={}) => spawnSync("bash", [script, ...args], {
      encoding: "utf8", timeout: 12000, env: { ...env, ...changes }
    }),
    limpiar: () => rmSync(base, { recursive: true, force: true }) };
}
test("Desactivado por defecto y sin invocaciones de red", () => {
  const e=escenario();
  try {
    assert.notEqual(e.run(exportar, [], {BACKUP_ACTIVE:"NO"}).status,0);
    assert.notEqual(e.run(exportar, [], {BACKUP_MODO:"PRODUCCION"}).status,0);
    assert.deepEqual(readdirSync(e.salida),[]);
    assert.equal(existsSync(e.llamado),false);
  } finally { e.limpiar(); }
});
test("No permite D1 productiva, UUID de producción o identidad inconsistente", () => {
  const e=escenario();
  try {
    for (const cambios of [
      {BACKUP_TEST_DATABASE:"castano-facturas"},
      {BACKUP_TEST_DATABASE_ID:idProd},
      {BACKUP_PRODUCTION_DATABASE_ID:idDb},
      {BACKUP_TEST_DATABASE_ID:"UUID_INVALIDO"}
    ]) assert.notEqual(e.run(exportar, [], cambios).status,0);
    assert.equal(existsSync(e.llamado),false);
  } finally { e.limpiar(); }
});
test("Configuración Wrangler exacta; rechaza alias, prod, symlink y bindings extra", () => {
  const e=escenario();
  try {
    for (const c of [
      { ...e.conf, d1_databases:[{binding:"DB",database_name:"castano-facturas",database_id:idDb}] },
      { ...e.conf, d1_databases:[{binding:"DB",database_name:testDb,database_id:idProd}] },
      { ...e.conf, d1_databases:[...e.conf.d1_databases,...e.conf.d1_databases] },
      { ...e.conf, name:"basculaypension-web" },
      { ...e.conf, kv_namespaces:[{binding:"FILES",id:"invalido"}] },
      { ...e.conf, vars:{MODE:"produccion"} }
    ]) {
      writeFileSync(e.config, JSON.stringify(c));
      assert.notEqual(e.run(exportar).status,0);
    }
    writeFileSync(e.config, JSON.stringify(e.conf));
    const alias=join(e.base, "wrangler.jsonc");
    writeFileSync(alias, JSON.stringify(e.conf));
    assert.notEqual(e.run(exportar, [], {BACKUP_TEST_CONFIG:alias}).status,0);
    const symlink=join(e.base,"alias","wrangler.respaldo-ensayo.jsonc");
    mkdirSync(join(e.base,"alias")); symlinkSync(e.config,symlink);
    assert.notEqual(e.run(exportar, [], {BACKUP_TEST_CONFIG:symlink}).status,0);
    assert.equal(existsSync(e.llamado),false);
  } finally { e.limpiar(); }
});
test("No crea respaldo dentro del código ni acepta destinatario age incorrecto", () => {
  const e=escenario();
  const dentro=join(root, "TEMPORAL_FASE2_NO_GUARDAR");
  try {
    mkdirSync(dentro,{recursive:true});
    assert.notEqual(e.run(exportar, [], {BACKUP_DEST:dentro}).status,0);
    assert.notEqual(e.run(exportar, [], {AGE_RECIPIENT:"clave_privada"}).status,0);
    assert.equal(existsSync(e.llamado),false);
  } finally { rmSync(dentro,{recursive:true,force:true}); e.limpiar(); }
});
test("Destino con permisos de grupo u otro usuario se rechaza antes de exportar", () => {
  const e=escenario();
  try {
    chmodSync(e.salida,0o755);
    const r=e.run(exportar);
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/permisos 700/);
    assert.equal(existsSync(e.llamado),false);
  } finally { e.limpiar(); }
});
test("Fallo de exportación o cifrado no publica archivo ni manifiesto", () => {
  const e=escenario();
  try {
    assert.notEqual(e.run(exportar, [], {MOCK_EXPORT_FAIL:"SI"}).status,0);
    assert.deepEqual(readdirSync(e.salida),[]);
    e.ejecutable("age", "#!/usr/bin/env bash\nexit 49\n");
    assert.notEqual(e.run(exportar).status,0);
    assert.deepEqual(readdirSync(e.salida),[]);
  } finally { e.limpiar(); }
});
test("Exportar, revisar SQLite, cifrar simulado, SHA y descifrar local", () => {
  const e=escenario();
  try {
    const r=e.run(exportar);
    assert.equal(r.status,0, r.stderr);
    const files=readdirSync(e.salida);
    assert.equal(files.length,2);
    const archivo=join(e.salida,files.find(x=>x.endsWith(".sql.age")));
    assert.ok(existsSync(archivo+".sha256"));
    assert.equal(e.run(restaurar,[archivo]).status,0);
    assert.notEqual(e.run(exportar).status,0,"No sobrescribir respaldo del mismo segundo");
    assert.deepEqual(readdirSync(e.salida).sort(),files.sort());
    writeFileSync(archivo,"MODIFICADO");
    const error=e.run(restaurar,[archivo]);
    assert.notEqual(error.status,0);
    assert.match(error.stderr,/SHA-256/);
  } finally { e.limpiar(); }
});
test("Manifiesto cambiado y clave no válida bloquean restauración antes de escribir SQLite", () => {
  const e=escenario();
  try {
    assert.equal(e.run(exportar).status,0);
    const archivo=join(e.salida,readdirSync(e.salida).find(x=>x.endsWith(".sql.age")));
    writeFileSync(archivo+".sha256", "0".repeat(64)+"  otro-nombre.sql.age\n");
    assert.notEqual(e.run(restaurar,[archivo]).status,0);
    assert.notEqual(e.run(restaurar,[archivo],{AGE_KEY_FILE:"/no-existe"}).status,0);
  } finally { e.limpiar(); }
});
test("La restauración local no invoca Wrangler ni altera fuentes remotas", () => {
  const e=escenario();
  try {
    assert.equal(e.run(exportar).status,0);
    rmSync(e.llamado);
    const archivo=join(e.salida,readdirSync(e.salida).find(x=>x.endsWith(".sql.age")));
    const r=e.run(restaurar,[archivo]);
    assert.equal(r.status,0, r.stderr);
    assert.equal(existsSync(e.llamado),false);
    assert.match(r.stdout,/LOCAL/);
  } finally { e.limpiar(); }
});
