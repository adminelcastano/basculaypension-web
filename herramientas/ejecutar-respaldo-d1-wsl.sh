#!/usr/bin/env bash
# Ejecutor primario en Ubuntu/WSL sobre la computadora Windows.
# Nunca imprime el token ni almacena la clave de descifrado.
set -euo pipefail
umask 077
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
config="$HOME/.config/elcastano-d1/backup.env"
[ -r "$config" ] || { echo "Falta configuración WSL: $config" >&2; exit 2; }
# Archivo LOCAL con datos no secretos. Debe estar protegido con chmod 600.
# shellcheck disable=SC1090
source "$config"
[ "${BACKUP_ACTIVE:-NO}" = "SI" ] || {
  echo "Respaldo Windows desactivado: falta la validación y habilitación final." >&2; exit 2
}
: "${BACKUP_DEST:?Falta destino local privado}"
: "${AGE_RECIPIENT:?Falta clave PUBLICA age}"
: "${BACKUP_DRIVE_REMOTE:?Falta remote privado de Drive}"
: "${CLOUDFLARE_API_TOKEN:?Falta token inyectado desde el almacén DPAPI de Windows}"
case "$AGE_RECIPIENT" in
  age1_REEMPLAZAR*|"") echo "Reemplaza la clave pública de ejemplo" >&2; exit 2;;
esac
export BACKUP_DEST AGE_RECIPIENT BACKUP_DRIVE_REMOTE
cd "$root"
exec bash "$root/herramientas/respaldo-d1-cifrado.sh"
