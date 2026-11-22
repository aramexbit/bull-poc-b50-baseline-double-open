#!/bin/bash
# B-50 node runner driver: fresh Anvil 4663 on 8562, then run-sdk-b50.mjs k4659.
# Local only: live SDK b6e7d25c verbatim + live Agreement v4.1 bytecode, mock API.
# No mainnet, no real funds, no Bull infrastructure. Throwaway local keys only.
set -u
cd "$(dirname "$0")"
ANVIL="$HOME/.foundry/bin/anvil"
"$ANVIL" --port 8562 --chain-id 4663 > "anvil-k4659.log" 2>&1 &
APID=$!
for i in $(seq 1 30); do
  curl -s -X POST -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8562 >/dev/null 2>&1 && break
  sleep 0.5
done
NODE_PATH=/home/hatch/workspace/bull-audit/node_modules node run-sdk-b50.mjs k4659 > "node-k4659.log" 2>&1
echo "node k4659 exit=$?"
kill $APID 2>/dev/null; wait $APID 2>/dev/null
sleep 1
