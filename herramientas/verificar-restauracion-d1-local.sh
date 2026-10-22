#!/usr/bin/env bash
# Verifica integridad, descifra age y restaura una exportación SQL sólo en SQLite LOCAL.
# No usa Cloudflare, ni rclone/Drive, ni modifica base de datos alguna del Worker.
set -euo pipefail
umask 077
[ "$#" -eq 1 ] || { echo "Uso: bash herramientas/verificar-restauracion-d1-local.sh archivo.sql.age" >&2; exit 2; }
: "${AGE_KEY_FILE:?Indica la clave privada age CUSTODIADA LOCALMENTE (no compartirla)}"
[ -f "$AGE_KEY_FILE" ] && [ -r "$AGE_KEY_FILE" ] && [ ! -L "$AGE_KEY_FILE" ] || {
  echo "Clave local age no accesible o enlace simbólico no permitido" >&2; exit 2;
}
archivo="$1"
[[ "$(basename "$archivo")" =~ ^d1-[0-9]{8}T[0-9]{6}Z\.sql\.age$ ]] || {
  echo "Nombre inesperado del archivo de ensayo" >&2; exit 2;
}
for cmd in age sqlite3 mktemp; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Falta herramienta: $cmd" >&2; exit 2; }
done
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=respaldo-portable.sh
source "$root/herramientas/respaldo-portable.sh"
backup_verificar_sha256 "$archivo"
temporal="$(mktemp -d)"
trap 'rm -rf "$temporal"' EXIT
age --decrypt -i "$AGE_KEY_FILE" -o "$temporal/descifrado.sql" "$archivo"
[ -s "$temporal/descifrado.sql" ] || { echo "No se descifró SQL válido" >&2; exit 1; }
sqlite3 "$temporal/restauracion.sqlite" < "$temporal/descifrado.sql"
[ "$(sqlite3 -readonly "$temporal/restauracion.sqlite" "PRAGMA quick_check;")" = "ok" ] &&
[ "$(sqlite3 -readonly "$temporal/restauracion.sqlite" "PRAGMA integrity_check;")" = "ok" ] || {
  echo "Error de integridad en la restauración SQLite LOCAL" >&2; exit 1;
}
tablas="$(sqlite3 -readonly "$temporal/restauracion.sqlite" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")"
[[ "$tablas" =~ ^[0-9]+$ ]] && [ "$tablas" -gt 0 ] || {
  echo "El SQL restaurado no tiene tablas de ensayo" >&2; exit 1;
}
echo "ENSAYO LOCAL correcto: SHA-256, age, esquema e integridad SQLite comprobados."
echo "No se escribió en ninguna D1 remota."
