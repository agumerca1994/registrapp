#!/usr/bin/env bash
# Corre en el VPS, todos los días, desde /etc/cron.d/registrapp-backup. Instalado
# en /usr/local/sbin/registrapp-backup.sh: esta es la copia versionada.
#
# Deja un dump en /var/backups/registrapp, 14 días. Esa copia sola no sirve si se
# pierde el servidor: la que sale de acá la baja scripts/backup-pull.sh.
#
# Se revisa ANTES de reemplazar nada: un pg_dump cortado también deja un archivo.
set -euo pipefail

CONTAINER=recibox_registrapp-prod-registrapp-db-1
DIR=/var/backups/registrapp
KEEP_DAYS=14
MIN_TABLES=30 # hoy son 41: menos que esto es un dump roto, no una base más chica

umask 027
mkdir -p "$DIR"
chown root:ubuntu "$DIR"
chmod 750 "$DIR"

name="registrapp-$(date -u +%Y%m%d-%H%M%S).dump"
tmp="$DIR/.$name.tmp"
trap 'rm -f "$tmp"' EXIT

docker exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$tmp"

tables=$(docker exec -i "$CONTAINER" pg_restore --list <"$tmp" | grep -c 'TABLE DATA' || true)
if [ "$tables" -lt "$MIN_TABLES" ]; then
  echo "$(date -u +%FT%TZ) ERROR: el dump tiene $tables tablas (mínimo $MIN_TABLES)" >&2
  exit 1
fi

chown root:ubuntu "$tmp"
mv "$tmp" "$DIR/$name"
(cd "$DIR" && sha256sum "$name" >"$name.sha256" && chown root:ubuntu "$name.sha256")
find "$DIR" -maxdepth 1 -type f -name 'registrapp-*' -mtime +"$KEEP_DAYS" -delete

echo "$(date -u +%FT%TZ) ok $name $(du -h "$DIR/$name" | cut -f1) tablas=$tables"
