#!/usr/bin/env bash
# Fase 2: ENSAYO de exportación cifrada, exclusivamente en D1 sintética aislada.
# No usar para D1 de producción; sin Drive, WSL, tareas ni restore remoto.
set -euo pipefail
umask 077

# Rechazar todo uso operativo antes de invocar programas o acceder a red.
[ "${BACKUP_ACTIVE:-NO}" = "SI" ] && [ "${BACKUP_MODO:-}" = "ENSAYO" ] || {
  echo "INACTIVO: únicamente se permite ENSAYO habilitado manualmente" >&2; exit 2;
}
: "${BACKUP_TEST_DATABASE:?Falta nombre de D1 sintética}"
: "${BACKUP_TEST_DATABASE_ID:?Falta UUID comprobado de D1 sintética}"
: "${BACKUP_PRODUCTION_DATABASE_ID:?Falta UUID de producción para excluirlo}"
: "${BACKUP_TEST_CONFIG:?Falta configuración aislada de Wrangler}"
: "${BACKUP_DEST:?Falta directorio privado de salida}"
: "${AGE_RECIPIENT:?Falta la clave PÚBLICA age}"
: "${CLOUDFLARE_API_TOKEN:?Falta token temporal autorizado para la D1 sintética}"

[[ "$BACKUP_TEST_DATABASE" =~ ^castano-respaldo-sintetico-[0-9]{8}$ ]] || {
  echo "No se permite esta base: nombre de D1 no sintético" >&2; exit 2;
}
id_regex='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
[[ "$BACKUP_TEST_DATABASE_ID" =~ $id_regex ]] &&
[[ "$BACKUP_PRODUCTION_DATABASE_ID" =~ $id_regex ]] &&
[ "${BACKUP_TEST_DATABASE_ID,,}" != "${BACKUP_PRODUCTION_DATABASE_ID,,}" ] || {
  echo "UUID inválido o coincidente con producción: exportación denegada" >&2; exit 2;
}
[[ "$AGE_RECIPIENT" =~ ^age1[a-z0-9]{20,}$ ]] || {
  echo "Se necesita únicamente una clave pública age válida" >&2; exit 2;
}
case "$BACKUP_TEST_CONFIG" in /*) ;; *) echo "Ruta de configuración debe ser absoluta" >&2; exit 2;; esac
[ -f "$BACKUP_TEST_CONFIG" ] && [ -r "$BACKUP_TEST_CONFIG" ] &&
[ ! -L "$BACKUP_TEST_CONFIG" ] && [ "$(basename "$BACKUP_TEST_CONFIG")" = "wrangler.respaldo-ensayo.jsonc" ] || {
  echo "Configuración Wrangler sintética inexistente o no permitida" >&2; exit 2;
}
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
config_dir="$(cd "$(dirname "$BACKUP_TEST_CONFIG")" && pwd -P)"
case "$config_dir/" in "$root/"*) echo "La configuración de ensayo debe permanecer fuera del repositorio" >&2; exit 2;; esac

# JSON estricto es también JSONC válido; no cargar wrangler.jsonc productivo.
# Se exige un único binding D1, nombre sintético y UUID explícitamente distinto al productivo.
command -v node >/dev/null 2>&1 || { echo "Se requiere Node.js 22" >&2; exit 2; }
node - "$BACKUP_TEST_CONFIG" "$BACKUP_TEST_DATABASE" "$BACKUP_TEST_DATABASE_ID" "$BACKUP_PRODUCTION_DATABASE_ID" <<'NODE'
const fs = require("node:fs");
const [path, name, id, prod] = process.argv.slice(2);
let cfg;
try { cfg = JSON.parse(fs.readFileSync(path, "utf8")); }
catch { console.error("Configuración de ensayo no válida: usar JSON estricto"); process.exit(2); }
const db = cfg?.d1_databases;
if (cfg?.name !== "castano-respaldo-ensayo" ||
    !Array.isArray(db) || db.length !== 1 ||
    db[0]?.binding !== "DB" || db[0]?.database_name !== name ||
    String(db[0]?.database_id || "").toLowerCase() !== id.toLowerCase() ||
    id.toLowerCase() === prod.toLowerCase() ||
    ["env", "kv_namespaces", "triggers", "routes", "assets"].some(k => k in cfg)) {
  console.error("El archivo Wrangler no representa una única D1 sintética aislada");
  process.exit(2);
}
NODE

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=respaldo-portable.sh
source "$root/herramientas/respaldo-portable.sh"
[ -d "$BACKUP_DEST" ] && [ -w "$BACKUP_DEST" ] || {
  echo "El directorio privado de destino debe existir previamente" >&2; exit 2;
}
dest="$(backup_directorio_real "$BACKUP_DEST")"
[ "$dest" != "$root" ] && [[ "$dest/" != "$root/"* ]] || {
  echo "No guardar respaldos dentro del repositorio" >&2; exit 2;
}
for cmd in npx age sqlite3 mktemp ln; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Falta herramienta: $cmd" >&2; exit 2; }
done

temporal_sql="$(mktemp -d)"
temporal_cifrado=""
limpiar() {
  rm -rf "$temporal_sql"
  if [ -n "$temporal_cifrado" ]; then rm -rf "$temporal_cifrado"; fi
}
trap limpiar EXIT
temporal_cifrado="$(mktemp -d "$dest/.d1-ensayo-XXXXXXXX")"
salida="$dest/d1-$(date -u +%Y%m%dT%H%M%SZ).sql.age"
[ ! -e "$salida" ] && [ ! -e "$salida.sha256" ] || {
  echo "El respaldo ya existe: no se sobrescribe" >&2; exit 2;
}

# ÚNICA operación remota: exportación de la D1 sintética permitida.
# Cloudflare puede bloquear solicitudes a ESA D1 mientras dure su exportación.
npx --yes wrangler@4.151.2 d1 export "$BACKUP_TEST_DATABASE" --remote \
  --skip-confirmation --config "$BACKUP_TEST_CONFIG" --output "$temporal_sql/export.sql"
[ -s "$temporal_sql/export.sql" ] || { echo "Exportación vacía" >&2; exit 1; }
sqlite3 "$temporal_sql/verificacion.sqlite" < "$temporal_sql/export.sql"
[ "$(sqlite3 -readonly "$temporal_sql/verificacion.sqlite" "PRAGMA quick_check;")" = "ok" ] || {
  echo "La exportación no supera quick_check" >&2; exit 1;
}
tablas="$(sqlite3 -readonly "$temporal_sql/verificacion.sqlite" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")"
[[ "$tablas" =~ ^[0-9]+$ ]] && [ "$tablas" -gt 0 ] || {
  echo "La exportación sintética no contiene tablas" >&2; exit 1;
}

age -r "$AGE_RECIPIENT" -o "$temporal_cifrado/cifrado.age" "$temporal_sql/export.sql"
[ -s "$temporal_cifrado/cifrado.age" ] || { echo "Falló cifrado age" >&2; exit 1; }
hash="$(backup_sha256 "$temporal_cifrado/cifrado.age")"
printf '%s  %s\n' "$hash" "$(basename "$salida")" > "$temporal_cifrado/manifiesto"
chmod 600 "$temporal_cifrado/cifrado.age" "$temporal_cifrado/manifiesto"

# Publicación por hard link del mismo volumen: fichero completo, no parcial, sin sobrescrituras.
ln "$temporal_cifrado/cifrado.age" "$salida"
if ! ln "$temporal_cifrado/manifiesto" "$salida.sha256"; then
  echo "Cifrado conservado sin manifiesto: revisar manualmente, no eliminar a ciegas" >&2; exit 1;
fi
backup_verificar_sha256 "$salida"
echo "ENSAYO: exportación D1 sintética cifrada y SHA-256 comprobado."
echo "Se conservó únicamente cifrado y manifiesto; no se accedió a producción ni Drive."
