#!/bin/sh
# Nightly logical backup of the memory service database.
#
# The connection URL comes from the service's own environment file, so the
# database credential exists in exactly one place on this host. Keeps 14 daily
# dumps; a dump is written under a temporary name and renamed only on success,
# so a failed run never leaves a truncated file for a restore to find.
set -eu
ENV_FILE=/etc/memory-service/env
DIR=/var/backups/memory-service
RETENTION=14
# The server runs PG 17; the `pg_dump` on PATH is the distro's 14 and refuses a
# newer server, so name the matching binary explicitly.
PG_DUMP=/usr/lib/postgresql/17/bin/pg_dump
STAMP=$(date +%Y%m%d-%H%M%S)
TMP="$DIR/.memory_svc-$STAMP.dump.part"
OUT="$DIR/memory_svc-$STAMP.dump"

if [ ! -x "$PG_DUMP" ]; then
    echo "missing $PG_DUMP" >&2
    exit 1
fi
if [ ! -r "$ENV_FILE" ]; then
    echo "cannot read $ENV_FILE" >&2
    exit 1
fi
# shellcheck disable=SC1090
. "$ENV_FILE"

mkdir -p "$DIR"
"$PG_DUMP" --no-owner --format=custom --compress=9 \
    --file="$TMP" "$MEMORY_DATABASE_URL"
mv "$TMP" "$OUT"

find "$DIR" -name 'memory_svc-*.dump' -type f -mtime +$RETENTION -delete
find "$DIR" -name '*.dump.part' -type f -mmin +120 -delete
