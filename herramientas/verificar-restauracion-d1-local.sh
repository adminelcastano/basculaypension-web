#!/usr/bin/env bash
# Restauración LOCAL de comprobación de una exportación cifrada D1.
# Jamás llama a D1/Cloudflare; NO restaura la base productiva.
set -euo pipefail
umask 077
: "${AGE_KEY_FILE:?Define AGE_KEY_FILE con la clave privada custodiada FUERA de Drive/GitHub}"
[ "$#" -eq 1 ] || { echo "Uso: $0 /ruta/d1-AAAAMMDDTHHMMSSZ.sql.age" >&2; exit 2; }
for cmd in age sqlite3 mktemp basename dirname; do
  command -v "$cmd" >/dev/null || { echo "Falta $cmd" >&2; exit 2; }
done
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$root/herramientas/respaldo-portable.sh"
encrypted="$1"
name="$(basename "$encrypted")"
[[ "$name" =~ ^d1-[0-9]{8}T[0-9]{6}Z\.sql\.age$ ]] || {
  echo "Nombre de respaldo inesperado" >&2; exit 2
}
[ -r "$AGE_KEY_FILE" ] && [ -s "$encrypted" ] && [ -s "$encrypted.sha256" ] || {
  echo "Falta archivo cifrado, manifiesto o clave privada" >&2; exit 2
}
backup_verificar_sha256 "$encrypted"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
age --decrypt -i "$AGE_KEY_FILE" -o "$tmp/backup.sql" "$encrypted"
[ -s "$tmp/backup.sql" ] || { echo "El respaldo descifrado está vacío" >&2; exit 1; }
sqlite3 "$tmp/restauracion.sqlite" < "$tmp/backup.sql"
check="$(sqlite3 -readonly "$tmp/restauracion.sqlite" 'PRAGMA quick_check;')"
[ "$check" = "ok" ] || { echo "La restauración SQLite local no superó quick_check" >&2; exit 1; }
echo "Respaldo descifrado y restaurado LOCALMENTE: integridad SQLite correcta."
echo "No se generó ninguna escritura a D1 ni a Google Drive."
