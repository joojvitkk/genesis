#!/usr/bin/env bash
# Backup do MongoDB do GENESIS.
# Uso:  ./scripts/backup.sh [dir-destino]
# Cron sugerido (diário 3h):  0 3 * * *  /caminho/scripts/backup.sh /var/backups/genesis
set -euo pipefail

DEST="${1:-./backups}"
CONTAINER="${MONGO_CONTAINER:-genesis-db}"
DB="${MONGO_DB:-genesis}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="genesis-${DB}-${STAMP}.archive.gz"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$DEST"

echo "→ dump de '${DB}' via container '${CONTAINER}'"
docker exec "$CONTAINER" sh -c "mongodump --db=${DB} --archive --gzip" > "${DEST}/${ARCHIVE}"

echo "→ salvo em ${DEST}/${ARCHIVE} ($(du -h "${DEST}/${ARCHIVE}" | cut -f1))"

echo "→ removendo backups com mais de ${RETENTION_DAYS} dias"
find "$DEST" -name 'genesis-*.archive.gz' -type f -mtime "+${RETENTION_DAYS}" -delete

echo "✓ concluído"
