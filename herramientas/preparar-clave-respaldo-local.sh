#!/usr/bin/env bash
# Preparar UNA clave de recuperación age exclusivamente en equipo administrativo.
# Nunca ejecutar en CI, contenedores compartidos o sesiones que registren archivos.
set -euo pipefail
umask 077
: "${AGE_KEY_DIR:?Define AGE_KEY_DIR a una ubicación privada FUERA del repositorio y de Drive}"
command -v age-keygen >/dev/null || { echo "Instala age/age-keygen localmente" >&2; exit 2; }
command -v realpath >/dev/null || { echo "Falta realpath" >&2; exit 2; }

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p "$AGE_KEY_DIR"
dest="$(realpath "$AGE_KEY_DIR")"
repo="$(realpath "$root")"
case "$dest/" in "$repo/"*) echo "La clave privada NO puede estar dentro del repositorio" >&2; exit 2;; esac
chmod 700 "$dest"
secreto="$dest/d1-elcastano-age-key.txt"
if [ -e "$secreto" ]; then
  echo "Ya existe una clave privada: no se reemplaza ni se imprime" >&2
  exit 1
fi
age-keygen -o "$secreto" >/dev/null
chmod 600 "$secreto"
# La clave pública puede anotarse en la configuración de la tarea,
# la PRIVADA debe guardarse en custodia independiente, no en Drive ni GitHub.
printf 'Clave privada creada localmente; guardarla en custodia segura fuera de Drive.\n'
printf 'Destinatario PUBLICO AGE_RECIPIENT:\n'
age-keygen -y "$secreto"
printf 'Nunca enviar el archivo de clave privada por chat o correo.\n'
