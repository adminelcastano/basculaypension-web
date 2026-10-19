#!/usr/bin/env bash
# Respaldo cifrado D1. Ejecutar sólo desde un ordenador administrativo autorizado.
# No restaura ni modifica D1; la exportación es de solo lectura.
set -euo pipefail
umask 077

: "${BACKUP_DEST:?Define BACKUP_DEST, carpeta privada FUERA del repositorio}"
: "${AGE_RECIPIENT:?Define AGE_RECIPIENT con la clave PÚBLICA de cifrado age}"
: "${CLOUDFLARE_API_TOKEN:?Usa un token de lectura/autorización de exportación D1 en tu entorno}"
for cmd in npx age sqlite3 sha256sum realpath mktemp; do
  command -v "$cmd" >/dev/null || { echo "Falta herramienta: $cmd" >&2; exit 2; }
done
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p "$BACKUP_DEST"
dest="$(realpath "$BACKUP_DEST")"
raiz="$(realpath "$root")"
case "$dest/" in "$raiz/"*) echo "No almacenar respaldos dentro del repositorio" >&2; exit 2;; esac
if [ ! -d "$dest" ] || [ ! -w "$dest" ]; then
  echo "Destino privado inaccesible" >&2; exit 2
fi

temporal="$(mktemp -d)"
trap 'rm -rf -- "$temporal"' EXIT
salida="$dest/d1-$(date -u +%Y%m%dT%H%M%SZ).sql.age"
if [ -e "$salida" ]; then echo "Ya existe un archivo con ese nombre; no sobrescribir" >&2; exit 2; fi

# Clave/credencial nunca se imprime. Wrangler sólo exporta; jamás ejecutar d1 execute --remote aquí.
npx --yes wrangler@4.151.2 d1 export castano-facturas --remote --config wrangler.jsonc --output "$temporal/export.sql"
test -s "$temporal/export.sql" || { echo "Exportación vacía" >&2; exit 1; }

# Restauración LOCAL real de la exportación para validar legibilidad antes del cifrado.
sqlite3 "$temporal/ensayo.sqlite" < "$temporal/export.sql"
comprobacion="$(sqlite3 -readonly "$temporal/ensayo.sqlite" 'PRAGMA quick_check;')"
[ "$comprobacion" = 'ok' ] || { echo "Respaldo no íntegro" >&2; exit 1; }

age -r "$AGE_RECIPIENT" -o "$salida" "$temporal/export.sql"
test -s "$salida" || { echo "Falló el cifrado" >&2; exit 1; }
sha256sum "$salida" > "$salida.sha256"
chmod 600 "$salida" "$salida.sha256"
printf 'Respaldo cifrado y restauración local verificada: %s\n' "$salida"
printf 'Conservar la clave privada age FUERA del repositorio y probar su descifrado por separado.\n'
