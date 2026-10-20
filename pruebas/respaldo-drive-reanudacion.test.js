// Ensayo local sintético; no usa Google Drive, D1 ni credenciales.
// Preparado para la validación conjunta; no ejecutado al crear el archivo.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../herramientas/subir-respaldo-cifrado-drive.sh", import.meta.url));
const fakeRclone = "#!/usr/bin/env bash\nset -euo pipefail\ncase \"$1\" in\n  md5sum)\n    rel=\"$(printf '%s' \"$2\" | sed 's/^[^:]*://')\"\n    f=\"$RCLONE_FAKE_DIR/$rel\"\n    [ -f \"$f\" ] || exit 3\n    md5sum \"$f\" | awk -v n=\"$rel\" '{ print $1 \"  \" n }'\n    ;;\n  copyto)\n    src=\"$4\"\n    rel=\"$(printf '%s' \"$5\" | sed 's/^[^:]*://')\"\n    f=\"$RCLONE_FAKE_DIR/$rel\"\n    if [ -f \"$f\" ]; then cmp -s \"$src\" \"$f\" || exit 12; exit 0; fi\n    if [[ \"$rel\" == *.sha256 && ! -e \"$RCLONE_FAKE_DIR/fallo-consumido\" ]]; then\n      touch \"$RCLONE_FAKE_DIR/fallo-consumido\"\n      exit 13\n    fi\n    cp \"$src\" \"$f\"\n    ;;\n  *) exit 14 ;;\nesac\n";

test("transferencia parcial retoma el manifiesto sin alterar lo ya guardado", () => {
  const base = mkdtempSync(join(tmpdir(), "castano-rclone-ficticio-"));
  try {
    const bin = join(base, "bin"), remoto = join(base, "remoto");
    mkdirSync(bin); mkdirSync(remoto);
    const cmd = join(bin, "rclone");
    writeFileSync(cmd, fakeRclone);
    chmodSync(cmd, 0o755);
    const nombre = "d1-20261020T000000Z.sql.age";
    const cifrado = join(base, nombre);
    writeFileSync(cifrado, "datos-cifrados-ficticios");
    const hash = createHash("sha256").update(readFileSync(cifrado)).digest("hex");
    writeFileSync(cifrado + ".sha256", hash + "  " + nombre + "\n");
    const env = { ...process.env, RCLONE_FAKE_DIR: remoto, BACKUP_DRIVE_REMOTE: "ensayo:", PATH: bin + ":" + process.env.PATH };
    const ejecutar = () => spawnSync("bash", [script, cifrado], { env, encoding: "utf8" });
    assert.notEqual(ejecutar().status, 0);
    assert.ok(existsSync(join(remoto, nombre)));
    assert.ok(!existsSync(join(remoto, nombre + ".sha256")));
    assert.equal(ejecutar().status, 0);
    assert.deepEqual(readFileSync(join(remoto, nombre)), readFileSync(cifrado));
    assert.ok(existsSync(join(remoto, nombre + ".sha256")));
    writeFileSync(join(remoto, nombre), "remoto-distinto");
    assert.notEqual(ejecutar().status, 0);
    assert.equal(readFileSync(join(remoto, nombre), "utf8"), "remoto-distinto");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
