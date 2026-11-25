#!/usr/bin/env bash
# Find which Sonar web API calls list Portfolios and their projects on a given server (they differ by version).
# Usage: SONAR_TOKEN=... scripts/probe-portfolios.sh <host-url> [portfolio-key]
# Read-only GET calls. Prints the HTTP status and the start of each response. Never commit the token.
set -uo pipefail
host=${1:?usage: probe-portfolios.sh <host-url> [portfolio-key]}; key=${2:-}
: "${SONAR_TOKEN:?export SONAR_TOKEN first}"
call() { printf '\n== %s\n' "$1"; curl -s -u "$SONAR_TOKEN:" -w '\nHTTP %{http_code}\n' "$host$1" | cut -c1-300; }
call '/api/components/search?qualifiers=VW&ps=5'
call '/api/views/list'
call '/api/views/search?ps=5'
if [ -n "$key" ]; then
  call "/api/components/tree?component=$key&qualifiers=TRK&strategy=all&ps=5"
  call "/api/components/tree?component=$key&strategy=all&ps=5"
  call "/api/measures/component_tree?component=$key&qualifiers=TRK&metricKeys=ncloc&strategy=all&ps=5"
  call "/api/views/show?key=$key"
fi
