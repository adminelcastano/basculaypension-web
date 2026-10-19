#!/usr/bin/env bash
# Ejecutor macOS. La clave PRIVADA age permanece fuera de esta computadora.
# El token Cloudflare se lee del Llavero del usuario; nunca de Git.
set -euo pipefail
umask 077
if [ "$(uname -s)" != "Darwin" ]; then
  echo "Este ejecutor corresponde a macOS" >&2; exit 2
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
config="$HOME/.config/elcastano-d1/backup.env"
[ -r "$config" ] || {
  echo "Falta configuración local no secreta: $config" >&2; exit 2
}
# Contiene solamente destinatario age PÚBLICO y destinos; no secretos.
# Crear este archivo personalmente en el equipo, con permiso 600.
# shellcheck disable=SC1090
source "$config"
[ "${BACKUP_ACTIVE:-NO}" = "SI" ] || {
  echo "Respaldo macOS sin activar. Falta aprobación y validación final." >&2; exit 2
}
: "${BACKUP_DEST:?Falta BACKUP_DEST}"
: "${AGE_RECIPIENT:?Falta AGE_RECIPIENT público}"
: "${BACKUP_DRIVE_REMOTE:?Falta el remote privado de Drive}"
command -v security >/dev/null || exit 2
# Servicio fijo en Llavero; se configura una sola vez por el administrador.
CLOUDFLARE_API_TOKEN="$(security find-generic-password -a "$USER" -s "elcastano-d1-backup" -w)"
[ -n "$CLOUDFLARE_API_TOKEN" ] || { echo "Llavero sin credencial de exportación" >&2; exit 2; }
export CLOUDFLARE_API_TOKEN BACKUP_DEST AGE_RECIPIENT BACKUP_DRIVE_REMOTE
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$root"
bash "$root/herramientas/respaldo-d1-cifrado.sh"
unset CLOUDFLARE_API_TOKEN
