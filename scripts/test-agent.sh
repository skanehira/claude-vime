#!/bin/sh
# What hooks/anthy.ts relies on in anthy-agent's egg mode, checked against each
# agent installed (anthy-agent-unicode, anthy-agent; VIME_ANTHY_AGENT alone when set).
# Exits 0 with SKIP when none is installed.
#
# Learning records go to a test personality: anthy-unicode writes them under a
# temporary XDG_CONFIG_HOME, anthy 9100h under ~/.anthy, whose test files this
# script removes when it ends.
set -u
work=$(mktemp -d)
personality="vime-test-$$"
trap 'rm -rf "$work"; rm -f "$HOME/.anthy/last-record1_$personality".* "$HOME/.anthy/last-record2_$personality".* "$HOME/.anthy/lock-file_$personality"' EXIT

if [ -n "${VIME_ANTHY_AGENT:-}" ]; then
  agents=$VIME_ANTHY_AGENT
else
  agents="anthy-agent-unicode anthy-agent"
fi

failed=0
tested=0

# talk <agent> <commands...>: one agent session, its answer (CR removed) in $work/answer.txt
talk() {
  agent=$1
  shift
  { printf 'NEW-CONTEXT INPUT=#18 OUTPUT=#18\n'; for command in "$@"; do printf '%s\n' "$command"; done; printf 'QUIT\n'; } |
    XDG_CONFIG_HOME="$work/config" "$agent" --egg --utf8 "--personality=$personality" > "$work/raw.txt" 2> "$work/stderr.txt"
  status=$?
  tr -d '\r' < "$work/raw.txt" > "$work/answer.txt"
  if [ "$status" -ne 0 ]; then
    echo "FAIL $agent exited with $status: $(head -1 "$work/stderr.txt")"
    failed=1
  fi
}

# firsts: the first candidate of each GET-CANDIDATES answer, "-" past the last segment, one line
firsts() {
  awk '
    /^\+DATA [0-9]+ -1$/ { out = out sep "-"; sep = " "; next }
    /^\+DATA [0-9]+ [0-9]+$/ { want = 1; next }
    want == 1 { out = out sep $0; sep = " "; want = 0 }
    END { print out }
  ' "$work/answer.txt"
}

# expect <name> <actual file> <expected line>
expect() {
  printf '%s\n' "$3" > "$work/expected.txt"
  if cmp -s "$2" "$work/expected.txt"; then
    echo "PASS $agent: $1"
  else
    echo "FAIL $agent: $1"
    echo "  expected: $(cat "$work/expected.txt")"
    echo "  actual:   $(cat "$2")"
    failed=1
  fi
}

for agent in $agents; do
  if ! "$agent" --version > /dev/null 2>&1 < /dev/null; then
    continue
  fi
  tested=1

  talk "$agent" 'CONVERT 0 きょうはいい' 'GET-CANDIDATES 0 0 0 1024' 'GET-CANDIDATES 0 1 0 1024' 'GET-CANDIDATES 0 2 0 1024'
  firsts > "$work/actual.txt"
  expect "convert answers each segment's candidates, and -1 past the last" "$work/actual.txt" '今日は 良い -'

  # RESIZE-SEGMENT's last field is a direction flag, not an amount: 0 lengthens, anything else shortens.
  talk "$agent" 'CONVERT 0 きょうはいい' 'RESIZE-SEGMENT 0 0 1' 'GET-CANDIDATES 0 0 0 1024'
  firsts > "$work/actual.txt"
  expect "RESIZE-SEGMENT with 1 shortens the first segment" "$work/actual.txt" '今日'

  talk "$agent" 'CONVERT 0 きょうはいい' 'RESIZE-SEGMENT 0 0 0' 'GET-CANDIDATES 0 0 0 1024'
  firsts > "$work/actual.txt"
  expect "RESIZE-SEGMENT with 0 lengthens the first segment" "$work/actual.txt" 'きょうはい'

  talk "$agent" 'CONVERT 0 きょうはいい' 'SELECT-CANDIDATE 0 0 0' 'SELECT-CANDIDATE 0 1 1' 'COMMIT 0 0'
  tail -1 "$work/answer.txt" > "$work/actual.txt"
  expect "the commit answers +OK" "$work/actual.txt" '+OK'

  talk "$agent" 'CONVERT 0 きょうはいい' 'GET-CANDIDATES 0 0 0 1024' 'GET-CANDIDATES 0 1 0 1024'
  firsts > "$work/actual.txt"
  expect "a committed choice (segment 1, candidate 1) comes first the next time" "$work/actual.txt" '今日は いい'
done

if [ "$tested" -eq 0 ]; then
  echo "SKIP: no anthy-agent found ($agents)"
  exit 0
fi
exit "$failed"
