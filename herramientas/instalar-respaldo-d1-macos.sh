#!/usr/bin/env bash
# Instala un LaunchAgent del usuario en macOS. NO ejecuta respaldos de inmediato.
# Ejecutar únicamente DESPUÉS de validar exportación, cifrado, Drive y recuperación.
set -euo pipefail
umask 077
[ "$(uname -s)" = "Darwin" ] || { echo "Requiere macOS" >&2; exit 2; }
: "${BACKUP_HOUR:?Define la hora local (0-23), elegida por administración}"
: "${BACKUP_MINUTE:?Define el minuto local (0-59), elegido por administración}"
[[ "$BACKUP_HOUR" =~ ^([01]?[0-9]|2[0-3])$ ]] || exit 2
[[ "$BACKUP_MINUTE" =~ ^[0-5]?[0-9]$ ]] || exit 2
[ -r "$HOME/.config/elcastano-d1/backup.env" ] || {
  echo "Primero configura ~/.config/elcastano-d1/backup.env" >&2; exit 2
}
# Comprobar habilitación expresa antes de instalar la programación.
# El archivo es local y administrado por el propietario del Mac.
if ! grep -Eq '^[[:space:]]*BACKUP_ACTIVE="SI"[[:space:]]*
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
plists="$HOME/Library/LaunchAgents"
mkdir -p "$plists" "$HOME/Library/Logs"
dest="$plists/com.elcastano.d1-backup.plist"
[ ! -e "$dest" ] || { echo "Ya existe el agente; no se sobrescribe" >&2; exit 2; }
xml() {
  printf '%s' "$1" | sed -e 's/\&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}
runner="$(xml "$root/herramientas/ejecutar-respaldo-d1-macos.sh")"
out="$(xml "$HOME/Library/Logs/elcastano-d1-backup.log")"
err="$(xml "$HOME/Library/Logs/elcastano-d1-backup-error.log")"
cat > "$dest" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.elcastano.d1-backup</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$runner</string></array>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>$((10#$BACKUP_HOUR))</integer>
    <key>Minute</key><integer>$((10#$BACKUP_MINUTE))</integer>
  </dict>
  <key>StandardOutPath</key><string>$out</string>
  <key>StandardErrorPath</key><string>$err</string>
</dict></plist>
PLIST
chmod 600 "$dest"
if ! plutil -lint "$dest" >/dev/null; then
  rm -f "$dest"
  echo "El archivo LaunchAgent no es válido; no se instaló" >&2; exit 1
fi
# El agente se prepara y registra sin invocación inmediata (no hay RunAtLoad).
launchctl bootstrap "gui/$(id -u)" "$dest" || {
  echo "No se pudo registrar; revisar manualmente $dest" >&2; exit 1
}
printf 'Agente programado para %02d:%02d hora local; no se ejecutó el respaldo ahora.\n' "$((10#$BACKUP_HOUR))" "$((10#$BACKUP_MINUTE))"
 "$HOME/.config/elcastano-d1/backup.env"; then
  echo "Falta BACKUP_ACTIVE=SI en la configuración local; no se instala." >&2
  exit 2
fi
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
plists="$HOME/Library/LaunchAgents"
mkdir -p "$plists" "$HOME/Library/Logs"
dest="$plists/com.elcastano.d1-backup.plist"
[ ! -e "$dest" ] || { echo "Ya existe el agente; no se sobrescribe" >&2; exit 2; }
xml() {
  printf '%s' "$1" | sed -e 's/\&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}
runner="$(xml "$root/herramientas/ejecutar-respaldo-d1-macos.sh")"
out="$(xml "$HOME/Library/Logs/elcastano-d1-backup.log")"
err="$(xml "$HOME/Library/Logs/elcastano-d1-backup-error.log")"
cat > "$dest" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.elcastano.d1-backup</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$runner</string></array>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>$((10#$BACKUP_HOUR))</integer>
    <key>Minute</key><integer>$((10#$BACKUP_MINUTE))</integer>
  </dict>
  <key>StandardOutPath</key><string>$out</string>
  <key>StandardErrorPath</key><string>$err</string>
</dict></plist>
PLIST
chmod 600 "$dest"
if ! plutil -lint "$dest" >/dev/null; then
  rm -f "$dest"
  echo "El archivo LaunchAgent no es válido; no se instaló" >&2; exit 1
fi
# El agente se prepara y registra sin invocación inmediata (no hay RunAtLoad).
launchctl bootstrap "gui/$(id -u)" "$dest" || {
  echo "No se pudo registrar; revisar manualmente $dest" >&2; exit 1
}
printf 'Agente programado para %02d:%02d hora local; no se ejecutó el respaldo ahora.\n' "$((10#$BACKUP_HOUR))" "$((10#$BACKUP_MINUTE))"
