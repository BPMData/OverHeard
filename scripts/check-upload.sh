#!/usr/bin/env bash
# Match the source selection used by gcloud run deploy --source .
set -euo pipefail
manifest=$(mktemp)
trap 'rm -f "$manifest"' EXIT
gcloud meta list-files-for-upload >"$manifest"
if grep -Eq '(^|/)gha-creds-[^/]*\.json$' "$manifest"; then
  echo "Deployment credential file present in the Cloud Run upload." >&2
  exit 1
fi
if ! grep -Eq '^(\./)?package-lock\.json$' "$manifest"; then
  echo "Cloud Run source upload is missing package-lock.json." >&2
  exit 1
fi
