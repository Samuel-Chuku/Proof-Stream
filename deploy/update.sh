#!/usr/bin/env bash
#
# PULL THE DEPLOY FORWARD, if and only if main moved and CI passed on it.
#
# Run by proofstream-update.timer. Nothing reaches in from outside: there is no
# inbound SSH, no deploy key, and no credential in GitHub. The server asks
# GitHub what the truth is and acts on it, which means the blast radius of a
# compromised GitHub account stops at "can merge bad code", not "can reach the
# machine that holds the signing wallet".
#
# It is safe to run at any moment. The attestor's reconcile loop exists for
# exactly this: a pull request judged but not yet settled when the process died
# is picked up on the next boot. What a restart cannot survive is being killed
# between the chain accepting `certify` and the ledger row being written, and
# that window is the same one an ordinary crash has.
set -euo pipefail

DIR=${PROOFSTREAM_DIR:-/opt/proofstream}
# Not named USER: that is already in root's environment, and a name that means
# two things in one script is a name waiting to be read wrong.
RUNAS=${PROOFSTREAM_USER:-proofstream}
REPO=${PROOFSTREAM_REPO:-Samuel-Chuku/Proof-Stream}
BRANCH=${PROOFSTREAM_BRANCH:-main}
# The workflow whose conclusion gates the deploy. A commit is deployable when
# this one succeeded on it. Named rather than "all of them", because an
# unrelated workflow going red must not strand the server on old code.
GATE=${PROOFSTREAM_GATE:-CI}

say() { echo "[update] $*"; }

# EVERY GIT CALL RUNS AS THE REPOSITORY'S OWNER, never as root.
#
# This service runs as root so it can restart the two units, and git refuses to
# work in a repository owned by somebody else: "detected dubious ownership",
# exit 128. The fix is NOT `safe.directory`. That would silence the warning and
# let root write to the checkout, and a root-owned file left in .git is a
# repository the agent's own user can no longer pull. Dropping privileges is
# both the safe answer and the correct one.
g() { sudo -u "$RUNAS" git "$@"; }

cd "$DIR"

g fetch --quiet origin "$BRANCH"
have=$(g rev-parse HEAD)
want=$(g rev-parse "origin/$BRANCH")

if [ "$have" = "$want" ]; then
  exit 0
fi

say "$BRANCH moved: ${have:0:7} -> ${want:0:7}"

# THE GATE. Unauthenticated, because the repository is public and check runs on
# a public repository are public. If the answer cannot be read, because GitHub
# is down or the rate limit is spent, that is not permission to deploy.
conclusion=$(
  curl -fsS --max-time 20 \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/commits/$want/check-runs" |
    node -e '
      let d = "";
      process.stdin.on("data", (c) => (d += c)).on("end", () => {
        const runs = (JSON.parse(d).check_runs ?? []).filter((r) => r.name === process.argv[1]);
        // No run at all is not a pass. A commit CI has not seen yet is simply
        // not ready, and the next tick will ask again.
        if (runs.length === 0) return console.log("absent");
        if (runs.some((r) => r.status !== "completed")) return console.log("running");
        console.log(runs.every((r) => r.conclusion === "success") ? "success" : "failed");
      });
    ' "$GATE"
) || { say "could not read the check runs; not deploying"; exit 0; }

case "$conclusion" in
  success) ;;
  running) say "CI is still running on ${want:0:7}; waiting for the next tick"; exit 0 ;;
  absent) say "CI has not reported on ${want:0:7} yet; waiting for the next tick"; exit 0 ;;
  *) say "CI did not pass on ${want:0:7}; staying on ${have:0:7}"; exit 1 ;;
esac

# INSTALL ONLY WHEN THE LOCKFILE MOVED. `pnpm install` on every deploy is a
# minute of nothing, and a minute in which node_modules is half-written while
# two live services are reading it.
lockfile_changed=false
g diff --quiet "$have" "$want" -- pnpm-lock.yaml || lockfile_changed=true

g merge --ff-only "origin/$BRANCH"
say "now on $(g rev-parse --short HEAD)"

if [ "$lockfile_changed" = true ]; then
  say "the lockfile changed; installing"
  sudo -u "$RUNAS" pnpm install --frozen-lockfile --dir "$DIR"
fi

# THE VERIFIER FIRST, AND WAIT FOR IT. The attestor fails closed when it cannot
# buy a second opinion: a merge landing in the gap between the two restarts
# would escalate instead of certifying, and escalations are not retried.
systemctl restart proofstream-verifier
up=false
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:8788/health > /dev/null 2>&1; then
    up=true
    break
  fi
  sleep 1
done
if [ "$up" = true ]; then
  say "verifier is up"
else
  # Start the attestor anyway. It fails closed without a second opinion, which
  # is a loud escalation in the ledger; not running at all is a silent one.
  say "verifier did not answer in 30s; starting the attestor regardless"
fi

systemctl restart proofstream-agent
say "deployed ${want:0:7}"
