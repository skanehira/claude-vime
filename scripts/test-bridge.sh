#!/bin/sh
# bridge/bridge.lua の実機テスト。nvim・jq・libanthy-unicode が必要で、無ければ skip して exit 0。
# 学習データは XDG_CONFIG_HOME/anthy に書かれるので、検査ごとに一時ディレクトリへ向ける。
# HOME は差し替えない: bridge の lib 探索は ~ を展開するため、差し替えると別の libanthy を拾う。
set -u
root=$(cd "$(dirname "$0")/.." && pwd)
bridge="$root/bridge/bridge.lua"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if ! command -v nvim >/dev/null 2>&1; then
  echo "SKIP: nvim not found"
  exit 0
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "SKIP: jq not found"
  exit 0
fi

# run <config dir> <request>: the bridge's answer lands in $work/raw.json
run() {
  printf '%s\n' "$2" | XDG_CONFIG_HOME="$1" nvim --headless -l "$bridge" > "$work/raw.json"
}

fresh() {
  mktemp -d "$work/config.XXXXXX"
}

run "$(fresh)" '{"yomi":"きょうはいい"}'
printf '%s\n' '{"error":"libanthy not found"}' > "$work/nolib.json"
if cmp -s "$work/raw.json" "$work/nolib.json"; then
  echo "SKIP: libanthy not found"
  exit 0
fi

failed=0
# expect <name> <jq filter> <expected line>: compares the last answer
expect() {
  if [ ! -s "$work/raw.json" ]; then
    echo "FAIL $1: bridge printed nothing"
    failed=1
    return
  fi
  jq -c "$2" "$work/raw.json" > "$work/actual.json"
  printf '%s\n' "$3" > "$work/expected.json"
  if cmp -s "$work/actual.json" "$work/expected.json"; then
    echo "PASS $1"
  else
    echo "FAIL $1"
    echo "  expected: $(cat "$work/expected.json")"
    echo "  actual:   $(cat "$work/actual.json")"
    failed=1
  fi
}

BEST='[.segments[] | {yomi, best: .candidates[0]}]'

run "$(fresh)" '{"yomi":"きょうはいい"}'
expect "convert splits the reading into segments with their best candidates" "$BEST" \
  '[{"yomi":"きょうは","best":"今日は"},{"yomi":"いい","best":"良い"}]'

run "$(fresh)" '{"yomi":"きょうはいい","resizes":[[0,-1]]}'
expect "a resize of segment 0 by -1 shortens the first segment" '.segments[0] | {yomi, best: .candidates[0]}' \
  '{"yomi":"きょう","best":"今日"}'

config=$(fresh)
run "$config" '{"yomi":"きょうはいい","commit":[0,1]}'
expect "commit still answers the segments as converted" "$BEST" \
  '[{"yomi":"きょうは","best":"今日は"},{"yomi":"いい","best":"良い"}]'
run "$config" '{"yomi":"きょうはいい"}'
expect "a committed choice (segment 1, candidate 1) comes first the next time" "$BEST" \
  '[{"yomi":"きょうは","best":"今日は"},{"yomi":"いい","best":"いい"}]'

run "$(fresh)" ''
expect "an empty request is answered with an error" '.' '{"error":"empty request"}'

run "$(fresh)" '{"yomi":""}'
expect "a request without a reading is answered with an error" '.' '{"error":"invalid request"}'

exit "$failed"
