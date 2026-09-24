# Running the agents on a server

The two agent processes are long-lived and need a public HTTPS endpoint for
GitHub to deliver webhooks to. The web app can run anywhere; it reaches the
agent over that same endpoint.

```
GitHub  ──webhook──►  <agent-hostname>  ──►  server :8787  attestor
web app ──GET /events─────────────────────►               localhost :8788  verifier
```

Only the attestor needs a public hostname. The verifier is called on localhost
by the attestor, so it needs no inbound access.

## Requirements

Node ≥ 22.23 and pnpm. Ubuntu's packaged Node is older than this:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo corepack enable
```

## Install

Run the agents as a dedicated unprivileged user:

```bash
sudo useradd --system --create-home --home-dir /opt/proofstream --shell /usr/sbin/nologin proofstream
sudo -u proofstream git clone <repo-url> /opt/proofstream
cd /opt/proofstream && sudo -u proofstream pnpm install
```

`.env` is gitignored and must be supplied separately:

```bash
sudo install -o proofstream -g proofstream -m 600 /path/to/.env /opt/proofstream/.env
```

Set `AGENT_INGRESS_URL` in it to the public HTTPS URL of the attestor.

## Services

The unit files run the same entrypoints as `pnpm agent:dev` and
`pnpm verifier:dev`, so the service and the terminal path cannot drift.

```bash
sudo cp deploy/proofstream-agent.service /etc/systemd/system/
sudo cp deploy/proofstream-verifier.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now proofstream-verifier proofstream-agent
```

Both restart automatically. This matters: GitHub retries a webhook delivery only
a few times before discarding it, so an agent that stays down loses the event
entirely. And because the attestor fails closed when it cannot buy a second
opinion, a stopped verifier halts every payout rather than degrading.

Status and logs:

```bash
systemctl status proofstream-agent --no-pager
journalctl -u proofstream-agent -f
```

## Exposing the attestor

Any method that terminates TLS and forwards to port 8787 works — a reverse proxy
with a certificate, or an outbound tunnel if inbound ports are not available.

Verify from outside the network:

```bash
curl -s https://<agent-hostname>/health
```

It returns the agent's wallet address, the registry it reads, and the streams it
serves. `502` means the service is not running.

## Firewall

An outbound tunnel needs no inbound ports at all. Both Node processes bind all
interfaces, so unless ports 8787 and 8788 are blocked they remain reachable
directly on the server's public IP, bypassing the proxy or tunnel:

```bash
sudo ufw allow OpenSSH
sudo ufw --force enable
```

## Operational note: the agent logs are state, not source

`agent/*.jsonl` are the dashboard's data source and the transaction evidence,
and every judgment appends to them. They were tracked in git until 2026-08-20,
when a deploy overwrote `verdicts.jsonl` with the committed snapshot and
destroyed eight days of decisions. They are gitignored now.

Untracking stops `git pull` and `git checkout` from touching them. It does not
stop `git clean -fdx`, a fresh clone, or an `rsync --delete`, because the files
still sit inside the deploy directory. **Set `PROOFSTREAM_LOG_DIR` to a path
outside the checkout on any deployed host.** That is the actual fix, and it is
what makes the automatic updater below safe to leave running.

**Run exactly one attestor instance.** Two instances writing the same
append-only files produce two divergent histories that cannot be merged
cleanly. To work with the logs elsewhere, copy them down rather than running a
second agent:

```bash
pnpm logs:pull
```

The seeder (`pnpm seed`) writes the same files and counts as a writer.

## Deploying without logging in

`proofstream-update.timer` pulls the server forward on its own. Every three
minutes it fetches `main`, and if it moved, asks GitHub whether the `CI`
workflow passed on that exact commit. Only then does it fast-forward, install
if the lockfile changed, and restart the two services.

```bash
sudo cp deploy/proofstream-update.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now proofstream-update.timer
```

Nothing reaches in from outside. There is no deploy key, no inbound SSH, and no
credential in GitHub: the server asks GitHub what the truth is and acts on it.
A compromised GitHub account can merge bad code; it cannot reach the machine
holding the signing wallet.

The gate is the point. A commit CI has not passed is not deployed, a commit CI
has not reported on yet is retried next tick, and a commit CI failed on leaves
the server where it is. A red run on some *other* workflow does not block the
deploy, because an unrelated failure must not strand the server on old code.

```bash
systemctl list-timers proofstream-update --no-pager
journalctl -u proofstream-update -n 50 --no-pager
```

To deploy right now rather than waiting for the tick, or to see what it would
do:

```bash
sudo systemctl start proofstream-update.service
```

To pin the server while working on something, stop the timer. It is a timer,
not a daemon, so stopping it changes nothing else:

```bash
sudo systemctl stop proofstream-update.timer
```

Restarting is safe at any moment. The attestor's reconcile loop exists for
exactly this case: a pull request judged but not yet settled when the process
died is picked up on the next boot. The verifier is restarted first and waited
for, because the attestor fails closed when it cannot buy a second opinion, and
a merge landing in the gap would escalate rather than certify.
