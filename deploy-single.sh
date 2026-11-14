#!/usr/bin/env bash
# Redirecionamento para o deploy unificado em modo Single-Node (Nó Único)
exec "$(dirname "$0")/deploy.sh" --single-node "$@"

