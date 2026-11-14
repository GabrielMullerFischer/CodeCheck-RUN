#!/usr/bin/env bash
# Redirecionamento de compatibilidade para o deploy unificado
exec "$(dirname "$0")/deploy.sh" --multi-node "$@"

