#!/usr/bin/env bash
# Verificación local de respaldos cifrados (Linux y macOS).
# Sin Cloudflare, rclone, servicios externos ni lectura de secretos.
backup_directorio_real() { (cd "$1" && pwd -P); }
backup_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "Se requiere sha256sum o shasum -a 256" >&2; return 2
  fi
}
backup_verificar_sha256() {
  local archivo="$1" manifiesto="$1.sha256" esperado nombre actual lineas
  [ -f "$archivo" ] && [ -s "$archivo" ] && [ -f "$manifiesto" ] && [ -s "$manifiesto" ] || {
    echo "Falta el cifrado o su manifiesto SHA-256" >&2; return 1;
  }
  lineas="$(wc -l < "$manifiesto" | tr -d '[:space:]')"
  [ "$lineas" = 1 ] || { echo "El manifiesto debe tener una sola línea" >&2; return 1; }
  read -r esperado nombre < "$manifiesto" || { echo "Manifiesto ilegible" >&2; return 1; }
  [[ "$esperado" =~ ^[0-9a-fA-F]{64}$ ]] && [ "$nombre" = "$(basename "$archivo")" ] || {
    echo "Manifiesto SHA-256 inválido o ajeno al archivo" >&2; return 1;
  }
  actual="$(backup_sha256 "$archivo")" || return 1
  [ "$actual" = "$(printf '%s' "$esperado" | tr '[:upper:]' '[:lower:]')" ] || {
    echo "Diferencia de SHA-256: NO restaurar" >&2; return 1;
  }
}
