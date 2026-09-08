#!/usr/bin/env bash
# Restaura um backup gerado por scripts/backup.sh.
# Uso:  ./scripts/restore.sh caminho/para/genesis-genesis-AAAAMMDD-HHMMSS.archive.gz
# ATENÇÃO: --drop apaga as coleções atuais antes de restaurar.
set -euo pipefail

ARCHIVE="${1:?informe o arquivo .archive.gz}"
CONTAINER="${MONGO_CONTAINER:-genesis-db}"
DB="${MONGO_DB:-genesis}"

[ -f "$ARCHIVE" ] || { echo "arquivo não encontrado: $ARCHIVE"; exit 1; }

read -rp "Isto vai SOBRESCREVER o banco '${DB}'. Continuar? (digite 'sim'): " ok
[ "$ok" = "sim" ] || { echo "cancelado"; exit 1; }

echo "→ restaurando ${ARCHIVE} em '${DB}'"
docker exec -i "$CONTAINER" sh -c "mongorestore --db=${DB} --archive --gzip --drop" < "$ARCHIVE"
echo "✓ concluído"
