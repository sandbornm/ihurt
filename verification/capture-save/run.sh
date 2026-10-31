#!/usr/bin/env bash
# One command for the capture-and-save check. Exit 0 means every config
# matched expected.txt. TLC runs one worker with a fixed fingerprint seed by
# default, so a FAIL line names the same invariant on every run. Set
# TLC_WORKERS=auto for a faster local run.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -d /opt/homebrew/opt/openjdk@21/bin ]]; then
  export PATH="/opt/homebrew/opt/openjdk@21/bin:${PATH}"
fi

ROOT="$(cd ../.. && pwd)"
CACHE="${XDG_CACHE_HOME:-${HOME}/.cache}/tlaplus"
JAR="${CACHE}/tla2tools.jar"
SHA="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
URL="https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"
WORKERS="${TLC_WORKERS:-1}"

mkdir -p "${CACHE}"

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    echo "${SHA}  ${JAR}" | sha256sum -c -
  else
    echo "${SHA}  ${JAR}" | shasum -a 256 -c -
  fi
}

if [[ ! -f "${JAR}" ]] || ! checksum >/dev/null 2>&1; then
  curl -fsSL -o "${JAR}.partial" "${URL}"
  mv "${JAR}.partial" "${JAR}"
  checksum
fi

node "${ROOT}/verification/capture-save/anchor.mjs"
node "${ROOT}/verification/capture-save/storage-behavior.mjs"

fail=0
while read -r cfg expect inv; do
  [[ -z "${cfg}" || "${cfg}" == \#* ]] && continue
  meta="$(mktemp -d)"
  out="$(mktemp)"
  set +e
  java -XX:+UseParallelGC -cp "${JAR}" tlc2.TLC \
    -workers "${WORKERS}" \
    -fp 0 \
    -config "cfg/${cfg}" \
    -metadir "${meta}" \
    -terse \
    CaptureSave.tla >"${out}" 2>&1
  code=$?
  set -e
  if [[ "${expect}" == "PASS" ]]; then
    if [[ ${code} -ne 0 ]]; then
      echo "expected PASS from ${cfg}"
      cat "${out}"
      fail=1
    else
      echo "PASS ${cfg}"
    fi
  else
    if [[ ${code} -eq 0 ]]; then
      echo "expected ${cfg} to violate ${inv}"
      cat "${out}"
      fail=1
    elif ! grep -q "Invariant ${inv} is violated" "${out}"; then
      echo "expected ${cfg} to violate ${inv}"
      cat "${out}"
      fail=1
    else
      echo "FAIL ${cfg} ${inv}"
    fi
  fi
  rm -rf "${meta}" "${out}"
done < expected.txt

exit "${fail}"
