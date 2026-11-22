# Bull.family B-50 — Resume baseline tampering opens a duplicate $100 agreement

**Bug:** `settleStateMessage` — the message the buyer's wallet signs as `stateMac`
so "a tampered or foreign state is refused on resume" — does NOT include
`st.agreement.baselineId`. `verifySettleState` recovers the signer from exactly
that message, so a stored settle state whose `agreement.baselineId` was inflated
(0 → 99999) still verifies as the buyer's own state. `runSettleMachine`'s
`findAgreement` only adopts agreements with `id > baselineId`
(SDK `b6e7d25c`, line ~1541), so the inflated baseline HIDES the agreement that
was already opened and funded — and the machine opens a SECOND agreement for
the same $100. The duplicate is then attested and released to the seller, who
is paid a second $100 with no delivery.

**Severity:** Major — demonstrated loss is exactly $100 (buyer locked $200
total, seller gained $100 from the duplicate), at the Major bar (≥ $100).
Threat model: anyone who can modify the persisted state JSON between `settle`
and `resume` (same as B-49) — no victim private key needed.

**Location:** SDK `settleStateMessage` (~line 408) / `verifySettleState`
(~line 413) / `runSettleMachine` `findAgreement` (~line 1541)
(`https://www.bull.family/sdk/bull.mjs`, sha `b6e7d25c…`, 164,314 B).
Agreement v4.1 `0x7AB58fAAe65eFCF0037635382cAA546EaC233DA6` (Robinhood Chain 4663).

**How to reproduce (local only, no mainnet, no real funds):**

```bash
bash run.sh   # forge 1/1 + node k4659; exits 0 when the bug reproduces
```

- **Forge** (`chain/test/Round40A2.t.sol`, `Round40A2Test`,
  `testK4659_DoubleOpenSecondAgreementPaysSellerAgain`): live Agreement v4.1
  bytecode, etched zerofee. A second `createAgreement` with the SAME
  payee/asset/amount/termsHash/conditions as the first (only the expiry
  differs by 1s, as in a later resume) succeeds as id 2; arbiter attests;
  `release` pays the seller a second $100.
  Note: live v4.1 `attest()`/`release()` return no ABI-decodable bool data,
  so the test calls them via low-level `.call` (the pattern used by the
  project's own passing tests) — a typed-interface call reverts in the
  test's decoder even though the on-chain call succeeds.
- **Node** (`run-sdk-b50.mjs k4659`, fresh Anvil 4663, mock API, live SDK
  `sdk-live.mjs` verbatim): agreement 1 is created via `bull.deal`
  (`arbiter_escrow`, $100, settle tag); the state is resumed with
  `agreement.baselineId` tampered 0 → 99999 via the real
  `bull.settle.resume()`; the machine opens agreement 2; the arbiter
  attests and releases it. Result (`node-result-k4659.json`):
  `buyerLockedTotalUsdg: "200"`, `sellerGainedFromDuplicateUsdg: "100"`,
  `doubleOpenProvenOnChain: true`.
- **Pure** (same mechanism at machine level, in the round-40 work files):
  tampered baseline passes `verifySettleState`, the machine opens a second
  agreement; the honest control (baselineId 0) adopts the existing
  agreement and does NOT open.

**Suggested fix:** include the agreement baseline in the signed core — add
`agreement: { baselineId, nonce0 }` (or at least `baselineId`) to
`settleStateMessage`'s `core`, and bump the state version so old states
re-sign. Defence in depth: on resume, re-read the baseline from the chain
agreements feed instead of trusting the stored value, or require
`findAgreement` to also match the `settle:<id>` terms hash of the ORIGINAL
agreement before deciding nothing exists (the duplicate has the same terms
hash — the check must be "an agreement with this tag already exists",
not "an agreement with id > baseline exists").

**Dedupe:** NOT B-49 — B-49 is `request.*` outside `stateMac` (different
field, different fix: covering `request` does not cover `baselineId`).
NOT K-4128 — that one sets `baselineId=0` and adopts an OLD agreement as a
fake "paid" signal with NO funds moved (opposite direction). No third-party
claim of a baselineId gap (see the report's Dedupe section).

**Files:** `sdk-live.mjs` (live SDK, sha `b6e7d25c…`), `run-sdk-b50.mjs`
(node PoC, mode `k4659`), `mocks/` (live Agreement v4.1 + escrow v3
zerofee bytecode, MockERC20/MockLocker/TrapLocker ABIs), `chain/`
(Foundry project with the forge test).
