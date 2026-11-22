#!/bin/bash
# Run the B-50 PoC end to end: forge test (Round40A2Test) + node live-SDK mode k4659.
# Exits 0 when the bug reproduces, 1 when it does not.
# Local only: fresh Anvil 4663, mock API, live SDK b6e7d25c verbatim.
# No mainnet, no real funds, no Bull infrastructure.
set -u
cd "$(dirname "$0")"
FORGE="${FORGE:-$HOME/.foundry/bin/forge}"
echo "=== forge: chain/test/Round40A2.t.sol ==="
(cd chain && "$FORGE" test --match-contract Round40A2Test 2>&1 | tee ../forge-staging.log)
if ! grep -q "1 tests passed" forge-staging.log; then
  echo "B-50 NOT reproduced (forge did not pass 1/1)"
  exit 1
fi
echo "=== node: run-sdk-b50.mjs k4659 ==="
bash run-node.sh 2>&1 | tee run-staging.log
if grep -q '"doubleOpenProvenOnChain": true' node-result-k4659.json && grep -q '"buyerLockedTotalUsdg": "200"' node-result-k4659.json && grep -q '"sellerGainedFromDuplicateUsdg": "100"' node-result-k4659.json; then
  echo "B-50 reproduced: tampered baselineId hides agreement 1, machine opens a duplicate \$100 agreement; buyer locked \$200 total, seller gained \$100 from the duplicate (forge 1/1, node 1/1)"
  exit 0
fi
echo "B-50 NOT reproduced (node results mismatch)"
exit 1
