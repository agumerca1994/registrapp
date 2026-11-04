#!/usr/bin/env bash
# Corre en la Mac, desde ~/Library/LaunchAgents/ar.com.tood.backup.plist. Baja los
# dumps del VPS: es la única copia que sobrevive a perder el servidor.
#
# Guarda 30 días. La política de privacidad promete que lo eliminado sale de las
# copias "en su ciclo habitual": sin borrar, ese ciclo no existiría.
#
# launchd falla sin que nadie lo vea, así que el error se avisa en pantalla.
set -uo pipefail

DEST="$HOME/Backups/tood/registrapp"
KEEP_DAYS=30
MAX_AGE_HOURS=48
LOG="$HOME/Backups/tood/pull.log"

mkdir -p "$DEST"
chmod 700 "$HOME/Backups" "$HOME/Backups/tood" "$DEST"

fail() {
  echo "$(date +%FT%T) ERROR: $1" >>"$LOG"
  osascript -e "display notification \"$1\" with title \"Backup de tood\"" >/dev/null 2>&1
  exit 1
}

rsync -a -e "ssh -o BatchMode=yes -o ConnectTimeout=20" \
  --include 'registrapp-*' --exclude '*' \
  registrapp-prod:/var/backups/registrapp/ "$DEST/" 2>>"$LOG" ||
  fail "No pude bajar la copia del servidor"

(cd "$DEST" && for f in *.sha256; do
  [ -e "$f" ] || exit 1
  shasum -a 256 -c "$f" >/dev/null 2>&1 || exit 1
done) || fail "Una copia bajada no coincide con la del servidor"

find "$DEST" -maxdepth 1 -type f -name 'registrapp-*' -mtime +"$KEEP_DAYS" -delete

newest=$(find "$DEST" -maxdepth 1 -type f -name 'registrapp-*.dump' -mmin -$((MAX_AGE_HOURS * 60)) | sort | tail -1)
[ -n "$newest" ] || fail "La última copia tiene más de $MAX_AGE_HOURS horas: el servidor dejó de generarlas"

echo "$(date +%FT%T) ok $(basename "$newest")" >>"$LOG"
