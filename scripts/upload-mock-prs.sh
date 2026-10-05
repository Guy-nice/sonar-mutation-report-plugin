#!/usr/bin/env bash
# Upload several mock pull request analyses to a Sonar project, each with its own mutation report.
# Usage: SONAR_TOKEN=... scripts/upload-mock-prs.sh <project-dir> <host-url> <project-key>
# The project dir must hold sources and a sonar-project.properties; this script only varies the report and the PR key.
set -euo pipefail
dir=$1; host=$2; key=$3
: "${SONAR_TOKEN:?export SONAR_TOKEN first (never commit it)}"
report="$dir/.sonar/mutation-report.json"
base_report=$(mktemp); cp "$report" "$base_report"
trap 'cp "$base_report" "$report"; rm -f "$base_report"' EXIT

# pr-key branch killed-fraction
for spec in "101 feature/pricing-fix 0.70" "102 feature/date-helpers 0.88" "103 feature/validators 0.92" "104 feature/parser-cleanup 0.79" "105 feature/gate-config 0.83"; do
  read -r pr branch frac <<<"$spec"
  python3 - "$base_report" "$report" "$frac" "$pr" <<'PY'
import json, sys
src, dst, frac, pr = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
r = json.load(open(src))
n = r["summary"]["new"]
total = n["total"]
killed = round(total * frac)
n["killed"] = killed
rest = total - killed
n["survived"] = round(rest * 0.6); n["noCoverage"] = rest - n["survived"]
n["timedOut"] = n["memoryError"] = n["unknown"] = 0
r["run"]["runId"] = f"mock-pr-{pr}"
json.dump(r, open(dst, "w"), indent=2)
PY
  (cd "$dir" && sonar-scanner -Dsonar.host.url="$host" -Dsonar.projectKey="$key" \
     -Dsonar.pullrequest.key="$pr" -Dsonar.pullrequest.branch="$branch" -Dsonar.pullrequest.base=main >/dev/null)
  echo "uploaded PR $pr ($branch) killed fraction $frac"
done
