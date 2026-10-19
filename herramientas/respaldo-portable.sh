#!/usr/bin/env bash
# Utilidades POSIX/Bash para macOS y Linux (incluido WSL).
# No imprime secretos ni realiza solicitudes de red.
backup_directorio_real() {
  (cd "$1" && pwd -P)
}
backup_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "Falta sha256sum o shasum" >&2; return 2
  fi
}
backup_md5() {
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$1" | awk '{print $1}'
  elif command -v md5 >/dev/null 2>&1; then
    md5 -q "$1"
  else
    echo "Falta md5sum o md5" >&2; return 2
  fi
}
backup_escribir_sha256() {
  local archivo="$1" base hash
  base="$(basename "$archivo")"
  hash="$(backup_sha256 "$archivo")" || return
  printf '%s  %s\n' "$hash" "$base" > "$archivo.sha256"
}
backup_verificar_sha256() {
  local archivo="$1" manifiesto="$1.sha256" base esperado nombre recibido
  [ -s "$archivo" ] && [ -s "$manifiesto" ] || { echo "Falta archivo o manifiesto" >&2; return 1; }
  base="$(basename "$archivo")"
  read -r esperado nombre < "$manifiesto" || return 1
  [[ "$esperado" =~ ^[0-9a-fA-F]{64}$ ]] && [ "$nombre" = "$base" ] || {
    echo "Manifiesto inválido o correspondiente a otro archivo" >&2; return 1
  }
  recibido="$(backup_sha256 "$archivo")" || return
  [ "${recibido,,}" = "${esperado,,}" ] || { echo "SHA-256 distinto" >&2; return 1; }
}
