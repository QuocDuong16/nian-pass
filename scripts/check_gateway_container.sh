#!/usr/bin/env bash
set -Eeuo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${repository_root}/deploy/sync-gateway.compose.yml"
fixture="${repository_root}/fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx"
project="nian-pass-gateway-${RANDOM}-$$"
scratch="$(mktemp -d -t nian-pass-gateway-container-XXXXXXXX)"
environment_file="${scratch}/gateway.env"
token="synthetic-container-gateway-token-0000000000000001"
wrong_token="synthetic-container-gateway-token-9999999999999999"
vault_id="9252bb19-9941-4bb8-b10b-f074ff9dfe35"

compose=(
  docker compose
  --project-name "${project}"
  --env-file "${environment_file}"
  --file "${compose_file}"
)

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans --rmi local >/dev/null 2>&1 || true
  if [[ "${scratch}" == /tmp/nian-pass-gateway-container-* ]]; then
    rm -rf -- "${scratch}"
  fi
}
trap cleanup EXIT

fail() {
  printf 'Gateway container check failed: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

assert_secret_absent() {
  local value="$1"
  if grep -Fq -- "${token}" <<<"${value}" || grep -Fq -- "${wrong_token}" <<<"${value}"; then
    fail "a gateway token appeared in diagnostic or response output"
  fi
}

wait_for_health() {
  local base_url="$1"
  local status=""
  for _ in $(seq 1 80); do
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
      "${base_url}/healthz" 2>/dev/null || true)"
    if [[ "${status}" == "200" ]]; then
      return
    fi
    sleep 0.25
  done
  fail "health endpoint did not become ready"
}

expect_startup_failure() {
  local expected="$1"
  shift
  local output
  if output="$(docker run --rm --user 10001:10001 "$@" 2>&1)"; then
    fail "startup unexpectedly succeeded: ${expected}"
  fi
  assert_secret_absent "${output}"
  grep -Fq -- "gateway startup failed: ${expected}" <<<"${output}" ||
    fail "startup diagnostic category was missing: ${expected}"
}

for command in docker curl cmp grep sed tr; do
  require_command "${command}"
done
docker info >/dev/null 2>&1 || fail "Docker daemon is unavailable"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is unavailable"

umask 077
printf 'NIAN_PASS_GATEWAY_TOKEN=%s\nNIAN_PASS_GATEWAY_PORT=0\n' \
  "${token}" >"${environment_file}"
printf 'header = "Authorization: Bearer %s"\n' "${token}" >"${scratch}/auth.curl"
printf 'header = "Authorization: Bearer %s"\n' "${wrong_token}" >"${scratch}/wrong-auth.curl"
chmod 0600 "${environment_file}" "${scratch}/auth.curl" "${scratch}/wrong-auth.curl"

"${compose[@]}" up --build --detach
container_id="$("${compose[@]}" ps --quiet sync-gateway)"
[[ -n "${container_id}" ]] || fail "Compose did not create the gateway container"
[[ "$(docker inspect --format '{{.Config.User}}' "${container_id}")" == "10001:10001" ]] ||
  fail "container image user is not 10001:10001"
docker exec "${container_id}" sh -c \
  'test "$(id -u)" = 10001 && test "$(id -g)" = 10001' ||
  fail "gateway process is not running as UID/GID 10001"

published="$("${compose[@]}" port sync-gateway 8080)"
port="${published##*:}"
[[ "${port}" =~ ^[0-9]+$ ]] || fail "could not resolve the loopback gateway port"
base_url="http://127.0.0.1:${port}"
object_url="${base_url}/v1/vaults/${vault_id}"
wait_for_health "${base_url}"

status="$(curl --silent --show-error --output "${scratch}/missing.out" \
  --write-out '%{http_code}' "${object_url}")"
[[ "${status}" == "401" ]] || fail "missing token did not return 401"
assert_secret_absent "$(<"${scratch}/missing.out")"

status="$(curl --silent --show-error --config "${scratch}/wrong-auth.curl" \
  --output "${scratch}/wrong.out" --write-out '%{http_code}' "${object_url}")"
[[ "${status}" == "401" ]] || fail "wrong token did not return 401"
assert_secret_absent "$(<"${scratch}/wrong.out")"

status="$(curl --silent --show-error --config "${scratch}/auth.curl" \
  --request PUT --header 'If-None-Match: *' \
  --header 'Content-Type: application/octet-stream' --data-binary "@${fixture}" \
  --dump-header "${scratch}/create.headers" --output "${scratch}/create.out" \
  --write-out '%{http_code}' "${object_url}")"
[[ "${status}" == "201" ]] || fail "authenticated conditional create did not return 201"
assert_secret_absent "$(<"${scratch}/create.out")"

status="$(curl --silent --show-error --config "${scratch}/auth.curl" \
  --output "${scratch}/download.kdbx" --write-out '%{http_code}' "${object_url}")"
[[ "${status}" == "200" ]] || fail "authenticated GET did not return 200"
cmp --silent "${fixture}" "${scratch}/download.kdbx" || fail "downloaded bytes differ"

image="$(docker inspect --format '{{.Config.Image}}' "${container_id}")"
history="$(docker history --no-trunc "${image}")"
assert_secret_absent "${history}"
logs="$("${compose[@]}" logs --no-color)"
assert_secret_absent "${logs}"

"${compose[@]}" stop --timeout 15 sync-gateway
"${compose[@]}" up --detach --no-build sync-gateway
container_id="$("${compose[@]}" ps --quiet sync-gateway)"
published="$("${compose[@]}" port sync-gateway 8080)"
port="${published##*:}"
[[ "${port}" =~ ^[0-9]+$ ]] || fail "could not resolve the restarted gateway port"
base_url="http://127.0.0.1:${port}"
object_url="${base_url}/v1/vaults/${vault_id}"
wait_for_health "${base_url}"
status="$(curl --silent --show-error --config "${scratch}/auth.curl" \
  --output "${scratch}/restart.kdbx" --write-out '%{http_code}' "${object_url}")"
[[ "${status}" == "200" ]] || fail "persisted object was unavailable after restart"
cmp --silent "${fixture}" "${scratch}/restart.kdbx" || fail "persisted bytes changed"

status="$(curl --silent --show-error --config "${scratch}/auth.curl" \
  --request PUT --header 'If-Match: "0000000000000000000000000000000000000000000000000000000000000000"' \
  --header 'Content-Type: application/octet-stream' --data-binary "@${fixture}" \
  --output "${scratch}/stale.out" --write-out '%{http_code}' "${object_url}")"
[[ "${status}" == "412" ]] || fail "stale replacement did not return 412 after restart"

volume="$(docker volume ls --quiet \
  --filter "label=com.docker.compose.project=${project}" \
  --filter 'label=com.docker.compose.volume=gateway-data')"
[[ -n "${volume}" ]] || fail "Compose gateway volume could not be resolved"
lock_output=""
if lock_output="$(docker run --rm --user 10001:10001 \
  --env-file "${environment_file}" --volume "${volume}:/data" "${image}" 2>&1)"; then
  fail "a second gateway unexpectedly acquired the same data root"
fi
assert_secret_absent "${lock_output}"
grep -Fq -- 'gateway startup failed: storage directory is already in use' <<<"${lock_output}" ||
  fail "second-process storage-lock diagnostic was missing"

expect_startup_failure 'token source is missing' "${image}"
expect_startup_failure 'invalid arguments' \
  --env-file "${environment_file}" "${image}" --unsupported-option

printf 'NIAN_PASS_GATEWAY_TOKEN=%s\nNIAN_PASS_GATEWAY_TOKEN_FILE=/missing\n' \
  "${token}" >"${scratch}/ambiguous.env"
expect_startup_failure 'token source is ambiguous' \
  --env-file "${scratch}/ambiguous.env" "${image}"

printf 'NIAN_PASS_GATEWAY_TOKEN_FILE=/data\n' >"${scratch}/unreadable.env"
expect_startup_failure 'token file could not be read' \
  --env-file "${scratch}/unreadable.env" "${image}"

short_token="too-short"
printf 'NIAN_PASS_GATEWAY_TOKEN=%s\n' "${short_token}" >"${scratch}/invalid.env"
invalid_output=""
if invalid_output="$(docker run --rm --user 10001:10001 \
  --env-file "${scratch}/invalid.env" "${image}" 2>&1)"; then
  fail "invalid token unexpectedly started the gateway"
fi
grep -Fq -- 'gateway startup failed: token format is invalid' <<<"${invalid_output}" ||
  fail "invalid-token startup diagnostic was missing"
grep -Fq -- "${short_token}" <<<"${invalid_output}" && fail "invalid token leaked to diagnostics"

expect_startup_failure 'listen address could not be bound' \
  --env-file "${environment_file}" --network "container:${container_id}" \
  --tmpfs '/data:uid=10001,gid=10001,mode=0700' "${image}"

touch "${scratch}/unsafe-storage"
chmod 0600 "${scratch}/unsafe-storage"
expect_startup_failure 'storage initialization failed' \
  --env-file "${environment_file}" \
  --mount "type=bind,src=${scratch}/unsafe-storage,dst=/unsafe,readonly" \
  "${image}" --storage-dir /unsafe

printf 'Gateway container check passed.\n'
