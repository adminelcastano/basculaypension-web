#!/usr/bin/env bash
# Comprobación LOCAL del respaldo cifrado más reciente, sin conectarse a producción.
# Devuelve error para supervisión si no hay copia íntegra y suficientemente reciente.
set -euo pipefail
umask 077
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$root/herramientas/respaldo-portable.sh"
config="$HOME/.config/elcastano-d1/backup.env"
[ -r "$config" ] || { echo "ALERTA: configuración de respaldo ausente" >&2; exit 2; }
# shellcheck disable=SC1090
source "$config"
: "${BACKUP_DEST:?BACKUP_DEST no configurado}"
max_horas="${BACKUP_MAX_HOURS:-36}"
[[ "$max_horas" =~ ^[0-9]{1,3}$ ]] && [ "$max_horas" -ge 1 ] || {
  echo "ALERTA: BACKUP_MAX_HOURS inválido" >&2; exit 2
}
[ -d "$BACKUP_DEST" ] || { echo "ALERTA: no existe directorio cifrado local" >&2; exit 1; }
ultimo="" 
mas_reciente=0
shopt -s nullglob
for archivo in "$BACKUP_DEST"/d1-????????T??????Z.sql.age; do
  [ -s "$archivo" ] || continue
  fecha="$(stat -c %Y "$archivo")" || continue
  if [ "$fecha" -gt "$mas_reciente" ]; then
    mas_reciente="$fecha"
    ultimo="$archivo"
  fi
done
[ -n "$ultimo" ] || { echo "ALERTA: sin respaldos D1 cifrados" >&2; exit 1; }
backup_verificar_sha256 "$ultimo" || { echo "ALERTA: respaldo más reciente corrupto" >&2; exit 1; }
ahora="$(date -u +%s)"
edad="$(( (ahora - mas_reciente) / 3600 ))"
if [ "$edad" -gt "$max_horas" ]; then
  printf 'ALERTA: última copia cifrada tiene %s horas (máximo %s)\n' "$edad" "$max_horas" >&2
  exit 1
fi
printf 'Respaldo D1 cifrado local y SHA-256 correctos; antigüedad aproximada: %s horas\n' "$edad"
