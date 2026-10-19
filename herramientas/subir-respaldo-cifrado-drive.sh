#!/usr/bin/env bash
# Envía ÚNICAMENTE un archivo cifrado age a la carpeta privada de Drive.
# BACKUP_DRIVE_REMOTE debe ser un remote de rclone cuyo root_folder_id
# ya esté limitado a «El Castaño · Respaldos D1 cifrados».
# No crea credenciales ni guarda claves; no borra ni sobrescribe respaldos.
set -euo pipefail
umask 077
: "${BACKUP_DRIVE_REMOTE:?Define BACKUP_DRIVE_REMOTE como nombre de remote rclone terminado en :}"
[ "$#" -eq 1 ] || { echo "Uso: $0 /ruta/d1-AAAA...sql.age" >&2; exit 2; }
[[ "$BACKUP_DRIVE_REMOTE" =~ ^[a-zA-Z0-9_-]+:$ ]] || {
  echo "El remote debe apuntar directamente a la carpeta privada, sin subrutas" >&2
  exit 2
}
for cmd in rclone sha256sum md5sum basename dirname; do
  command -v "$cmd" >/dev/null || { echo "Falta herramienta: $cmd" >&2; exit 2; }
done
archivo="$1"
base="$(basename "$archivo")"
[[ "$base" =~ ^d1-[0-9]{8}T[0-9]{6}Z\.sql\.age$ ]] || {
  echo "Sólo se admiten respaldos cifrados D1 con nombre generado por el sistema" >&2
  exit 2
}
[ -s "$archivo" ] && [ -s "$archivo.sha256" ] || {
  echo "Falta archivo cifrado o manifiesto" >&2; exit 2
}
( cd "$(dirname "$archivo")" && sha256sum -c "$base.sha256" >/dev/null ) || {
  echo "El respaldo cifrado no coincide con su SHA-256" >&2; exit 1
}

for origen in "$archivo" "$archivo.sha256"; do
  nombre="$(basename "$origen")"
  destino="${BACKUP_DRIVE_REMOTE}${nombre}"
  # No reemplazar una copia remota preexistente: las versiones son inmutables.
  if rclone lsf --files-only "$destino" 2>/dev/null | grep -Fxq "$nombre"; then
    echo "Ya existe en Drive: $nombre; no se sobrescribe" >&2
    exit 1
  fi
  rclone copyto --checksum "$origen" "$destino"
  esperado="$(md5sum "$origen" | cut -d' ' -f1)"
  recibido="$(rclone md5sum "$destino" | awk 'NR==1 {print $1}')"
  if [ -z "$recibido" ] || [ "$recibido" != "$esperado" ]; then
    echo "No se confirmó la integridad de la copia en Drive: $nombre" >&2
    exit 1
  fi
done
echo "Copia cifrada y manifiesto verificados en Drive. No se conservó SQL plano."
