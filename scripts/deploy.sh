#!/bin/bash
# Ship the current code to the Kolo server and restart its services.
#   KOLO_SERVER=ubuntu@84.12.109.77 KOLO_KEY=~/.ssh/kolo-oracle.key bash scripts/deploy.sh
# Copies source only: never .env, the WhatsApp login (bot/auth) or saved state (bot/data).
set -e
cd "$(dirname "$0")/.."
SERVER=${KOLO_SERVER:?set KOLO_SERVER, e.g. ubuntu@84.12.109.77}
KEY=${KOLO_KEY:-~/.ssh/kolo-oracle.key}
tar -czf - bot/src bot/package.json bot/package-lock.json wallet/src wallet/public wallet/package.json wallet/package-lock.json scripts |
  ssh -i "$KEY" "$SERVER" 'cd ~/kolo && tar -xzf - && sudo systemctl restart kolo-wallet kolo-bot && sleep 3 && systemctl is-active kolo-wallet kolo-bot'
