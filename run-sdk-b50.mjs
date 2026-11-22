// ROUND 33-A — Team A. Live SDK (sha f450d44d…, 54.263 B, snapshot
// live-api-round33-a, byte-identical to Minor 12) + Agreement
// v4.1 etched zerofee on fresh Anvil 4663. Real SDK verbatim + mock API.
// Throwaway local (anvil) keys only. No live POSTs, no real funds.
// Usage: node run-sdk-round33.mjs <mode>  (fresh Anvil per run, port 8553)
// Modes k3382..k3411: Round 33 candidates M-1032..M-1061 (see
// work/round33-candidates-a.md). Re-grade modes re-used verbatim:
// k2549/k2550/k2568 (B-23), k2370 (B-15 token_price_trigger), k2854 (B-15
// settled-deal reuse), k2939 (M-233), k2940 (M-293 family, stepHours=36).
// Modes k3121..k3140: Minor 11 candidates M-762..M-781 (see
// work/minor11-candidates-a.md). Re-triage modes re-used verbatim:
// k2939 (M-233), k2940 (M-293 family, stepHours=36).
// Modes k2740/k2741/k2742/k2743/k2751/k2723 are verbatim re-runs of the
// Major 29 Tim C modes (M-410/M-411 carry-over, OBS unverified there:
// the GATE claimed a `parseUnits is not defined` harness failure, but
// the round29-c logs on disk (run-node-all-2.log, 06:13 WIB, BEFORE the
// GATE was written) show all five modes DID execute green. This round
// re-runs them independently to confirm.)
// New modes k2757..k2770, k2778: Minor 9 candidates M-412..M-421.
//   k2542 : LEAD (M-232) — deal("milestones" x3, stepHours=24,
//           expiryHours=500 EXPLICIT); mock server expiry per step =
//           now+max(500, 24*i) = now+500h (documented templates.json
//           formula). Expect: SDK SENDS all 3 — NO false rejection
//           when expiryHours is explicitly larger than stepHours*seen.
//   k2543 : LEAD (M-233) — deal("milestones" x2, stepHours=24,
//           expiryHours OMITTED); mock server expiry per step =
//           now+max(72, 24*i) = now+72h (templates.json: expiryHours
//           default 72; stepHours doc: refundable after
//           max(expiryHours, i x stepHours)). Expect: SDK REFUSES at
//           step 1 ("milestone 1 ... 24 hours") — the SDK's want uses
//           `expiryHours || 0` while the server/doc default is 72.
//           False rejection of a documented-valid deal (Minor-grade,
//           no funds move; workaround: pass expiryHours explicitly).
//   k2544 : CONTROL (M-234) — milestones x2, stepHours=168 (default),
//           expiryHours OMITTED; server expiry now+168h/336h.
//           Expect: SDK SENDS (refusal is specific to stepHours<72).
//   k2545 : WORKAROUND (M-235) — milestones x2, stepHours=24,
//           expiryHours=24 EXPLICIT; server expiry now+24h/48h.
//           Expect: SDK SENDS; refund of step 1 succeeds at +25h.
//   k2549 : B-23 re-grade panel quorum [attacker]/k=1 (ex k2368).
//   k2550 : B-23 re-grade confirmed_with_cooling kind-9=3600 (ex k2369).
//   k2551 : CONTROL (M-238) — recurring x2, everyHours OMITTED;
//           server kind-0 value now+168h/336h. Expect: SDK SENDS.
//   k2568 : B-23 re-grade two_of_three quorum [attacker]/k=1.
//   k2190 : CONTROL — deal("optimistic", windowHours=48) with server
//           returning kind-5 value=now (window already closed).
//           Expect: SDK REFUSES (near-value check, line ~460) — DEAD.
//   k2191 : CONTROL — deal("balance_trigger", holder=H, min=1M) with
//           server returning data=balanceOf(attacker), value=1.
//           Expect: SDK REFUSES (data/value check, line ~455) — DEAD.
//   k2192 : deal("panel", arbiters=[v1,v2,v3], k=2) with server returning
//           quorum data=[attacker], value=1. Expect: SDK SENDS; attacker
//           votes once + releases 500 USDG — B-23 K-593, FOLD (node level).
//   k2193 : deal("confirmed_with_cooling", arbiter, windowHours=720)
//           with server returning kind-9 value=3600. Expect: SDK SENDS;
//           arbiter attests; release blocked <1h, release +500 after
//           3601s — B-23 K-595, FOLD (node level).
//   k2194 : deal("arbiter_escrow", expiryHours=1) with server returning
//           expiry=now+24h. Expect: SDK SENDS (hoursMax floor is 24h);
//           refund blocked at +1h, succeeds at +24h — payer locked 24x
//           longer than asked. Delay-only -> OBS (Minor, not filed).
// (Modes k2190/k2191/k2194 server blocks kept below as dead-code
// references; only k2542/k2543/k2544/k2545/k2549/k2550/k2551/k2568 run.)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, http as vhttp, defineChain,
  parseAbi, parseUnits, parseEther, encodeFunctionData, encodeAbiParameters, keccak256, toHex, erc20Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Bull, runSettleMachine, settleTermsHash, settleStateMessage, normalizeSettlePolicy } from "./sdk-live.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RPC = "http://127.0.0.1:8562";
const API_PORT = 3022;
const AGREEMENT = "0x7AB58fAAe65eFCF0037635382cAA546EaC233DA6";
const ESCROW = "0xd961cA37e339E14e0D3478383a252E218fe7aa4a";
const ESC_ABI = parseAbi([
  "function createDeal((address seller,address sellerPayout,address buyerReceive,address sellToken,uint256 sellAmount,address payToken,uint256 payAmount,uint64 deadline) p,(uint16 feeBps,uint64 expiry,bytes sig) q,(uint64 validUntil,bytes sig) c) returns (uint256)",
  "function fundPayment(uint256 id) payable",
  "function fundTokens(uint256 id)",
  "function cancel(uint256 id)",
  "function deals(uint256) view returns (address buyer,address seller,address sellToken,uint256 sellAmount,address payToken,uint256 payAmount,uint64 deadline,bool buyerFunded,bool sellerFunded,uint8 status,address sellerPayout,address buyerReceive,uint16 feeBps)",
]);
const TRAP_ABI = parseAbi(["function trap(address token,uint256 amount,address beneficiary,address attacker) returns (uint256)"]);
const LOCKER_ABI = parseAbi([
  "function createLock(address token,uint256 amount,address beneficiary,uint64 start,uint64 cliff,uint64 end,uint64 step) returns (uint256)",
  "function claim(uint256 id)",
]);
let LOCKTOKEN = null, TRAPLOCKER = null, MOCKLOCKER = null;
let STRETCHED_SIG = null; // k2761: seller consent pre-signed for deadline now+72h
let SERVER_LOCKER = null; // k2757: locker the SERVER's steps target (may differ from caller-pinned locker)
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const ZERO = "0x0000000000000000000000000000000000000000";

const chain = defineChain({ id: 4663, name: "Robinhood Chain",
  nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" },
  rpcUrls: { default: { http: [RPC] } } });
const victimKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const arbiterKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const attackerKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const strangerKey = "0x0000000000000000000000000000000000000000000000000000000000009999";
const holderKey = "0x0000000000000000000000000000000000000000000000000000000000001111";
const victim = privateKeyToAccount(victimKey);
const arbiter = privateKeyToAccount(arbiterKey);
const attacker = privateKeyToAccount(attackerKey);
const stranger = privateKeyToAccount(strangerKey);
const holder = privateKeyToAccount(holderKey);
const V = victim.address, ARB = arbiter.address, A = attacker.address, S = stranger.address, H = holder.address;
const V1 = "0x1111111111111111111111111111111111111111";
const V2 = "0x2222222222222222222222222222222222222222";
const V3 = "0x3333333333333333333333333333333333333333";
const V4 = "0x4444444444444444444444444444444444444444";
const V5 = "0x5555555555555555555555555555555555555555";
const V6 = "0x6666666666666666666666666666666666666666";
const V7 = "0x7777777777777777777777777777777777777777";
const V8 = "0x8888888888888888888888888888888888888888";
const TREASURY = "0x1B3b7abb6553a1bbc9B285E6ab3F2012e88e4d5f";

const publicClient = createPublicClient({ chain, transport: vhttp(RPC) });
const walletV = createWalletClient({ chain, transport: vhttp(RPC), account: victim });
const walletA = createWalletClient({ chain, transport: vhttp(RPC), account: attacker });
const walletR = createWalletClient({ chain, transport: vhttp(RPC), account: arbiter });
const walletS = createWalletClient({ chain, transport: vhttp(RPC), account: stranger });
const wall = () => Math.floor(Date.now() / 1000);

const AGR_ABI = parseAbi([
  "function createAgreement((address payee,address asset,uint256 amount,uint64 expiry,bytes32 termsHash,(uint8 kind,address target,bytes data,uint256 value)[] conditions) p,(uint256 feeWei,uint64 expiry,bytes sig) q) payable returns (uint256)",
  "function attest(uint256 id,uint256 index) returns (bool)",
  "function vote(uint256 id,uint256 index) returns (bool)",
  "function release(uint256 id) returns (bool)",
  "function refund(uint256 id) returns (bool)",
]);
const approveCall = (spender, amt) => encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amt] });
const tx = (to, data, value = "0") => ({ to, data, value });
const bal = (token, who) => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
const zero32 = "0x" + "00".repeat(32);
const termsHashOf = (terms) => (terms ? keccak256(toHex(String(terms))) : zero32);

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(method + ": " + JSON.stringify(j.error)); return j.result;
}
const toHex32 = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const current = { mode: "k2190", stretchDeadline: 0, stretchValidUntil: 0, receiptSig: null };

function mkAgr(payee, asset, amount, expiry, termsHash, conds) {
  return encodeFunctionData({ abi: AGR_ABI, functionName: "createAgreement",
    args: [{ payee, asset, amount, expiry: BigInt(expiry), termsHash, conditions: conds },
           { feeWei: 0n, expiry: BigInt(wall() + 3600), sig: "0x" + "00".repeat(65) }] });
}
// MINOR 11 k3127: createAgreement carrying an explicit feeWei (B-45 fold re-confirm).
function mkAgrFee(payee, asset, amount, expiry, termsHash, conds, feeWei) {
  return encodeFunctionData({ abi: AGR_ABI, functionName: "createAgreement",
    args: [{ payee, asset, amount, expiry: BigInt(expiry), termsHash, conditions: conds },
           { feeWei: BigInt(feeWei), expiry: BigInt(wall() + 3600), sig: "0x" + "00".repeat(65) }] });
}
const balData = (who) => encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [who] }).toLowerCase();

// ================= ROUND 32 (M-852..M-881, K-3202..K-3231) =================
// Mock-server step builders for the /api/v1/templates surface. Each entry
// returns the steps the (untrusted) server would return for that mode.
// Helpers passed in as ctx: w, expiry(h), th, mkAgr, mkAgrFee, approve,
// amt500, balData. qdata encodes a panel voter list.
const _q = (voters) => encodeAbiParameters([{ type: "address[]" }], [voters]).toLowerCase();
const _enc = (n) => encodeAbiParameters([{ type: "uint256" }], [BigInt(n)]).toLowerCase();
const _att = (t) => [{ kind: 1, target: t, data: "0x", value: 0n }];
const R32T = {
  k3202: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-852 panel [A]/k=1 (B-23 fold)
  k3203: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 0n }])) }], // M-853 cooling value=0
  k3204: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w) }])) }], // M-854 token_price_trigger kind-0 now (B-15 fold)
  k3205: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 7, target: USDG, data: c.balData(A), value: 0n }])) }], // M-855 token_price_trigger kind-7 bal(A)>=0 (B-15 fold)
  k3206: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-856 two_of_three [A]/k=1 (B-23 fold)
  k3207: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([V3, V2, V1]), value: 2n }])) }], // M-857 panel voters reordered, same set
  k3208: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([ARB, ARB, ARB]), value: 1n }])) }], // M-858 panel dup voters [ARB x3]/k=1
  k3209: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-859 cooling, arbiter=attacker (caller-chosen)
  k3212: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, _att(ARB))) }], // M-862 arbiter_escrow, arbiter OMITTED by caller (honest server steps)
  k3213: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(1), c.th, _att(ARB))) }], // M-863 arbiter_escrow expiry 72h->1h (B-46 fold)
  k3214: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250n * 10n ** 6n, 72), ms(250n * 10n ** 6n, 336)]; }, // M-864 milestones step1 expiry 72<168
  k3215: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(62500001n, 168), ms(62499999n, 336), ms(62500000n, 504), ms(62500000n, 672), ms(62500000n, 840), ms(62500000n, 1008), ms(62500000n, 1176), ms(62500000n, 1344)]; }, // M-865 milestones x8 honest control
  k3216: (c) => { const rec = (h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + h * 3600) }])) }); return [c.approve(USDG, 1500n * 10n ** 6n), rec(168), rec(336), rec(504)]; }, // M-866 recurring x3, every step expiry 24h (M-498 family)
  k3217: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(S, USDG, 250n * 10n ** 6n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }, { transaction: tx(AGREEMENT, mkAgr(A, USDG, 250n * 10n ** 6n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }], // M-867 split payees swapped
  k3218: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, 250n * 10n ** 6n, c.expiry(72), c.th, _att(A))) }, { transaction: tx(AGREEMENT, mkAgr(S, USDG, 250n * 10n ** 6n, c.expiry(72), c.th, _att(A))) }], // M-868 split arbiter swapped to attacker
  k3219: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(1), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }], // M-869 scheduled expiry 1h < unlock 24h (B-38 fold)
  k3220: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 7, target: USDG, data: "0x1234", value: 1000000n }])) }], // M-870 price value scaled 100->1,000,000
  k3221: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 7, target: USDG, data: "0x5678", value: 100n }])) }], // M-871 price data swapped
  k3222: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 7, target: USDG, data: c.balData(A), value: 1000000n * 10n ** 6n }])) }], // M-872 balance holder swapped H->A
  k3223: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 4, target: AGREEMENT, data: "0x", value: 1n }])) }], // M-873 after_deal target=Agreement contract
};
// ================= MINOR 12-A (M-942..M-971, K-3292..K-3321) =================
// Follow-up M-932: duplicate-voter quorum [A,A]/k=2 and [A,A,V1]/k=2;
// [A,S]/k=2 two attacker-controlled wallets; cooling data=999; split/
// milestones amount checks; scheduled immediacy; lock beneficiary swap.
const STREAM = "0xf02ad48d7ae63f17941e78aaf228c1450db13891";
const STREAM_ABI = parseAbi([
  "function createStream((address payee,address arbiter,address asset,uint256 amount,uint64 start,uint64 durationSecs) p,(uint256 feeWei,uint64 expiry,bytes sig) q) payable returns (uint256)",
]);
const BULLT = "0x30768B5482e5dd8a2487cE0BE61E01fA03Af37ff";
const M12T = {
  k3292: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A, A]), value: 2n }])) }], // M-942 panel [A,A]/k=2 (M-932 follow-up)
  k3293: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A, S]), value: 2n }])) }], // M-943 panel [A,S]/k=2, both attacker-controlled
  k3294: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A, A, V1]), value: 2n }])) }], // M-944 panel [A,A,V1]/k=2
  k3295: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-945 cooling, arbiter=payee (caller-chosen)
  k3296: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 5, target: V, data: "0x", value: BigInt(c.w + 86400) }])) }], // M-946 optimistic, windowHours omitted, kind-5 now+24h
  k3297: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 7, target: BULLT, data: "0x1234", value: 100n }])) }], // M-947 price_trigger target swapped USDG->BULL
  k3298: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 7, target: USDG, data: c.balData(H), value: 0n }])) }], // M-948 balance_trigger min=0 (trivially true)
  k3299: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, _att(ARB))) }], // M-949 arbiter_escrow expiry 168h->24h (B-46 shrink)
  k3300: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-950 milestones stepHours=6, expiry omitted (M-293 gen)
  k3301: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 100), ms(249999999n, 200)]; }, // M-951 milestones stepHours=100, expiry omitted
  k3302: (c) => { const th2 = keccak256(toHex("M12 step2")); return [c.approve(USDG, 600n * 10n ** 6n),
    { transaction: tx(AGREEMENT, mkAgr(A, USDG, 200n * 10n ** 6n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) },
    { transaction: tx(AGREEMENT, mkAgr(A, USDG, 200n * 10n ** 6n, c.expiry(72), th2, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) },
    { transaction: tx(AGREEMENT, mkAgr(V1, USDG, 200n * 10n ** 6n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }]; }, // M-952 split x3, step2 payee swapped S->A
  k3303: (c) => [c.approve(USDG, c.amt500),
    { transaction: tx(AGREEMENT, mkAgr(A, USDG, 500n * 10n ** 6n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) },
    { transaction: tx(AGREEMENT, mkAgr(S, USDG, 0n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }], // M-953 split amounts [500,0] vs [250,250]
  k3304: (c) => { const rec = (i) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + i * 168 * 3600) }])) }); const steps = [c.approve(USDG, 6000n * 10n ** 6n)]; for (let i = 1; i <= 12; i++) steps.push(rec(i)); return steps; }, // M-954 recurring x12, expiry 72h < unlock 168h
  k3309: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w) }])) }], // M-959 scheduled afterHours=24, server kind-0 now (immediate)
  k3310: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 25 * 3600) }])) }], // M-960 scheduled afterHours=24, server kind-0 now+25h
  k3311: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 5, target: V, data: "0x", value: BigInt(c.w + 3600) }])) }], // M-961 optimistic windowHours=1, kind-5 now+1h (exact)
  k3312: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([V1, V2, V3]), value: 3n }])) }], // M-962 panel k=3 honest control
  k3313: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([V1]), value: 1n }])) }], // M-963 panel k lowered 2->1 (B-23 fold)
  k3314: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([ZERO]), value: 1n }])) }], // M-964 panel quorum voter=ZERO
  k3315: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(999), value: 3600n }])) }], // M-965 cooling kind-9 data=999 (not 0)
  k3316: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, _att(ZERO))) }], // M-966 arbiter_escrow arbiter=ZERO
  k3317: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(499n * 10n ** 6n, 168), ms(1n * 10n ** 6n, 336)]; }, // M-967 milestones amounts swapped [499,1] vs [250,250]
  k3321: (c) => [c.approve(USDG, 1n), { transaction: tx(AGREEMENT, mkAgr(A, USDG, 1n, c.expiry(72), c.th, _att(ARB))) }], // M-971 arbiter_escrow dust amount=1 micro-USDG (caller asks "0.000001")
};
// ================= ROUND 33-A (M-1032..M-1061, K-3382..K-3411) =================
// New angles: panel voter=payer himself; two_of_three [A,S]/k=2; cooling
// value 3599 (floor-1) / 86400 (24h vs 720h asked) / 3600 at windowHours=1;
// optimistic 168h exact / 23h vs 24h (near() tol); balance_trigger holder=A
// min=1M (condition TRUE on-chain); price_trigger op swap gte->lte;
// token_price_trigger price=0; after_deal target=live escrow v3 / dealId=0;
// milestones stepHours=71 (M-293 gen 9), expiryHours=72 explicit,
// expiryHours=24 < stepHours=168; recurring everyHours=1 / x12 everyHours=8760;
// split [1,2,3] + [999999,1] exact-micro; scheduled 167h vs 168h,
// expiry==unlock boundary; agree expiryHours=1, attest swap, veto kind-9
// shrink; arbiter_escrow 24h floor / 23h->24h stretch; open payAmount shrink
// + feeBps tx 0 vs quote 250; lock start -365d; panel [A]/k=1 payee=S.
const R33T = {
  k3382: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([V]), value: 1n }])) }], // M-1032 panel [payer]/k=1 (voter = payer himself)
  k3383: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A, S]), value: 2n }])) }], // M-1033 two_of_three [A,S]/k=2
  k3384: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-1034 cooling windowHours=1, kind-9 value=3600 exact
  k3385: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3599n }])) }], // M-1035 cooling kind-9 value=3599 (floor-1)
  k3386: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 86400n }])) }], // M-1036 cooling kind-9 value=86400 (24h vs 720h asked)
  k3387: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 5, target: V, data: "0x", value: BigInt(c.w + 168 * 3600) }])) }], // M-1037 optimistic windowHours=168 exact
  k3388: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 5, target: V, data: "0x", value: BigInt(c.w + 23 * 3600) }])) }], // M-1038 optimistic windowHours=24, kind-5 now+23h (1h short)
  k3389: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 7, target: USDG, data: c.balData(A), value: 1000000n * 10n ** 6n }])) }], // M-1039 balance_trigger holder=A min=1M (TRUE on-chain: A minted 1M)
  k3390: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 8, target: USDG, data: "0x1234", value: 100n }])) }], // M-1040 price_trigger op gte asked, server kind-8 lte
  k3391: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }])) }], // M-1041 token_price_trigger price=0, kind-1 attest-by-payee (B-15 shape)
  k3392: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 4, target: ESCROW, data: "0x", value: 1n }])) }], // M-1042 after_deal kind-4 target=live escrow v3, dealId=1
  k3393: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 4, target: "0xd685d39E7a3deF19E52B9AB09679b7452C23e20b", data: "0x", value: 0n }])) }], // M-1043 after_deal dealId=0, target=DvP escrow
  k3394: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250n * 10n ** 6n, 72), ms(250n * 10n ** 6n, 72)]; }, // M-1044 milestones stepHours=71, expiry omitted (M-293 gen 9)
  k3395: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-1045 milestones stepHours=24, expiryHours=72 EXPLICIT (amounts distinct: on-chain duplicate-guard)
  k3396: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250n * 10n ** 6n, 24), ms(250n * 10n ** 6n, 48)]; }, // M-1046 milestones stepHours=168, expiryHours=24 EXPLICIT (< stepHours)
  k3397: (c) => { const rec = (h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + h * 3600) }])) }); return [c.approve(USDG, 1000n * 10n ** 6n), rec(1), rec(2)]; }, // M-1047 recurring x2, everyHours=1
  k3398: (c) => { const rec = (i) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + i * 8760 * 3600) }])) }); const steps = [c.approve(USDG, 6000n * 10n ** 6n)]; for (let i = 1; i <= 12; i++) steps.push(rec(i)); return steps; }, // M-1048 recurring x12, everyHours=8760
  k3399: (c) => [c.approve(USDG, c.amt500),
    { transaction: tx(AGREEMENT, mkAgr(A, USDG, 83333334n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) },
    { transaction: tx(AGREEMENT, mkAgr(S, USDG, 166666666n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) },
    { transaction: tx(AGREEMENT, mkAgr(V1, USDG, 250000000n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }], // M-1049 split shares [1,2,3] exact micro [83333334,166666666,250000000]
  k3400: (c) => [c.approve(USDG, c.amt500),
    { transaction: tx(AGREEMENT, mkAgr(A, USDG, 499999500n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) },
    { transaction: tx(AGREEMENT, mkAgr(S, USDG, 500n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }], // M-1050 split shares [999999,1] exact micro [499999500,500]
  k3401: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 167 * 3600) }])) }], // M-1051 scheduled afterHours=168, server kind-0 now+167h
  k3402: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }], // M-1052 scheduled afterHours=24, expiryHours=24 (expiry == unlock)
  k3406: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, _att(ARB))) }], // M-1056 arbiter_escrow expiryHours=24 (floor exact)
  k3407: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, _att(ARB))) }], // M-1057 arbiter_escrow expiryHours=23, server now+24h (stretch +1h)
  k3411: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(S, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-1061 panel [A]/k=1, payee=S (voter != payee)
};
// ================= MINOR 13-A (M-1122..M-1151, K-3472..K-3501) =================
// New angles: M-293 gen 10 (stepHours=48) + gen 11 (73); arbiter_escrow
// expiry shrink 168h->1h / 72h->1h (M-1113 re-grade as Minor); panel
// [V1]/k=1 + two_of_three [V1,V2]/k=2 (voters nobody holds); cooling
// value 3601 (floor+1) / 7200 (2h); optimistic 1h exact / 25h vs 24h;
// scheduled 23h / 25h vs 24h; balance_trigger holder=H min=1 (false);
// price_trigger op lte vs server gte; token_price_trigger price=1
// (B-15 shape); after_deal dealId=2; milestones 24h/48h explicit,
// stepHours=72 omitted; recurring x2/24h + x12/1h; split [1,1] exact +
// [2,1] swapped; agree veto 1h / 3-attest honest / expiry 168h;
// open feeBps quote 0 vs tx 250 (mirror M-1059) + payAmount grow
// 0.25->0.26; lock cliff==start + beneficiary=ZERO (caller-named burn);
// vesting claim(1) re-triage (M-233).
const M13T = {
  k3472: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-1122 milestones stepHours=48, expiry omitted (M-293 gen 10)
  k3473: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(1), c.th, _att(ARB))) }], // M-1123 arbiter_escrow expiry 168h->1h
  k3474: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(1), c.th, _att(ARB))) }], // M-1124 arbiter_escrow expiry 72h->1h (M-1113 re-grade)
  k3475: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([V1]), value: 1n }])) }], // M-1125 panel [V1]/k=1 (voter keyless)
  k3476: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([V1, V2]), value: 2n }])) }], // M-1126 two_of_three [V1,V2]/k=2 (voters keyless)
  k3477: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3601n }])) }], // M-1127 cooling kind-9 value=3601 (floor+1), windowHours=1
  k3478: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 7200n }])) }], // M-1128 cooling kind-9 value=7200 (2h), windowHours=2
  k3479: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 5, target: V, data: "0x", value: BigInt(c.w + 3600) }])) }], // M-1129 optimistic windowHours=1, kind-5 now+1h exact
  k3480: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 5, target: V, data: "0x", value: BigInt(c.w + 25 * 3600) }])) }], // M-1130 optimistic windowHours=24, kind-5 now+25h (1h long)
  k3481: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 23 * 3600) }])) }], // M-1131 scheduled afterHours=24, server kind-0 now+23h (1h short)
  k3482: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 25 * 3600) }])) }], // M-1132 scheduled afterHours=24, server kind-0 now+25h (1h long)
  k3483: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 7, target: USDG, data: c.balData(H), value: 1000000n }])) }], // M-1133 balance_trigger holder=H min=1 USDG (1e6 micro; H holds 0: FALSE)
  k3484: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 8, target: USDG, data: "0x1234", value: 100n }])) }], // M-1134 price_trigger op lte asked, server kind-8 gte
  k3485: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }])) }], // M-1135 token_price_trigger price=1, kind-1 attest-by-payee (B-15 shape)
  k3486: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 4, target: ESCROW, data: "0x", value: 2n }])) }], // M-1136 after_deal kind-4 target=live escrow v3, dealId=2
  k3487: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 48), ms(249999999n, 48)]; }, // M-1137 milestones stepHours=24, expiryHours=48 EXPLICIT
  k3488: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-1138 milestones stepHours=72, expiry omitted (step2 want 144 vs server 72)
  k3489: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-1139 milestones stepHours=73, expiry omitted (M-293 gen 11)
  k3490: (c) => { const rec = (h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + h * 3600) }])) }); return [c.approve(USDG, 1000n * 10n ** 6n), rec(24), rec(48)]; }, // M-1140 recurring x2, everyHours=24
  k3491: (c) => { const rec = (i) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + i * 3600) }])) }); const steps = [c.approve(USDG, 6000n * 10n ** 6n)]; for (let i = 1; i <= 12; i++) steps.push(rec(i)); return steps; }, // M-1141 recurring x12, everyHours=1
  k3492: (c) => [c.approve(USDG, c.amt500),
    { transaction: tx(AGREEMENT, mkAgr(A, USDG, 250n * 10n ** 6n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) },
    { transaction: tx(AGREEMENT, mkAgr(S, USDG, 250n * 10n ** 6n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }], // M-1142 split shares [1,1] exact micro [250,250]
  k3493: (c) => [c.approve(USDG, c.amt500),
    { transaction: tx(AGREEMENT, mkAgr(A, USDG, 166666667n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) },
    { transaction: tx(AGREEMENT, mkAgr(S, USDG, 333333333n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }], // M-1143 split shares [2,1] amounts swapped [166666667,333333333]
};
const M14T = {
  k3652: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-1302 milestones stepHours=12, expiry omitted (M-293 gen 16)
  k3653: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-1303 milestones stepHours=120, expiry omitted (M-293 gen 17)
  k3654: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-1304 milestones stepHours=49, expiry omitted (M-293 gen 18, step2 partial-send)
  k3655: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-1305 panel [A]/k=1 (B-23 re-grade)
  k3656: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A, S]), value: 2n }])) }], // M-1306 two_of_three [A,S]/k=2 (B-23 re-grade)
  k3657: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-1307 cooling kind-9 3600 windowHours=720 (B-23 re-grade)
  k3658: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }])) }], // M-1308 token_price_trigger price=500 (B-15 re-grade)
  k3659: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }])) }], // M-1309 token_price_trigger price=999 (B-15 re-grade)
  k3664: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, _att(ARB))) }], // M-1314 arbiter_escrow expiry 168h->24h (shrink)
  k3666: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 24), ms(249999999n, 48)]; }, // M-1316 milestones stepHours=24, expiryHours=24 EXPLICIT
  k3667: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 5, target: V, data: "0x", value: BigInt(c.w + 47 * 3600) }])) }], // M-1317 optimistic windowHours=48, kind-5 now+47h (1h short)
  k3668: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 5, target: V, data: "0x", value: BigInt(c.w + 49 * 3600) }])) }], // M-1318 optimistic windowHours=48, kind-5 now+49h (1h long)
  k3669: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 169 * 3600) }])) }], // M-1319 scheduled afterHours=168, server kind-0 now+169h
  k3670: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 167 * 3600) }])) }], // M-1320 scheduled afterHours=168, server kind-0 now+167h
  k3671: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 7, target: USDG, data: c.balData(A), value: 1000000n }])) }], // M-1321 balance_trigger holder=A min=1 USDG (TRUE on-chain)
  k3672: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 8, target: USDG, data: "0x1234", value: 100n }])) }], // M-1322 price_trigger op gte asked, server kind-8 lte
  k3673: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 8, target: USDG, data: "0x1234", value: 100n }])) }], // M-1323 price_trigger op lte asked, server kind-8 lte (honest match)
  k3674: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([V1, V2, V3]), value: 3n }])) }], // M-1324 panel [V1,V2,V3]/k=3 (voters keyless)
  k3675: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 4, target: ESCROW, data: "0x", value: 0n }])) }], // M-1325 after_deal kind-4 target=live escrow v3, dealId=0
  k3676: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3599n }])) }], // M-1326 cooling kind-9 value=3599 (floor-1), windowHours=24
  k3677: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 7200n }])) }], // M-1327 cooling kind-9 value=7200 (2h) vs windowHours=1
};
// ================= ROUND 35-A (M-1392..M-1421, K-3742..K-3771) =================
// New SDK 2813ca14 (55.015 B): fetch AbortSignal.timeout(30000), #send
// receipt timeout 180s + status check, fund() "nothing to fund" guard,
// bridge.send() aborts later steps on failed receipt. New angles:
// near() tol-900 boundary (+899 sends / +901 refuses), price_trigger gte
// honest (kind-7), panel quorum [A,V1]/k=2 (one attacker voter only),
// panel k=0 caller, two_of_three value=0 (M-1388 cross-template),
// recurring payments=13 (SDK range 2..12), split/milestones step-count
// drop (creates!==n), arbiter_escrow expiryHours=0 (B-46 degenerate),
// deal() amount 0, M-293 gen 19 (stepHours=60).
const R35T = {
  k3742: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-1392 panel [A]/k=1 (B-23 re-grade)
  k3743: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A, S]), value: 2n }])) }], // M-1393 two_of_three [A,S]/k=2 (B-23 re-grade)
  k3744: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-1394 cooling kind-9 3600 windowHours=720 (B-23 re-grade)
  k3745: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }])) }], // M-1395 token_price_trigger price=500 (B-15 re-grade)
  k3751: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-1401 milestones stepHours=60, expiry omitted (M-293 gen 19)
  k3755: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 5, target: V, data: "0x", value: BigInt(c.w + 3600 + 899) }])) }], // M-1405 optimistic windowHours=1, kind-5 now+3600+899 (inside near() tol 900)
  k3756: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 168 * 3600 + 899) }])) }], // M-1406 scheduled afterHours=168, kind-0 now+168h+899 (inside near() tol 900)
  k3757: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 5, target: V, data: "0x", value: BigInt(c.w + 3600 + 901) }])) }], // M-1407 optimistic windowHours=1, kind-5 now+3600+901 (just outside near() tol 900)
  k3758: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 7, target: USDG, data: "0x1234", value: 100n }])) }], // M-1408 price_trigger op=gte, server kind-7 gte HONEST match
  k3759: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A, V1]), value: 2n }])) }], // M-1409 panel [A,V1]/k=2 (only one attacker-controlled voter)
  k3760: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 0n }])) }], // M-1410 panel k=0 caller, server quorum [A]/value=0
  k3761: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 0n }])) }], // M-1411 two_of_three quorum [A]/value=0 (M-1388 cross-template)
  k3763: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ZERO, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-1413 cooling caller arbiter ARB, server kind-1 target=ZERO (attester swap)
  k3765: (c) => { const rec = (i) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + i * 24 * 3600) }])) }); const steps = [c.approve(USDG, 6500n * 10n ** 6n)]; for (let i = 1; i <= 13; i++) steps.push(rec(i)); return steps; }, // M-1415 recurring x13, everyHours=24 (over documented max 12)
  k3766: (c) => [c.approve(USDG, c.amt500),
    { transaction: tx(AGREEMENT, mkAgr(A, USDG, 166666668n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) },
    { transaction: tx(AGREEMENT, mkAgr(S, USDG, 166666666n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }], // M-1416 split 3 payees, server returns only 2 steps (drops V1)
  k3767: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(166666668n, 168), ms(166666667n, 336)]; }, // M-1417 milestones x3, server returns only 2 steps (drops step 3)
  k3768: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, _att(ARB))) }], // M-1418 arbiter_escrow expiryHours=0 asked, server now+24h (B-46 degenerate)
  k3770: (c) => [c.approve(USDG, 0n), { transaction: tx(AGREEMENT, mkAgr(A, USDG, 0n, c.expiry(72), c.th, _att(ARB))) }], // M-1420 deal() amount 0
};
// ================= MINOR 15-A (M-1482..M-1511, K-3832..K-3861) =================
// SDK/MCP UNCHANGED vs Major 35 (2813ca14 / d835e4ed, diff 0) — no new
// hardening to probe; new angles are boundary + cross-template variants:
// near() tol-900 EXACT (+900), panel k=3 all-attacker, split remainder,
// recurring min payments=2/everyHours=1, M-293 gen 22 (stepHours=96),
// B-43 front-load + B-45 agree-feeWei folds (special blocks k3840/k3839).
const M15T = {
  k3840: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(500000000n, 72), ms(250000001n, 72)]; }, // M-1490 milestones x2 front-load: step1 = full total 500, step2 pushes sum over total (B-43 fold; special block probes id 1) — NOTE: approve MUST be exactly the total: the SDK refuses an approve larger than the first step needs ("approval of 750000001, more than the 500000000 this step needs"), so the front-load only reaches step 1 with approve == total
  k3843: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-1493 milestones stepHours=96, expiry omitted, server expiry 72h/step (M-293 gen 22)
  k3849: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 5, target: V, data: "0x", value: BigInt(c.w + 3600 + 900) }])) }], // M-1499 optimistic windowHours=1, kind-5 now+3600+900 EXACTLY at near() tol 900
  k3850: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 168 * 3600 + 900) }])) }], // M-1500 scheduled afterHours=168, kind-0 now+168h+900 EXACTLY at near() tol 900
  k3851: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A, V1, V2]), value: 3n }])) }], // M-1501 panel [A,V1,V2]/k=3, only attacker votes
  k3856: (c) => [c.approve(USDG, c.amt500),
    { transaction: tx(AGREEMENT, mkAgr(A, USDG, 166666668n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) },
    { transaction: tx(AGREEMENT, mkAgr(S, USDG, 166666666n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) },
    { transaction: tx(AGREEMENT, mkAgr(V1, USDG, 166666666n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }], // M-1506 split [A,S,V1] shares [1,1,1] of 500, remainder 2 micro to first payee (sum exact)
  k3857: (c) => { const rec = (i) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + i * 3600) }])) }); return [c.approve(USDG, 1000n * 10n ** 6n), rec(1), rec(2)]; }, // M-1507 recurring x2, everyHours=1 (minimum payments + minimum interval)
};
// ================= ROUND 36-A (M-1572..M-1601, K-3922..K-3951) =================
// SDK/MCP UNCHANGED vs Minor 15 (2813ca14 / d835e4ed, diff 0) — no new
// hardening to probe; new angles are near-miss-family re-probes from a
// fresh direction (two_of_three value=0 family: panel value=0, two-voter
// value=0, empty quorum), expiry 12->13h below the B-46 floor, price_trigger
// lte data-swap, near() early-side (-900s), agree() extra condition,
// fund() cross-deal step, M-293 gen 25 (stepHours=48).
const R36T = {
  k3923: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-1573 panel [A]/k=1 (B-23 re-grade, =k2549)
  k3924: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-1574 two_of_three [A]/k=1 (B-23 re-grade, =k2568)
  k3925: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-1575 cooling kind-9 3600 (B-23 re-grade, =k2550)
  k3926: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }])) }], // M-1576 token_price_trigger (B-15 re-grade, =k2370)
  k3927: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, _att(ARB))) }], // M-1577 arbiter_escrow expiryHours=1, server now+24h (B-46 re-grade, =k2194)
  k3929: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(500000000n, 72), ms(250000001n, 72)]; }, // M-1579 milestones front-load step1=full 500 (B-43 fold, =k3840)
  k3930: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-1580 milestones stepHours=48, expiry omitted, server expiry 72h/step (M-293 gen 25)
  k3931: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 0n }])) }], // M-1581 panel [A]/value=0 (near-miss family, panel side of M-1502)
  k3932: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A, V]), value: 0n }])) }], // M-1582 two_of_three [A,V]/value=0 (two voters, k=0)
  k3933: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([]), value: 1n }])) }], // M-1583 panel quorum EMPTY list, value=1
  k3934: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(13), c.th, _att(ARB))) }], // M-1584 arbiter_escrow expiryHours=12 asked, server now+13h (below B-46 floor 24h)
  k3935: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 8, target: USDG, data: "0x5678", value: 100n }])) }], // M-1585 price_trigger lte, server kind-8 data SWAPPED 0x1234->0x5678
  k3936: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 8, target: USDG, data: "0x1234", value: 100n }])) }], // M-1586 price_trigger gte, server kind-8 gte HONEST (forge companion)
  k3938: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A, V]), value: 2n }])) }], // M-1588 panel [A,V]/k=2 (attacker + victim voter)
  k3939: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 5, target: V, data: "0x", value: BigInt(c.w + 24 * 3600 + 901) }])) }], // M-1589 optimistic windowHours=24, kind-5 now+24h+901 (just outside near() tol)
  k3940: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 3600 - 900) }])) }], // M-1590 scheduled afterHours=1, kind-0 now+1h-900 (EARLY side of near() tol)
  k3943: (c) => [c.approve(USDG, c.amt500),
    { transaction: tx(AGREEMENT, mkAgr(A, USDG, 333333334n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) },
    { transaction: tx(AGREEMENT, mkAgr(S, USDG, 166666666n, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }], // M-1593 split [A,S] shares [2,1] of 500 (exact micro)
  k3944: (c) => { const rec = (i) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + i * 24 * 3600) }])) }); const steps = [c.approve(USDG, 6000n * 10n ** 6n)]; for (let i = 1; i <= 12; i++) steps.push(rec(i)); return steps; }, // M-1594 recurring x12 (max), everyHours=24
  xc3: (c) => [c.approve(USDG, 500100n * 10n ** 6n), { transaction: tx(AGREEMENT, mkAgr(A, USDG, 500100n * 10n ** 6n, c.expiry(72), c.th, _att(ARB))) }], // XC-3 settleCrossChain deal steps (honest arbiter_escrow, amount 500100)
  xc4: (c) => [c.approve(USDG, 500100n * 10n ** 6n), { transaction: tx(AGREEMENT, mkAgr(A, USDG, 500100n * 10n ** 6n, c.expiry(72), c.th, _att(ARB))) }], // XC-4 settleCrossChain deal steps (same honest steps; the quote is malicious)
};
const R37T = {
  k4103: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-1753 panel [A]/k=1 (B-23 re-grade, =k3923)
  k4104: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-1754 two_of_three [A]/k=1 (B-23 re-grade, =k3924)
  k4105: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-1755 cooling kind-9 3600 (B-23 re-grade, =k3925)
  k4106: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }])) }], // M-1756 token_price_trigger (B-15 re-grade, =k3926)
  k4108: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, _att(ARB))) }], // M-1758 arbiter_escrow expiryHours=1, server now+24h (B-46 re-grade, =k3927)
  k4110: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-1760 milestones stepHours=54, expiry omitted, server expiry 72h/step (M-293 gen 26)
};
// ================= MINOR 17-A (M-1842..M-1871, K-4192..K-4221) =================
const M17T = {
  k4196: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-1846 milestones stepHours=60, expiry omitted, server expiry 72h/step (M-293 gen 27)
  k4198: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-1848 panel [A]/k=1 (B-23 re-grade, =k4103)
  k4199: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-1849 two_of_three [A]/k=1 (B-23 re-grade, =k4104)
  k4200: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-1850 cooling kind-9 3600 (B-23 re-grade, =k4105)
  k4201: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }])) }], // M-1851 token_price_trigger (B-15 re-grade, =k4106)
  k4204: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, _att(ARB))) }], // M-1854 arbiter_escrow expiryHours=1, server now+24h (B-46 re-grade, =k4108)
  k4220: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, _att(ARB))) }], // M-1870 arbiter_escrow honest steps (preflight test: wallet ETH set ~0 before deal())
};
// ================= ROUND 39-A (M-1932..M-1961, K-4282..K-4311) =================
// SDK/MCP UNCHANGED vs Minor 17 (b6e7d25c / 27621d4c, all hashes identical) —
// no redeploy #6. New angles: FE-OR1 quote() path (k4283/k4284), M-293 gen 28
// (k4285), bridge.quote() gate probes (k4296-k4303), settleCrossChain
// validation (k4304-k4307, k4311 dryRun), stream fee-expiry/duration (k4308/
// k4309), settle() policy (k4310). Re-grades: B-23 x3, B-15 x2, B-42 (forge),
// B-45, B-46, B-48.
const R38T = {
  k4285: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-1935 milestones stepHours=60, expiryHours=500 EXPLICIT, server expiry 72h/step (M-293 gen 28)
  k4288: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-1939 panel [A]/k=1 (B-23 re-grade, =k4198)
  k4289: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-1940 two_of_three [A]/k=1 (B-23 re-grade, =k4199)
  k4290: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-1941 cooling kind-9 3600 (B-23 re-grade, =k4200)
  k4291: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }])) }], // M-1942 token_price_trigger (B-15 re-grade, =k4201)
  k4294: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, _att(ARB))) }], // M-1944 arbiter_escrow expiryHours=1, server now+24h (B-46 re-grade, =k4204)
};
const M12A = {
  k3305: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 1, target: ARB, data: "0x", value: 0n }])) }], // M-955 agree() duplicate attest by same arbiter twice
};
const R33A = {
  k3403: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(1), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }])) }], // M-1053 agree() attest ARB, expiryHours=1 (honest short)
  k3404: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 1, target: A, data: "0x", value: 0n }])) }], // M-1054 agree() 2nd attester swapped V1->A
  k3405: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-1055 agree() veto kind-9 value shrunk 24h->1h
};
const M13A = {
  k3494: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-1144 agree() veto afterHours=1, kind-9 value=3600 exact
  k3495: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 1, target: V1, data: "0x", value: 0n }, { kind: 1, target: V2, data: "0x", value: 0n }])) }], // M-1145 agree() 3 attest conditions honest
  k3496: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(168), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }])) }], // M-1146 agree() attest ARB, expiryHours=168
};
const M14A = {
  k3665: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(25), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }])) }], // M-1315 agree() attest ARB, expiryHours=24 asked, server expiry now+25h (B-46 stretch test on agree)
  k3678: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 7200n }])) }], // M-1328 agree() veto kind-9 value=7200 afterHours=24 (shrink 24h->2h)
  k3679: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: ARB, data: _enc(0), value: 3600n }])) }], // M-1329 agree() attest ARB + veto by ARB afterHours=1
};
const R35A = {
  k3762: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: ZERO, data: _enc(0), value: 86400n }])) }], // M-1412 agree() attest ARB + veto by V afterHours=24, server kind-9 target=ZERO (veto target swap)
};
// ================= MINOR 15-A agree() steps =================
const M15A = {
  k3839: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgrFee(A, USDG, c.amt500, c.expiry(72), c.th, _att(ARB), parseEther("0.05")), "50000000000000000") }], // M-1489 agree() feeWei=0.05 ETH + value 0.05 ETH (B-45 fold; special block measures treasury)
  k3854: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ZERO, data: "0x", value: 0n }])) }], // M-1504 agree() attest by ARB, server kind-1 target=ZERO (attester swap)
};
// ================= ROUND 36-A agree() steps =================
const R36A = {
  k3928: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgrFee(A, USDG, c.amt500, c.expiry(72), c.th, _att(ARB), parseEther("0.05")), "50000000000000000") }], // M-1578 agree() feeWei=0.05 ETH (B-45 fold, =k3839)
  k3941: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: A, data: _enc(0), value: 86400n }])) }], // M-1591 agree() attest ARB + veto by V, server kind-9 target=A (veto target swap to attacker)
  k3942: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 1, target: A, data: "0x", value: 0n }])) }], // M-1592 agree() attest ARB, server returns EXTRA 2nd condition attest by A
};
const R37A = {
  k4109: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgrFee(A, USDG, c.amt500, c.expiry(72), c.th, _att(ARB), parseEther("0.05")), "50000000000000000") }], // M-1759 agree() feeWei=0.05 ETH (B-45 fold, =k3928)
};
const M17A = {
  k4203: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgrFee(A, USDG, c.amt500, c.expiry(72), c.th, _att(ARB), parseEther("0.05")), "50000000000000000") }], // M-1853 agree() feeWei=0.05 ETH (B-45 re-grade, =k4109)
};
// ================= ROUND 39-A (M-2022..M-2051, K-4372..K-4401) =================
// M-293 gen 29 (k4376): milestones stepHours=60, expiryHours=72 EXPLICIT,
// server expiry 72h/step (gen 28 proved explicit expiryHours becomes the
// SDK schedule expectation; 72 should MATCH the server this time).
// k4399 control: stepHours=72, expiryHours OMITTED (server default 72).
const M18T = {
  k4376: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-2026 milestones stepHours=60, expiryHours=72 EXPLICIT, server 72h/step (M-293 gen 29)
  k4399: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-2049 milestones stepHours=72, expiryHours OMITTED, server 72h/step (control)
  k4379: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-2029 panel [A]/k=1 (B-23 re-grade, =k4288)
  k4380: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-2030 two_of_three [A]/k=1 (B-23 re-grade, =k4289)
  k4381: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-2031 cooling kind-9 3600 (B-23 re-grade, =k4290)
  k4382: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }])) }], // M-2032 token_price_trigger (B-15 re-grade, =k4291)
  k4385: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, _att(ARB))) }], // M-2035 arbiter_escrow expiryHours=1, server now+24h (B-46 re-grade, =k4294)
};
// ================= ROUND 39-A (M-2112..M-2141, K-4462..K-4491) =================
const R39T = {
  k4462: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-2112 panel [A]/k=1 (B-23 re-grade, =k4379)
  k4463: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-2113 two_of_three [A]/k=1 (B-23 re-grade, =k4380)
  k4464: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-2114 cooling kind-9 3600 (B-23 re-grade, =k4381)
  k4465: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }])) }], // M-2115 token_price_trigger (B-15 re-grade, =k4382)
  k4469: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, _att(ARB))) }], // M-2119 arbiter_escrow expiryHours=1, server now+24h (B-46 re-grade, =k4385)
  k4471: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-2121 M-293 gen 30a: stepHours=36, expiryHours=72 EXPLICIT, server 72h/step — schedule matches flat 72
  k4472: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-2122 M-293 gen 30b: stepHours=60, expiryHours=120, server 72h/step — step 1 wants 120h
  k4486: (c) => { const sh = (payee, amt) => ({ transaction: tx(AGREEMENT, mkAgr(payee, USDG, amt, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }); return [c.approve(USDG, 10000000n), sh(A, 3333334n), sh(S, 3333333n), sh(ARB, 3333333n)]; }, // M-2136 split_payment 10 USDG / [1,1,1] — first payee gets the 1-micro rounding rest
  k4487: (c) => { const rec = (h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, 100000000n, c.expiry(96), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + h * 3600) }])) }); return [c.approve(USDG, 300000000n), rec(24), rec(48), rec(72)]; }, // M-2137 recurring_payment 3x100 everyHours=24
  k4488: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w) }])) }], // M-2138 scheduled_payment afterHours=0 — unlocks now
  k4489: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, _att(ARB))) }], // M-2139 #preflight honest arbiter_escrow (balance cut to 1e12 wei by the runner)
};
// ================= MINOR 19-A (M-2202..M-2231, K-4552..K-4581) =================
const M19T = {
  k4552: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-2202 panel [A]/k=1 (B-23 re-grade, =k4462)
  k4553: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 6, target: ZERO, data: _q([A]), value: 1n }])) }], // M-2203 two_of_three [A]/k=1 (B-23 re-grade, =k4463)
  k4554: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 3600n }])) }], // M-2204 cooling kind-9 3600 (B-23 re-grade, =k4464)
  k4555: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: A, data: "0x", value: 0n }])) }], // M-2205 token_price_trigger (B-15 re-grade, =k4465)
  k4559: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(24), c.th, _att(ARB))) }], // M-2209 arbiter_escrow expiryHours=1, server now+24h (B-46 re-grade, =k4469)
  k4561: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-2211 M-293 gen 31a: stepHours=48, expiryHours=72 EXPLICIT, server 72h/step — step 2 wants max(72,96)=96
  k4562: (c) => { const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, c.expiry(h), c.th, _att(ARB))) }); return [c.approve(USDG, c.amt500), ms(250000001n, 72), ms(249999999n, 72)]; }, // M-2212 M-293 gen 31b: stepHours=60, expiryHours=168 EXPLICIT, server 72h/step — step 1 wants 168
  k4568: (c) => { const rec = (h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w + h * 3600) }])) }); return [c.approve(USDG, 1000n * 10n ** 6n), rec(0), rec(0)]; }, // M-2218 recurring x2 everyHours=0 — server kind-0 now/now (both unlock immediately)
  k4570: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(c.w - 3600) }])) }], // M-2220 scheduled afterHours=-1 — server kind-0 now-1h
};

// ROUND 40-A2 builders.
const R40T = {
  k4665: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 5, target: V, data: "0x", value: BigInt(c.w + 24 * 3600) }])) }], // M-2315 optimistic windowHours=0 — server kind-5 now+24h (0 treated as 24h default)
  k4659: (c) => [c.approve(USDG, 100n * 10n ** 6n), { transaction: tx(AGREEMENT, mkAgr(S, USDG, 100n * 10n ** 6n, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }])) }], // M-2309 arbiter_escrow payee S amount 100, termsHash = caller terms (settle tag), kind-1 ARB
};

// ROUND 39-A agree() builders.
const M18A = {
  k4384: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgrFee(A, USDG, c.amt500, c.expiry(72), c.th, _att(ARB), parseEther("0.05")), "50000000000000000") }], // M-2034 agree() feeWei=0.05 ETH (B-45 re-grade, =k4293)
  k4400: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ZERO, data: "0x", value: 0n }])) }], // M-2050 agree() attest by ZERO (gate probe, =k3211 builder)
};
// ROUND 39-A agree() builders.
const R39A = {
  k4468: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgrFee(A, USDG, c.amt500, c.expiry(72), c.th, _att(ARB), parseEther("0.05")), "50000000000000000") }], // M-2118 agree() feeWei=0.05 ETH (B-45 re-grade, =k4384)
};
// MINOR 19-A agree() builders.
const M19A = {
  k4558: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgrFee(A, USDG, c.amt500, c.expiry(72), c.th, _att(ARB), parseEther("0.05")), "50000000000000000") }], // M-2208 agree() feeWei=0.05 ETH (B-45 re-grade, =k4468)
  k4569: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(-1), c.th, _att(ARB))) }], // M-2219 agree() expiryHours=-1 (past expiry, server echoes it)
};

// ROUND 39-A agree() builders.
const R38A = {
  k4293: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgrFee(A, USDG, c.amt500, c.expiry(72), c.th, _att(ARB), parseEther("0.05")), "50000000000000000") }], // M-1943 agree() feeWei=0.05 ETH (B-45 re-grade, =k4203)
};
// Mock-server step builders for the /api/v1/agreements surface (agree()).
const R32A = {
  k3210: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ARB, data: "0x", value: 0n }, { kind: 9, target: V, data: _enc(0), value: 86400n }])) }], // M-860 veto-first (expect SDK encode throw)
  k3211: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, [{ kind: 1, target: ZERO, data: "0x", value: 0n }])) }], // M-861 attest by ZERO
  k3212: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, _att(ARB))) }], // M-862 (agree() honest steps; the deal() arbiter-omitted case is separate)
  k3231: (c) => [c.approve(USDG, c.amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, c.amt500, c.expiry(72), c.th, _att(ARB))) }], // M-881 agree() honest steps; release() then gets a refund tx
};

const server = http.createServer(async (req, res) => {
  const body = await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
  const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  const p = JSON.parse(body || "{}");
  const w = wall();
  const amt500 = 500n * 10n ** 6n;
  const expiry = (h) => BigInt(w + Math.round(h * 3600));
  const th = termsHashOf(p.terms);
  const mode = current.mode;
  const approve = (token, amt) => ({ transaction: tx(token, approveCall(AGREEMENT, amt)) });
  if (req.url.startsWith("/api/v1/vesting/") && req.method === "GET") {
    // k2862: server returns a claimTransaction that is a createLock call
    // to the pinned locker, beneficiary = attacker (M-505).
    if (mode === "k2862") {
      const amt = parseUnits("1000", 18);
      const lockData = encodeFunctionData({ abi: LOCKER_ABI, functionName: "createLock", args: [LOCKTOKEN, amt, A, BigInt(w), BigInt(w + 30 * 86400), BigInt(w + 365 * 86400), BigInt(30 * 86400)] });
      return send({ claimTransaction: tx(current.lockerAddr || MOCKLOCKER, lockData) });
    }
    // k2723: live vesting is NOT live — mirror the live 503 payload.
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "unavailable", message: "Vesting is not live yet." } }));
    return;
  }
  if (req.url === "/api/v1/settle" && req.method === "POST") {
    // k2763: consent() — server returns typedData with validUntil AFTER the deadline.
    if (p.consentOnly) {
      // k3135 (M-776): caller OMITS deadlineHours; server returns a 59-day
      // deadline/validUntil (inside the 600s..60d range, validUntil==deadline).
      const deadline = mode === "k3135" ? BigInt(w + 59 * 86400) : BigInt(w + 24 * 3600), validUntil = mode === "k3135" ? BigInt(w + 59 * 86400) : mode === "k3227" ? BigInt(w + 24 * 3600) : mode === "k3306" ? BigInt(w + 3600) : BigInt(w + 25 * 3600);
      const sellAmt = parseUnits(String(p.sellAmount), 18);
      const payAmt = parseUnits(String(p.payAmount), 18);
      return send({ typedData: {
        domain: { name: "BullEscrow", version: "3", chainId: 4663, verifyingContract: ESCROW },
        types: { Consent: [{ name: "buyer", type: "address" }, { name: "seller", type: "address" }, { name: "sellerPayout", type: "address" }, { name: "buyerReceive", type: "address" }, { name: "sellToken", type: "address" }, { name: "sellAmount", type: "uint256" }, { name: "payToken", type: "address" }, { name: "payAmount", type: "uint256" }, { name: "deadline", type: "uint64" }, { name: "validUntil", type: "uint64" }] },
        primaryType: "Consent",
        message: { buyer: p.buyer, seller: mode === "k3228" ? A : p.seller, sellerPayout: ZERO, buyerReceive: ZERO, sellToken: p.sellToken, sellAmount: sellAmt.toString(), payToken: ZERO, payAmount: payAmt.toString(), deadline: deadline.toString(), validUntil: validUntil.toString() },
      } });
    }
    // k2740/k2741: open() — build createDeal from the buyer's own params (body).
    // k2759/k2761: server STRETCHES the deadline to now+72h (caller asked 24h).
    // k2760: honest control, deadline now+24h. k2769: sellerPayout swapped to attacker.
    // k2770: feeBps 300. k2761: server supplies a seller consent pre-signed for 72h.
    const sellAmt = parseUnits(String(p.sellAmount), 18);
    const payAmt = parseUnits(String(p.payAmount), 18);
    const dl = (mode === "k2761" || mode === "k2761b" || mode === "k2958") ? BigInt(current.stretchDeadline) : (mode === "k2759" || mode === "k3307" ? BigInt(w + 72 * 3600) : BigInt(p.deadline));
    const feeBps = mode === "k2770" ? 300 : mode === "k3409" ? 0 : 250;
    // k2866: tx carries feeBps 250 but the quote response claims 100 (M-508).
    const responseFeeBps = mode === "k2866" ? 100 : mode === "k3409" ? 250 : mode === "k3497" ? 0 : feeBps;
    // k3408 (M-1058): tx payAmount shrunk 0.25 -> 0.245 ETH vs the signed consent.
    const payAmtTx = mode === "k3408" ? payAmt * 245n / 250n : mode === "k3498" ? payAmt * 260n / 250n : mode === "k3680" ? payAmt * 240n / 250n : payAmt;
    const cd = encodeFunctionData({ abi: ESC_ABI, functionName: "createDeal", args: [
      { seller: p.seller, sellerPayout: mode === "k3224" ? A : ZERO, buyerReceive: mode === "k3225" ? A : ZERO, sellToken: p.sellToken, sellAmount: sellAmt, payToken: ZERO, payAmount: payAmtTx, deadline: dl },
      { feeBps, expiry: BigInt(w + 3600), sig: "0x" + "00".repeat(65) },
      { validUntil: BigInt((mode === "k2761" || mode === "k2761b" || mode === "k2958") ? current.stretchValidUntil : (p.validUntil || (w + 73 * 3600))), sig: (mode === "k2761" || mode === "k2761b" || mode === "k2958") ? STRETCHED_SIG : p.sellerSig },
    ] });
    return send({ transaction: tx(ESCROW, cd), ...(mode === "k3226" ? {} : { feeBps: responseFeeBps }) });
  }
  // k2764: forged receipt — escrow is the DvP escrow (not in cfg.escrows), signature by the ATTACKER (well-formed, wrong signer).
  if (req.url === "/api/v1/receipts/1" && req.method === "GET") {
    const r = { version: "bull-receipt-1", chainId: 4663, escrow: "0xd685d39E7a3deF19E52B9AB09679b7452C23e20b", dealId: "1", buyer: V, seller: ARB, sellToken: USDG, sellAmount: "5200000", payToken: ZERO, payAmount: "2900000000000000", feeBps: 250 };
    if (mode === "k3319") r.dealId = "2"; // M-969: server receipt is for deal 2, caller asked 1
    const message = ["Bull receipt v1", ...Object.entries(r).map(([k, x]) => `${k}:${x}`)].join("\n");
    // k3140 (M-781): message text does NOT match the receipt fields.
    if (mode === "k3140") return send({ receipt: r, message: "Bull receipt v1\nTAMPERED", signature: "0x" + "00".repeat(65) });
    return send({ receipt: r, message, signature: current.receiptSig || ("0x" + "00".repeat(65)) });
  }
  // ROUND 40-A2 k4659: agreements list for #settleRun findAgreement /
  // maxAgreementId (only the already-open agreement 1 exists on chain).
  if (req.url.startsWith("/api/v1/agreements?") && req.method === "GET") {
    if (mode === "k4659") return send({ agreements: [{ id: "1", payer: V, payee: S }] });
    return send({ agreements: [] });
  }
  // k2766: attest action for the WRONG agreement id (2, caller asked 1).
  // k2767: releaseTransaction for the WRONG agreement id (2, caller asked 1).
  // k2860: attest action for the WRONG condition index (1, caller is victim V, not V1) on the caller's own agreement.
  // k2861: refundTransaction for the WRONG agreement id (2, caller asked 1).
  if (/^\/api\/v1\/agreements\/\d+$/.test(req.url) && req.method === "GET") {
    const idNum = Number(req.url.split("/").pop());
    // ROUND 40-A2 k4659: on-chain fields of agreement 1 as #settleRun's
    // getAgreement expects them (termsHash = the settle:<id> tag hash).
    if (mode === "k4659" && idNum === 1) return send({ id: "1", payee: S, payer: V, amount: "100", status: "open", termsHash: current.tagHash, asset: "usdg", symbol: "usdg", assetVerified: true, contract: AGREEMENT, conditions: [{ type: "attest", met: false }] });
    if (mode === "k2766") return send({ conditions: [{ type: "attest", met: false, actions: [{ from: V, name: "attest", to: AGREEMENT, data: encodeFunctionData({ abi: AGR_ABI, functionName: "attest", args: [2n, 0n] }), value: "0" }] }] });
    if (mode === "k3231") return send({ releaseTransaction: tx(AGREEMENT, encodeFunctionData({ abi: AGR_ABI, functionName: "refund", args: [1n] })) }); // M-881: server swaps release -> refund tx
    if (mode === "k2767") return send({ releaseTransaction: tx(AGREEMENT, encodeFunctionData({ abi: AGR_ABI, functionName: "release", args: [2n] })) });
    if (mode === "k2860") return send({ conditions: [
      { type: "attest", met: false, actions: [{ from: V, name: "attest", to: AGREEMENT, data: encodeFunctionData({ abi: AGR_ABI, functionName: "attest", args: [BigInt(idNum), 1n] }), value: "0" }] },
      { type: "attest", met: false, actions: [{ from: V, name: "attest", to: AGREEMENT, data: encodeFunctionData({ abi: AGR_ABI, functionName: "attest", args: [BigInt(idNum), 1n] }), value: "0" }] },
    ] });
    if (mode === "k2861") return send({ refundTransaction: tx(AGREEMENT, encodeFunctionData({ abi: AGR_ABI, functionName: "refund", args: [2n] })) });
    return send({ conditions: [] });
  }
  if (req.url === "/api/v1/agreements/1" && req.method === "GET") {
    if (mode === "k2766") return send({ conditions: [{ type: "attest", met: false, actions: [{ from: V, name: "attest", to: AGREEMENT, data: encodeFunctionData({ abi: AGR_ABI, functionName: "attest", args: [2n, 0n] }), value: "0" }] }] });
    if (mode === "k2767") return send({ releaseTransaction: tx(AGREEMENT, encodeFunctionData({ abi: AGR_ABI, functionName: "release", args: [2n] })) });
    return send({ conditions: [] });
  }
  // k2765: server claims deal 1 is settled (chain: no such deal / not settled).
  // k2768: fund(0) — server returns a fundPayment step for deal 1 (caller funds deal 0).
  if ((req.url === "/api/v1/settle/1" || req.url === "/api/v1/settle/0") && req.method === "GET") {
    if (mode === "k2765") return send({ dealId: "1", status: "settled" });
    if (mode === "k3318") return send({ dealId: "0", status: "settled" }); // M-968: server claims deal 0 settled (nonexistent)
    if (mode === "k2954") return send({ dealId: "0", status: "cancelled" }); // M-595: server claims cancelled, chain says open
    if (mode === "k2768" || mode === "k2859") return send({ dealId: "0", status: "open", buyerSteps: [{ from: V, transaction: tx(ESCROW, encodeFunctionData({ abi: ESC_ABI, functionName: "fundPayment", args: [1n] })) }], sellerSteps: [] });
    // k3139 (M-780): seller funds first — server returns sellerSteps (approve + fundTokens) for the seller ARB.
    // k3846 (M-1496): same sellerSteps, buyerSteps EMPTY — fund() as buyer V must hit the NEW guard, not fund ARB's steps.
    if (mode === "k3846") return send({ dealId: "0", status: "open", buyerSteps: [], sellerSteps: [
      { from: ARB, transaction: tx(LOCKTOKEN, approveCall(ESCROW, 1000n * 10n ** 18n)) },
      { from: ARB, transaction: tx(ESCROW, encodeFunctionData({ abi: ESC_ABI, functionName: "fundTokens", args: [0n] })) },
    ] });
    // k3947 (M-1597): fund(0) cross-deal step — server returns a buyerStep
    // funding deal 1 (caller funds deal 0). fund() must not execute a step
    // for another deal id.
    if (mode === "k3947") return send({ dealId: "0", status: "open", buyerSteps: [{ from: V, transaction: tx(ESCROW, encodeFunctionData({ abi: ESC_ABI, functionName: "fundPayment", args: [1n] })) }], sellerSteps: [] });
    if (mode === "k3139") return send({ dealId: "0", status: "open", buyerSteps: [], sellerSteps: [
      { from: ARB, transaction: tx(LOCKTOKEN, approveCall(ESCROW, 1000n * 10n ** 18n)) },
      { from: ARB, transaction: tx(ESCROW, encodeFunctionData({ abi: ESC_ABI, functionName: "fundTokens", args: [0n] })) },
    ] });
    return send({ dealId: "0", status: "open", buyerSteps: [], sellerSteps: [] });
  }
  // k2857: bridge quote — approval spender is the ATTACKER, not Relay (M-500, B-42 fold).
  if (req.url === "/api/v1/bridge/quote" && req.method === "POST") {
    const raw = 100n * 10n ** 6n;
    // ROUND 40-A2 k4663: ETH->ETH quote whose single step carries MORE value
    // than the bridged amount (over) vs exactly the amount (exact).
    if (mode === "k4663") {
      const ROUTER = V1;
      const val = current.quoteCase === "over" ? "20000000000000000" : "10000000000000000";
      return send({ id: "0x" + "99".repeat(32), provider: "bull", asset: "eth", from: { chain: "base", chainId: 8453, asset: "ETH", token: ZERO }, to: { chain: "robinhood", chainId: 4663, asset: "ETH", token: ZERO }, amount: "0.01", recipient: p.user || V, expectedOut: "0.01", steps: [
        { name: "bridge", transaction: { ...tx(ROUTER, "0x", val), chainId: 8453, from: V } },
      ] });
    }
    // k3753 (M-1403): NEW SDK bridge.send() receipt-status check — step 1 is a
    // transfer of 1e9 USDG (V holds 500k) that REVERTS on-chain; step 2 is a
    // valid approve to the relay spender. checkBridge passes both steps.
    // k3847 (M-1497): bridge 3 steps — step 1 transfer 100 USDG (V can pay,
    // SUCCEEDS), step 2 transfer 1e9 USDG (V holds 500k, REVERTS), step 3
    // approve to the relay spender (must NOT be sent after the step-2 failure).
    if (mode === "k3847") {
      const transferOk = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [A, 100n * 10n ** 6n] });
      const transferBad = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [A, 1000000000n * 10n ** 6n] });
      const RELAY_SPENDER = "0x7777777777777777777777777777777777777777";
      return send({ id: "0x" + "44".repeat(32), provider: "bull", from: { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG }, to: { chain: "base", chainId: 8453, asset: "usdc", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, amount: "100", recipient: p.user || V, steps: [
        { name: "transfer", transaction: { ...tx(USDG, transferOk, "0"), chainId: 4663, from: V } },
        { name: "transfer", transaction: { ...tx(USDG, transferBad, "0"), chainId: 4663, from: V } },
        { name: "approve", transaction: { ...tx(USDG, approveCall(RELAY_SPENDER, raw), "0"), chainId: 4663, from: V } },
      ] });
    }
    if (mode === "k3753") {
      const transferData = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [A, 1000000000n * 10n ** 6n] });
      const RELAY_SPENDER = "0x7777777777777777777777777777777777777777";
      return send({ id: "0x" + "33".repeat(32), provider: "bull", from: { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG }, to: { chain: "base", chainId: 8453, asset: "usdc", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, amount: "100", recipient: p.user || V, steps: [
        { name: "transfer", transaction: { ...tx(USDG, transferData, "0"), chainId: 4663, from: V } },
        { name: "approve", transaction: { ...tx(USDG, approveCall(RELAY_SPENDER, raw), "0"), chainId: 4663, from: V } },
      ] });
    }
    // xc3 (ROUND 36, settleCrossChain honest path): Base -> Robinhood quote,
    // single honest approve of the bridge amount to the Relay spender.
    if (mode === "xc3") {
      const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const RELAY_SPENDER = "0x7777777777777777777777777777777777777777";
      const amt = BigInt(Math.round(Number(p.amount || "105") * 1e6));
      return send({ id: "0x" + "55".repeat(32), provider: "bull", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG }, amount: String(p.amount || "105"), recipient: p.user || V, steps: [
        { name: "approve", transaction: { ...tx(USDC, approveCall(RELAY_SPENDER, amt), "0"), chainId: 8453, from: V } },
      ] });
    }
    // xc4 (ROUND 36, settleCrossChain malicious quote): approve spender is the
    // ATTACKER, not Relay — same checkBridge hole as B-42 (k2857), now via the
    // new settleCrossChain entry point.
    if (mode === "xc4") {
      const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const amt = BigInt(Math.round(Number(p.amount || "105") * 1e6));
      return send({ id: "0x" + "66".repeat(32), provider: "bull", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG }, amount: String(p.amount || "105"), recipient: p.user || V, steps: [
        { name: "approve", transaction: { ...tx(USDC, approveCall(A, amt), "0"), chainId: 8453, from: V } },
      ] });
    }
    // MINOR 17 k4197 (FE-OR1): same-kind stable quote whose `to` omits the
    // output token entirely (case "out-token-omitted"), names the WRONG token
    // (case "out-token-wrong"), or names USDG honestly (case "out-token-ok").
    // checkBridge only compares q.to.token when the field is PRESENT.
    if (mode === "k4197") {
      const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const ROUTER = V1;
      const qc = current.quoteCase;
      const toField = qc === "out-token-omitted" ? { chain: "robinhood", chainId: 4663, asset: "usdg" }
        : qc === "out-token-wrong" ? { chain: "robinhood", chainId: 4663, asset: "usdg", token: BULLT }
        : { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG };
      const amt = 25n * 10n ** 6n;
      return send({ id: "0x" + "77".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: toField, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: [
        { name: "approve", transaction: { ...tx(USDC, approveCall(ROUTER, amt), "0"), chainId: 8453, from: V } },
        { name: "bridge", transaction: { ...tx(ROUTER, "0x", "0"), chainId: 8453, from: V } },
      ] });
    }
    // MINOR 17 k4205 (B-48 re-grade): spender-bypass quote — approve
    // spender=attacker + a step targeting the attacker (self-vouching).
    // Control: same approve, NO step targets the attacker -> must reject.
    if (mode === "k4205") {
      const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const ROUTER = V1;
      const amt = 25n * 10n ** 6n;
      if (current.quoteCase === "spender-bypass") {
        return send({ id: "0x" + "22".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "USDC", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "USDG", token: USDG }, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: [
          { name: "approve", transaction: { ...tx(USDC, approveCall(A, amt), "0"), chainId: 8453, from: V } },
          { name: "bridge", transaction: { ...tx(A, "0xdeadbeef", "0"), chainId: 8453, from: V } },
        ] });
      }
      return send({ id: "0x" + "33".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "USDC", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "USDG", token: USDG }, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: [
        { name: "approve", transaction: { ...tx(USDC, approveCall(A, amt), "0"), chainId: 8453, from: V } },
        { name: "bridge", transaction: { ...tx(ROUTER, "0x", "0"), chainId: 8453, from: V } },
      ] });
    }
    // ROUND 39 k4295 (B-48 re-grade): same mock as k4205, new mode number.
    if (mode === "k4295") {
      const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const ROUTER = V1;
      const amt = 25n * 10n ** 6n;
      if (current.quoteCase === "spender-bypass") {
        return send({ id: "0x" + "22".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "USDC", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "USDG", token: USDG }, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: [
          { name: "approve", transaction: { ...tx(USDC, approveCall(A, amt), "0"), chainId: 8453, from: V } },
          { name: "bridge", transaction: { ...tx(A, "0xdeadbeef", "0"), chainId: 8453, from: V } },
        ] });
      }
      return send({ id: "0x" + "33".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "USDC", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "USDG", token: USDG }, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: [
        { name: "approve", transaction: { ...tx(USDC, approveCall(A, amt), "0"), chainId: 8453, from: V } },
        { name: "bridge", transaction: { ...tx(ROUTER, "0x", "0"), chainId: 8453, from: V } },
      ] });
    }
    // ROUND 39 k4283 (FE-OR1, jalur quote() — PRIORITAS): same-kind quote
    // executed through bridge.quote() (not send()). Cases:
    //  "fe-no-token-honest" — to.token omitted, honest steps (must RESOLVE
    //    per the hole; re-confirms k4197 via quote()).
    //  "fe-no-token-spender" — to.token omitted AND B-48 spender steps
    //    (approve attacker + call attacker): does quote() vouch a fully
    //    weaponised quote (wrong-token + drain spender)?
    //  "fe-low-out" — to.token USDG honest, but expectedOut "0.01" (0.04%
    //    of input): server path has NO 95% output floor (relayToBull does).
    //  "fe-wrong-token" — control, to.token BULL (must REJECT).
    if (mode === "k4283") {
      const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const ROUTER = V1;
      const qc = current.quoteCase;
      const amt = 25n * 10n ** 6n;
      const honest = [
        { name: "approve", transaction: { ...tx(USDC, approveCall(ROUTER, amt), "0"), chainId: 8453, from: V } },
        { name: "bridge", transaction: { ...tx(ROUTER, "0x", "0"), chainId: 8453, from: V } },
      ];
      const spender = [
        { name: "approve", transaction: { ...tx(USDC, approveCall(A, amt), "0"), chainId: 8453, from: V } },
        { name: "bridge", transaction: { ...tx(A, "0xdeadbeef", "0"), chainId: 8453, from: V } },
      ];
      if (qc === "fe-no-token-spender") return send({ id: "0x" + "88".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "usdg" }, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: spender });
      if (qc === "fe-low-out") return send({ id: "0x" + "99".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG }, amount: "25", recipient: p.user || V, expectedOut: "0.01", steps: honest });
      if (qc === "fe-wrong-token") return send({ id: "0x" + "aa".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "usdg", token: BULLT }, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: honest });
      return send({ id: "0x" + "77".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "usdg" }, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: honest });
    }
    // ROUND 39 k4284 (FE-OR1, jalur quote() MIXED eth->stable): to.token
    // omitted + expectedOut present (must RESOLVE per the hole — the mixed
    // pre-check also only compares to.token when present). Controls:
    //  "mixed-no-out" — expectedOut omitted (must REJECT: states no output
    //    amount); "mixed-low-out" — expectedOut "0.5" vs ~$25 in (must
    //    REJECT via mixedValueCheck 97% rule); "mixed-ok" — to.token USDG.
    // NOTE: mixedValueCheck has only a LOWER bound, so the resolve case
    // uses expectedOut "249" (passes for any ETH price below ~$25k).
    if (mode === "k4284") {
      const qc = current.quoteCase;
      const ROUTER = V1;
      const step = { name: "bridge", transaction: { ...tx(ROUTER, "0x", "10000000000000000"), chainId: 8453, from: V } };
      const base = { id: "0x" + "bb".repeat(32), provider: "bull", asset: "mixed", fromAsset: "eth", toAsset: "stable", from: { chain: "base", chainId: 8453, asset: "eth", token: "0x0000000000000000000000000000000000000000" }, amount: "0.01", recipient: p.user || V, steps: [step] };
      if (qc === "mixed-no-out") return send({ ...base, to: { chain: "robinhood", chainId: 4663, asset: "usdg" } });
      if (qc === "mixed-low-out") return send({ ...base, to: { chain: "robinhood", chainId: 4663, asset: "usdg" }, expectedOut: "0.5" });
      if (qc === "mixed-ok") return send({ ...base, to: { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG }, expectedOut: "249" });
      return send({ ...base, to: { chain: "robinhood", chainId: 4663, asset: "usdg" }, expectedOut: "249" });
    }
    // ROUND 39-A k4490 (M-2140): ETH bridge quote with TWO value-bearing
    // steps (0.005 ETH each, total = the 0.01 ETH asked). checkBridge's ETH
    // branch must refuse: "an ETH bridge must be exactly one transaction".
    if (mode === "k4490") {
      const ROUTER = V1;
      const step = (v) => ({ name: "bridge", transaction: { ...tx(ROUTER, "0x", v), chainId: 8453, from: V } });
      return send({ id: "0x" + "cc".repeat(32), provider: "bull", asset: "mixed", fromAsset: "eth", toAsset: "stable", from: { chain: "base", chainId: 8453, asset: "eth", token: "0x0000000000000000000000000000000000000000" }, to: { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG }, amount: "0.01", recipient: p.user || V, expectedOut: "249", steps: [step("5000000000000000"), step("5000000000000000")] });
    }
    // ROUND 39 k4373 (FE-OR1 send() execution): same quote JSON as k4283
    // (token-less / low-out / spender), served for a Base-chain Bull so
    // bridge.send() can actually execute the steps on Anvil 8453.
    if (mode === "k4373") {
      const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const ROUTER = V1;
      const qc = current.quoteCase;
      const amt = 25n * 10n ** 6n;
      const honest = [
        { name: "approve", transaction: { ...tx(USDC, approveCall(ROUTER, amt), "0"), chainId: 8453, from: V } },
        { name: "bridge", transaction: { ...tx(ROUTER, "0x", "0"), chainId: 8453, from: V } },
      ];
      const spender = [
        { name: "approve", transaction: { ...tx(USDC, approveCall(A, amt), "0"), chainId: 8453, from: V } },
        { name: "bridge", transaction: { ...tx(A, "0xdeadbeef", "0"), chainId: 8453, from: V } },
      ];
      if (qc === "fe-send-spender") return send({ id: "0x" + "88".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "usdg" }, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: spender });
      if (qc === "fe-send-lowout") return send({ id: "0x" + "99".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG }, amount: "25", recipient: p.user || V, expectedOut: "0.01", steps: honest });
      return send({ id: "0x" + "77".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "usdg" }, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: honest });
    }
    // ROUND 39 k4386 (B-48 re-grade): same mock as k4295, new mode number.
    if (mode === "k4386" || mode === "k4470" || mode === "k4560") { // MINOR 19-A: k4560 = B-48 re-grade, same mock as k4386/k4470
      const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const ROUTER = V1;
      const amt = 25n * 10n ** 6n;
      if (current.quoteCase === "spender-bypass") {
        return send({ id: "0x" + "22".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "USDC", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "USDG", token: USDG }, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: [
          { name: "approve", transaction: { ...tx(USDC, approveCall(A, amt), "0"), chainId: 8453, from: V } },
          { name: "bridge", transaction: { ...tx(A, "0xdeadbeef", "0"), chainId: 8453, from: V } },
        ] });
      }
      return send({ id: "0x" + "33".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "USDC", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "USDG", token: USDG }, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: [
        { name: "approve", transaction: { ...tx(USDC, approveCall(A, amt), "0"), chainId: 8453, from: V } },
        { name: "bridge", transaction: { ...tx(ROUTER, "0x", "0"), chainId: 8453, from: V } },
      ] });
    }
    // ROUND 39 k4397 (FE-OR1 over-promise, MIXED): expectedOut "300" for
    // 0.01 ETH (~$17 in) — mixedValueCheck has only a LOWER bound, so an
    // impossible gain must RESOLVE if no upper bound exists.
    if (mode === "k4397") {
      const ROUTER = V1;
      const step = { name: "bridge", transaction: { ...tx(ROUTER, "0x", "10000000000000000"), chainId: 8453, from: V } };
      return send({ id: "0x" + "cc".repeat(32), provider: "bull", asset: "mixed", fromAsset: "eth", toAsset: "stable", from: { chain: "base", chainId: 8453, asset: "eth", token: "0x0000000000000000000000000000000000000000" }, to: { chain: "robinhood", chainId: 4663, asset: "usdg" }, amount: "0.01", recipient: p.user || V, expectedOut: "300", steps: [step] });
    }
    // ROUND 39 k4398 (FE-OR1 over-promise, SAME-KIND): expectedOut "30"
    // for 25 in — checkBridge/relayToBull have a 95% FLOOR only, no ceiling.
    if (mode === "k4398") {
      const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const ROUTER = V1;
      const amt = 25n * 10n ** 6n;
      return send({ id: "0x" + "dd".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG }, amount: "25", recipient: p.user || V, expectedOut: "30", steps: [
        { name: "approve", transaction: { ...tx(USDC, approveCall(ROUTER, amt), "0"), chainId: 8453, from: V } },
        { name: "bridge", transaction: { ...tx(ROUTER, "0x", "0"), chainId: 8453, from: V } },
      ] });
    }
    // ROUND 39 bridge.quote() gate probes (each must REJECT — KILL if so).
    if (mode === "k4296") { // recipient = attacker, honest steps
      const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const ROUTER = V1;
      const amt = 25n * 10n ** 6n;
      return send({ id: "0x" + "cc".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG }, amount: "25", recipient: A, expectedOut: "24.9", steps: [
        { name: "approve", transaction: { ...tx(USDC, approveCall(ROUTER, amt), "0"), chainId: 8453, from: V } },
        { name: "bridge", transaction: { ...tx(ROUTER, "0x", "0"), chainId: 8453, from: V } },
      ] });
    }
    if (mode === "k4297") { // stable step carries native value
      const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const ROUTER = V1;
      const amt = 25n * 10n ** 6n;
      return send({ id: "0x" + "dd".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG }, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: [
        { name: "approve", transaction: { ...tx(USDC, approveCall(ROUTER, amt), "0"), chainId: 8453, from: V } },
        { name: "bridge", transaction: { ...tx(ROUTER, "0x", "1000000"), chainId: 8453, from: V } },
      ] });
    }
    if (mode === "k4300") { // ETH route, TWO value steps (must be exactly one)
      const ROUTER = V1;
      return send({ id: "0x" + "ee".repeat(32), provider: "bull", asset: "eth", from: { chain: "base", chainId: 8453, asset: "eth", token: "0x0000000000000000000000000000000000000000" }, to: { chain: "robinhood", chainId: 4663, asset: "eth", token: "0x0000000000000000000000000000000000000000" }, amount: "0.01", recipient: p.user || V, expectedOut: "0.01", steps: [
        { name: "bridge", transaction: { ...tx(ROUTER, "0x", "5000000000000000"), chainId: 8453, from: V } },
        { name: "bridge", transaction: { ...tx(ROUTER, "0x", "5000000000000000"), chainId: 8453, from: V } },
      ] });
    }
    if (mode === "k4301") { // stable route, FIVE steps (>4 max)
      const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const ROUTER = V1;
      const amt = 25n * 10n ** 6n;
      const bridge = { name: "bridge", transaction: { ...tx(ROUTER, "0x", "0"), chainId: 8453, from: V } };
      return send({ id: "0x" + "ff".repeat(32), provider: "bull", asset: "usdc_usdg", from: { chain: "base", chainId: 8453, asset: "usdc", token: USDC }, to: { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG }, amount: "25", recipient: p.user || V, expectedOut: "24.9", steps: [
        { name: "approve", transaction: { ...tx(USDC, approveCall(ROUTER, amt), "0"), chainId: 8453, from: V } },
        bridge, bridge, bridge, bridge,
      ] });
    }
    return send({ id: "0x" + "11".repeat(32), provider: "bull", from: { chain: "robinhood", chainId: 4663, asset: "usdg", token: USDG }, to: { chain: "base", chainId: 8453, asset: "usdc", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, amount: "100", recipient: p.user || V, steps: [
      { name: "approve", transaction: { ...tx(USDG, approveCall(A, raw), "0"), chainId: 4663, from: V } },
    ] });
  }
  // xc3/xc4 (ROUND 36, settleCrossChain): bridge.wait polls this; the mock
  // bridge is "confirmed" immediately (no real cross-chain delivery).
  if (req.url.startsWith("/api/v1/bridge/status") && req.method === "GET") {
    if (mode === "xc3" || mode === "xc4") {
      const id = new URL(req.url, "http://127.0.0.1").searchParams.get("id");
      return send({ id, status: "confirmed", done: true });
    }
    res.writeHead(404); res.end("{}"); return;
  }
  if (req.url === "/api/v1/vesting" && req.method === "POST") {
    const amt = parseUnits(String(p.amount), 18);
    // k2757: server redirects the steps to TRAPLOCKER although the caller pinned MOCKLOCKER.
    const locker = mode === "k2757" ? SERVER_LOCKER : current.lockerAddr;
    const appr = { transaction: tx(p.token, approveCall(locker, amt)) };
    if (mode === "k2757") { // trap call to the server-chosen locker (not the pinned one)
      const trapData = encodeFunctionData({ abi: TRAP_ABI, functionName: "trap", args: [p.token, amt, p.beneficiary, A] });
      return send({ steps: [appr, { transaction: tx(locker, trapData) }] });
    }
    if (mode === "k2742") { // trap(token, amount, beneficiary, attacker) — calldata contains token+beneficiary hex
      const trapData = encodeFunctionData({ abi: TRAP_ABI, functionName: "trap", args: [p.token, amt, p.beneficiary, A] });
      return send({ steps: [appr, { transaction: tx(locker, trapData) }] });
    }
    if (mode === "k3320") { // M-970 lock() server swaps beneficiary -> ZERO (burn)
      const lockData = encodeFunctionData({ abi: LOCKER_ABI, functionName: "createLock", args: [p.token, amt, ZERO, BigInt(w), BigInt(w + 30 * 86400), BigInt(w + 365 * 86400), BigInt(30 * 86400)] });
      return send({ steps: [appr, { transaction: tx(locker, lockData) }] });
    }
    if (mode === "k3410") { // M-1060 lock() start 365d in the PAST; cliff/end/step relative (B-26 family)
      const lockData = encodeFunctionData({ abi: LOCKER_ABI, functionName: "createLock", args: [p.token, amt, p.beneficiary, BigInt(w - 365 * 86400), BigInt(w - 365 * 86400 + 30 * 86400), BigInt(w - 365 * 86400 + 365 * 86400), BigInt(30 * 86400)] });
      return send({ steps: [appr, { transaction: tx(locker, lockData) }] });
    }
    if (mode === "k3499") { // M-1149 lock() cliffDays=0: cliff == start (immediately claimable schedule, caller asked)
      const lockData = encodeFunctionData({ abi: LOCKER_ABI, functionName: "createLock", args: [p.token, amt, p.beneficiary, BigInt(w), BigInt(w), BigInt(w + 365 * 86400), BigInt(30 * 86400)] });
      return send({ steps: [appr, { transaction: tx(locker, lockData) }] });
    }
    if (mode === "k2743" || mode === "k2762" || mode === "k2951" || mode === "k2952" || mode === "k2953" || mode === "k3229" || mode === "k3500") { // honest createLock, cliff 30d / duration 365d / step 30d
      const lockData = encodeFunctionData({ abi: LOCKER_ABI, functionName: "createLock", args: [p.token, amt, p.beneficiary, BigInt(w), BigInt(w + 30 * 86400), BigInt(w + 365 * 86400), BigInt(30 * 86400)] });
      return send({ steps: [appr, { transaction: tx(locker, lockData) }] });
    }
    if (mode === "k2751") { // locker call WITHOUT token/beneficiary hex: claim(1)
      const claimData = encodeFunctionData({ abi: LOCKER_ABI, functionName: "claim", args: [1n] });
      return send({ steps: [appr, { transaction: tx(locker, claimData) }] });
    }
    if (mode === "k3230") { // M-880 lock() start +365d although caller omitted startAt (B-26 fold: relative schedule still passes post-check)
      const lockData = encodeFunctionData({ abi: LOCKER_ABI, functionName: "createLock", args: [p.token, amt, p.beneficiary, BigInt(w + 365 * 86400), BigInt(w + 365 * 86400 + 30 * 86400), BigInt(w + 365 * 86400 + 365 * 86400), BigInt(30 * 86400)] });
      return send({ steps: [appr, { transaction: tx(locker, lockData) }] });
    }
    if (mode === "k2867") { // start +365d although caller omitted startAt (M-509): cliff/end/step relative, so they still match
      const lockData = encodeFunctionData({ abi: LOCKER_ABI, functionName: "createLock", args: [p.token, amt, p.beneficiary, BigInt(w + 365 * 86400), BigInt(w + 365 * 86400 + 30 * 86400), BigInt(w + 365 * 86400 + 365 * 86400), BigInt(30 * 86400)] });
      return send({ steps: [appr, { transaction: tx(locker, lockData) }] });
    }
    if (mode === "k3128") { // M-769: cliff 400d AFTER end 365d (caller asked exactly that); honest lock, post-check per-field passes
      const lockData = encodeFunctionData({ abi: LOCKER_ABI, functionName: "createLock", args: [p.token, amt, p.beneficiary, BigInt(w), BigInt(w + 400 * 86400), BigInt(w + 365 * 86400), BigInt(30 * 86400)] });
      return send({ steps: [appr, { transaction: tx(locker, lockData) }] });
    }
    if (mode === "k3859") { // M-1509 lock() stepDays=365 == durationDays=365: step == duration (caller asked); honest lock, post-check per-field passes
      const lockData = encodeFunctionData({ abi: LOCKER_ABI, functionName: "createLock", args: [p.token, amt, p.beneficiary, BigInt(w), BigInt(w + 30 * 86400), BigInt(w + 365 * 86400), BigInt(365 * 86400)] });
      return send({ steps: [appr, { transaction: tx(locker, lockData) }] });
    }
    if (mode === "k3764") { // M-1414 lock() stepDays=0: step == 0 (caller asked); honest lock, post-check per-field passes
      const lockData = encodeFunctionData({ abi: LOCKER_ABI, functionName: "createLock", args: [p.token, amt, p.beneficiary, BigInt(w), BigInt(w + 30 * 86400), BigInt(w + 365 * 86400), BigInt(0)] });
      return send({ steps: [appr, { transaction: tx(locker, lockData) }] });
    }
    if (mode === "k3946") { // M-1596 lock() cliffDays=0, durationDays=30, stepDays=30: cliff == start (caller asked); honest lock, post-check per-field passes
      const lockData = encodeFunctionData({ abi: LOCKER_ABI, functionName: "createLock", args: [p.token, amt, p.beneficiary, BigInt(w), BigInt(w), BigInt(w + 30 * 86400), BigInt(30 * 86400)] });
      return send({ steps: [appr, { transaction: tx(locker, lockData) }] });
    }
    if (mode === "k3681") { // M-1331 lock() stepDays=400 > durationDays=365 (caller asked); honest lock, post-check per-field passes
      const lockData = encodeFunctionData({ abi: LOCKER_ABI, functionName: "createLock", args: [p.token, amt, p.beneficiary, BigInt(w), BigInt(w + 30 * 86400), BigInt(w + 365 * 86400), BigInt(400 * 86400)] });
      return send({ steps: [appr, { transaction: tx(locker, lockData) }] });
    }
    return send({ steps: [] });
  }
  if (req.url === "/api/v1/templates" && req.method === "POST") {
    // k3754 (M-1404): NEW SDK fetch AbortSignal.timeout(30000) — the mock
    // delays the templates response 31s; the SDK must abort, throw, send no tx.
    if (mode === "k3754") await new Promise((r) => setTimeout(r, 31000));
    let steps = [];
    if (M17T[mode]) { steps = M17T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    if (R38T[mode]) { steps = R38T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    if (M18T[mode]) { steps = M18T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    if (R39T[mode]) { steps = R39T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    if (R40T[mode]) { steps = R40T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    if (M19T[mode]) { steps = M19T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (M15T[mode]) { steps = M15T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    if (R37T[mode]) { steps = R37T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (R36T[mode]) { steps = R36T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (R35T[mode]) { steps = R35T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (R33T[mode]) { steps = R33T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (M14T[mode]) { steps = M14T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (M13T[mode]) { steps = M13T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (M12T[mode]) { steps = M12T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (R32T[mode]) { steps = R32T[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (mode === "k2190") { // optimistic, kind-5 value=now (window already closed)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 5, target: V, data: "0x", value: BigInt(w) },
      ])) }];
    } else if (mode === "k2191") { // balance_trigger, data=balanceOf(attacker), value=1
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 7, target: USDG, data: balData(A), value: 1n },
      ])) }];
    } else if (mode === "k2192") { // panel, quorum [attacker]/k=1
      const qdata = encodeAbiParameters([{ type: "address[]" }], [[A]]).toLowerCase();
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 6, target: ZERO, data: qdata, value: 1n },
      ])) }];
    } else if (mode === "k2193") { // confirmed_with_cooling, kind-9 value=3600 (asked 720h)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
        { kind: 9, target: V, data: encodeAbiParameters([{ type: "uint256" }], [0n]).toLowerCase(), value: 3600n },
      ])) }];
    } else if (mode === "k2194") { // arbiter_escrow, expiryHours=1 asked, server sets now+24h
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(24), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k2542") { // milestones x3, stepHours=24, expiryHours=500 explicit; server expiry now+500h each (documented max())
      const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, expiry(h), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) });
      steps = [approve(USDG, amt500), ms(166666668n, 500), ms(166666667n, 500), ms(166666665n, 500)]; // amounts distinct per step: on-chain duplicate-guard (0xf3fb463d) reverts byte-identical createAgreement
    } else if (mode === "k2543") { // milestones x2, stepHours=24, expiryHours OMITTED; server expiry now+max(72,24*i)=72h
      const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, expiry(h), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) });
      steps = [approve(USDG, amt500), ms(250n * 10n ** 6n, 72), ms(250n * 10n ** 6n, 72)];
    } else if (mode === "k2544") { // milestones x2, stepHours=168, expiryHours OMITTED; server expiry now+168h/336h
      const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, expiry(h), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) });
      steps = [approve(USDG, amt500), ms(250n * 10n ** 6n, 168), ms(250n * 10n ** 6n, 336)];
    } else if (mode === "k2545") { // milestones x2, stepHours=24, expiryHours=24 explicit; server expiry now+24h/48h
      const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, expiry(h), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) });
      steps = [approve(USDG, amt500), ms(250n * 10n ** 6n, 24), ms(250n * 10n ** 6n, 48)];
    } else if (mode === "k2551") { // recurring x2, everyHours OMITTED; server kind-0 now+168h/336h, expiry 72h
      const rec = (h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 0, target: ZERO, data: "0x", value: BigInt(w + h * 3600) },
      ])) });
      steps = [approve(USDG, 1000n * 10n ** 6n), rec(168), rec(336)];
    } else if (mode === "k2568") { // two_of_three, quorum [attacker]/k=1 (B-23 re-grade)
      const qdata = encodeAbiParameters([{ type: "address[]" }], [[A]]).toLowerCase();
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 6, target: ZERO, data: qdata, value: 1n },
      ])) }];
    } else if (mode === "k2549") { // panel, quorum [attacker]/k=1 (B-23 K-593 re-grade)
      const qdata = encodeAbiParameters([{ type: "address[]" }], [[A]]).toLowerCase();
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 6, target: ZERO, data: qdata, value: 1n },
      ])) }];
    } else if (mode === "k2550") { // confirmed_with_cooling, kind-9 value=3600 (B-23 K-595 re-grade)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
        { kind: 9, target: V, data: encodeAbiParameters([{ type: "uint256" }], [0n]).toLowerCase(), value: 3600n },
      ])) }];
    } else if (mode === "k2370") { // token_price_trigger, server returns kind-1 attest-by-payee (B-15 re-grade)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: A, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k2374") { // milestones x2, step 2 carries an EVIL termsHash (multi exempt)
      steps = [approve(USDG, amt500),
        { transaction: tx(AGREEMENT, mkAgr(A, USDG, 250n * 10n ** 6n, expiry(168), th, [
          { kind: 1, target: ARB, data: "0x", value: 0n },
        ])) },
        { transaction: tx(AGREEMENT, mkAgr(A, USDG, 250n * 10n ** 6n, expiry(336), keccak256(toHex("EVIL TERMS")), [
          { kind: 1, target: ARB, data: "0x", value: 0n },
        ])) }];
    } else if (mode === "k2379") { // scheduled_payment, afterHours OMITTED, server returns kind-0 now+24h
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) },
      ])) }];
    } else if (mode === "k2722") { // milestones x2, stepHours=48, expiryHours OMITTED; server expiry now+72h/step (M-394 OBS re-confirm)
      const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, expiry(h), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) });
      steps = [approve(USDG, amt500), ms(250n * 10n ** 6n, 72), ms(250n * 10n ** 6n, 72)];
    } else if (mode === "k2778") { // milestones x2, stepHours=12, expiryHours OMITTED; server expiry now+72h/step (M-293 OBS, new generalisation)
      const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, expiry(h), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) });
      steps = [approve(USDG, amt500), ms(250n * 10n ** 6n, 72), ms(250n * 10n ** 6n, 72)];
    } else if (mode === "k2731") { // optimistic, windowHours=48 asked; server returns kind-5 value=now (B-23 K-595 re-grade)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 5, target: V, data: "0x", value: BigInt(w) },
      ])) }];
    } else if (mode === "k2733") { // split_payment, NO arbiter + NO afterHours; server kind-0 now+24h (M-403)
      const sh = [250n * 10n ** 6n, 250n * 10n ** 6n];
      steps = [approve(USDG, amt500),
        { transaction: tx(AGREEMENT, mkAgr(A, USDG, sh[0], expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) }])) },
        { transaction: tx(AGREEMENT, mkAgr(S, USDG, sh[1], expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) }])) }];
    } else if (mode === "k2737") { // performance_bond, server swaps arbiter -> attacker (M-407)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: A, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k2738") { // balance_trigger, token OMITTED by caller; server returns honest-looking steps (M-408)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 7, target: USDG, data: balData(H), value: 1000000n * 10n ** 6n },
      ])) }];
    } else if (mode === "k2739") { // price_trigger, op OMITTED; server returns kind-8 (lte) (M-409)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 8, target: USDG, data: "0x1234", value: 100n },
      ])) }];
    } else if (mode === "k2850") { // milestones x2, stepHours=72, expiryHours OMITTED; server expiry now+72h/step (M-293 boundary)
      const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, expiry(h), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) });
      steps = [approve(USDG, amt500), ms(250n * 10n ** 6n, 72), ms(250n * 10n ** 6n, 72)];
    } else if (mode === "k2851") { // panel, quorum [attacker]/k=1 (B-23 re-grade, =k2549)
      const qdata = encodeAbiParameters([{ type: "address[]" }], [[A]]).toLowerCase();
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 6, target: ZERO, data: qdata, value: 1n },
      ])) }];
    } else if (mode === "k2852") { // confirmed_with_cooling, kind-9 value=3600 (B-23 re-grade, =k2550)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
        { kind: 9, target: V, data: encodeAbiParameters([{ type: "uint256" }], [0n]).toLowerCase(), value: 3600n },
      ])) }];
    } else if (mode === "k2853") { // token_price_trigger, kind-1 attest-by-payee (B-15 re-grade, =k2370)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: A, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k2854") { // after_deal, kind-4 target = DvP escrow 0xd685 (deal 1 settled there live) (M-497)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 4, target: "0xd685d39E7a3deF19E52B9AB09679b7452C23e20b", data: "0x", value: 1n },
      ])) }];
    } else if (mode === "k2855") { // recurring x3, everyHours=168; server sets EVERY step expiry now+24h (M-498, M-91 family)
      const rec = (amt, h, exp) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, expiry(exp), th, [
        { kind: 0, target: ZERO, data: "0x", value: BigInt(w + h * 3600) },
      ])) });
      steps = [approve(USDG, 1500n * 10n ** 6n), rec(500n * 10n ** 6n, 168, 24), rec(500n * 10n ** 6n, 336, 24), rec(500n * 10n ** 6n, 504, 24)];
    } else if (mode === "k2858") { // scheduled_payment, afterHours OMITTED; server kind-0 now+24h (=k2379)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) },
      ])) }];
    } else if (mode === "k2864") { // split_payment, NO arbiter + NO afterHours; server kind-0 now+24h (=k2733, M-403)
      const sh = [250n * 10n ** 6n, 250n * 10n ** 6n];
      steps = [approve(USDG, amt500),
        { transaction: tx(AGREEMENT, mkAgr(A, USDG, sh[0], expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) }])) },
        { transaction: tx(AGREEMENT, mkAgr(S, USDG, sh[1], expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) }])) }];
    } else if (mode === "k2865") { // split_payment CONTROL: NO arbiter + afterHours=24; server kind-0 now+24h
      const sh = [250n * 10n ** 6n, 250n * 10n ** 6n];
      steps = [approve(USDG, amt500),
        { transaction: tx(AGREEMENT, mkAgr(A, USDG, sh[0], expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) }])) },
        { transaction: tx(AGREEMENT, mkAgr(S, USDG, sh[1], expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) }])) }];
    } else if (mode === "k2940") { // milestones x2, stepHours=36, expiryHours OMITTED; server expiry now+72h/step (M-293, new generalisation)
      const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, expiry(h), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) });
      steps = [approve(USDG, amt500), ms(250n * 10n ** 6n, 72), ms(250n * 10n ** 6n, 72)];
    } else if (mode === "k2943") { // split_payment shares [1e15, 1], amount 500; server exact micro: [500000000, 0] (M-584)
      steps = [approve(USDG, amt500),
        { transaction: tx(AGREEMENT, mkAgr(A, USDG, 500n * 10n ** 6n, expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) }])) },
        { transaction: tx(AGREEMENT, mkAgr(S, USDG, 0n, expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) }])) }];
    } else if (mode === "k2948") { // milestones x2, server UNDER-pays: steps [400, 50] of 500 total (M-589)
      const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, expiry(h), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) });
      steps = [approve(USDG, amt500), ms(400n * 10n ** 6n, 168), ms(50n * 10n ** 6n, 336)];
    } else if (mode === "k2949") { // recurring x2, everyHours OMITTED; server kind-0 now+24h/48h (M-590)
      const rec = (h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 0, target: ZERO, data: "0x", value: BigInt(w + h * 3600) },
      ])) });
      steps = [approve(USDG, 1000n * 10n ** 6n), rec(24), rec(48)];
    } else if (mode === "k2950") { // split_payment WITH arbiter passed; server returns kind-0 (no arbiter) (M-591)
      const sh = [250n * 10n ** 6n, 250n * 10n ** 6n];
      steps = [approve(USDG, amt500),
        { transaction: tx(AGREEMENT, mkAgr(A, USDG, sh[0], expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) }])) },
        { transaction: tx(AGREEMENT, mkAgr(S, USDG, sh[1], expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) }])) }];
    } else if (mode === "k2955") { // token_price_trigger, server returns kind-1 attest-by-ATTACKER (B-15 re-grade, M-596)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: A, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "kfe1") { // FE-C1 verification: milestones x2, stepHours=168, expiryHours=100; server step expiries now+100h
      const ms = (amt, h) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, expiry(h), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) });
      steps = [approve(USDG, amt500), ms(250n * 10n ** 6n, 100), ms(250n * 10n ** 6n, 100)];
    } else if (mode === "k3123") { // M-764 scheduled_payment afterHours=8760 (1y); server kind-0 now+8760h, expiry now+8784h
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(8784), th, [
        { kind: 0, target: ZERO, data: "0x", value: BigInt(w + 8760 * 3600) },
      ])) }];
    } else if (mode === "k3124") { // M-765 scheduled_payment afterHours=0; server kind-0 value=now (unlock immediately)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 0, target: ZERO, data: "0x", value: BigInt(w) },
      ])) }];
    } else if (mode === "k3125") { // M-766 panel quorum k=99 with 3 voters [V,A,S] (B-23 data/value gap, opposite direction)
      const qdata = encodeAbiParameters([{ type: "address[]" }], [[V, A, S]]).toLowerCase();
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 6, target: ZERO, data: qdata, value: 99n },
      ])) }];
    } else if (mode === "k3127") { // M-768 deal(arbiter_escrow) feeWei=0.04 ETH (B-45 fold: feeWei never checked in deal())
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgrFee(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ], parseEther("0.04")), "40000000000000000") }];
    } else if (mode === "k3129") { // M-770 after_deal dealId=999 (nonexistent); server kind-4 target=stored escrow, value=999
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 4, target: ESCROW, data: "0x", value: 999n },
      ])) }];
    } else if (mode === "k3130") { // M-771 balance_trigger min=0; server kind-7 balanceOf(H) >= 0 (trivially true)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 7, target: USDG, data: balData(H), value: 0n },
      ])) }];
    } else if (mode === "k3134") { // M-775 optimistic windowHours=0; server kind-5 value=now (window already closed)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 5, target: V, data: "0x", value: BigInt(w) },
      ])) }];
    } else if (mode === "k3136") { // M-777 split_payment 1 micro, 10 payees; server exact micro [1,0,0,...]
      const payees = [A, S, V1, V2, V3, V4, V5, V6, V7, V8];
      const amts = [1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
      steps = [approve(USDG, 1n)];
      payees.forEach((py, i) => steps.push({ transaction: tx(AGREEMENT, mkAgr(py, USDG, amts[i], expiry(72), th, [
        { kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) },
      ])) }));
    } else if (mode === "k3137") { // M-778 milestones x8, stepHours=1, expiryHours=72; server expiry now+72h (+60s stagger/step, amounts distinct)
      const ms = (amt, secs) => ({ transaction: tx(AGREEMENT, mkAgr(A, USDG, amt, BigInt(w + 72 * 3600 + secs), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) });
      steps = [approve(USDG, amt500),
        ms(62500001n, 0), ms(62499999n, 60), ms(62500000n, 120), ms(62500000n, 180),
        ms(62500000n, 240), ms(62500000n, 300), ms(62500000n, 360), ms(62500000n, 420)];
    }
    return send({ steps });
  }
  if (req.url === "/api/v1/agreements" && req.method === "POST") {
    let steps = [];
    if (M17A[mode]) { steps = M17A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    if (R38A[mode]) { steps = R38A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    if (M18A[mode]) { steps = M18A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    if (R39A[mode]) { steps = R39A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    if (M19A[mode]) { steps = M19A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (M15A[mode]) { steps = M15A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (R37A[mode]) { steps = R37A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (R36A[mode]) { steps = R36A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (R35A[mode]) { steps = R35A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (R33A[mode]) { steps = R33A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (M14A[mode]) { steps = M14A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (M13A[mode]) { steps = M13A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (M12A[mode]) { steps = M12A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (R32A[mode]) { steps = R32A[mode]({ w, expiry, th, mkAgr, mkAgrFee, approve, amt500, balData }); }
    else if (mode === "k2372") { // agree() NO conditions + NO expiryHours; server: attest-by-attacker + expiry now+100y
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, BigInt(w + 100 * 365 * 24 * 3600), th, [
        { kind: 1, target: A, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k2735") { // agree() [attest ARB, attest V1, veto] — server veto data=encode(1) (last attest) (M-405)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
        { kind: 1, target: V1, data: "0x", value: 0n },
        { kind: 9, target: V, data: encodeAbiParameters([{ type: "uint256" }], [1n]).toLowerCase(), value: 86400n },
      ])) }];
    } else if (mode === "k2736") { // agree() NO conditions, expiryHours=72 PASSED; server: attest-by-attacker (M-406, B-44)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: A, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k2373") { // agree() honest conditions + NO expiryHours; server: expiry now+100y
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, BigInt(w + 100 * 365 * 24 * 3600), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k2860") { // agree() [attest ARB, attest V1]; server returns both conditions honestly (M-503)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
        { kind: 1, target: V1, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k2868") { // agree() honest conditions + NO expiryHours; server: expiry now+100y (=k2373, M-510 fold B-28)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, BigInt(w + 100 * 365 * 24 * 3600), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k2944") { // agree() conditions:[] EXPLICIT; server returns createAgreement with ZERO conditions (M-585)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [])) }];
    } else if (mode === "k2945") { // agree() expiryHours=0; server returns expiry now+3600 (M-586)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(1), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k3121") { // M-762 agree() attest by the PAYEE (caller passed by=payee); server kind-1 target=A, honest per request
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: A, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k3122") { // M-763 agree() expiryHours=87600 (10y); server expiry now+87600h
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, BigInt(w + 87600 * 3600), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k3126") { // M-767 agree() conditions OMITTED; server kind-0 time_after=now (B-44 fold, opposite server choice)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 0, target: ZERO, data: "0x", value: BigInt(w) },
      ])) }];
    } else if (mode === "k3131") { // M-772 agree() amount=0; server amount 0, attest ARB
      steps = [approve(USDG, 0n), { transaction: tx(AGREEMENT, mkAgr(A, USDG, 0n, expiry(72), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) }];
    }
    return send({ steps });
  }
  // MINOR 17 k4219: stream.create() — mock /api/v1/streams returns one
  // createStream step. Case "wrong": the tx locks 1.04 ETH while the caller
  // asked for a 1 ETH stream — under the 1.05 ETH #guard cap, so the
  // createStream check() itself must refuse it before sending.
  // Case "honest": amount matches exactly (SDK must proceed to send).
  if (req.url === "/api/v1/streams" && req.method === "POST") {
    // ROUND 39-A: echo the caller's duration/start (k4480 durationDays
    // fractional -> secs=1; k4478 startAt in the past). Old rounds always
    // returned secs=86400/start 0, which would falsely refuse those cases.
    const secs = Number(p.durationSeconds || 0) > 0 ? Math.round(Number(p.durationSeconds)) : Math.round(Number(p.durationDays || 1) * 86400);
    const amtEth = current.streamCase === "wrong" ? parseEther("1.04") : current.streamCase === "amountraw-honest" ? 1n : parseEther("1");
    const startEcho = p.startAt !== undefined && p.startAt !== null ? BigInt(Math.floor(Number(p.startAt))) : 0n;
    const data = encodeFunctionData({ abi: STREAM_ABI, functionName: "createStream", args: [
      { payee: p.payee, arbiter: ZERO, asset: ZERO, amount: amtEth, start: startEcho, durationSecs: BigInt(secs) },
      { feeWei: 0n, expiry: BigInt(w + (current.streamCase === "expired" ? -3600 : 3600)), sig: "0x" + "00".repeat(65) }, // ROUND 39 k4308: streamCase "expired" returns a fee quote already expired
    ] });
    return send({ steps: [{ transaction: tx(STREAM, data, amtEth.toString()) }] });
  }
  res.writeHead(404); res.end("{}");
});

async function tryCall(wallet, fn, id, idx = 0n) {
  try { const h = await wallet.writeContract({ address: AGREEMENT, abi: AGR_ABI, functionName: fn, args: (fn === "attest" || fn === "vote") ? [BigInt(id), idx] : [BigInt(id)] }); await publicClient.waitForTransactionReceipt({ hash: h }); return true; }
  catch { return false; }
}
const usdg = (x) => (BigInt(x) / 10n ** 6n).toString();

async function setup() {
  await new Promise((r) => server.listen(API_PORT, r));
  const agrZero = "0x" + fs.readFileSync(path.join(ROOT, "mocks/agreement-v41-zerofee.hex"), "utf8").trim().replace(/^0x/, "");
  await rpc("anvil_setCode", [AGREEMENT, agrZero]);
  await rpc("anvil_setStorageAt", [AGREEMENT, "0x0", toHex32(1n)]);
  await rpc("anvil_setStorageAt", [AGREEMENT, "0xb", toHex32(1n)]);
  const mocks = JSON.parse(fs.readFileSync(path.join(ROOT, "mocks/MockERC20.json"), "utf8"));
  const hash = await walletV.deployContract({ abi: mocks.abi, bytecode: mocks.bytecode.object, args: [] });
  const addr = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress;
  const code = await publicClient.getCode({ address: addr });
  await rpc("anvil_setCode", [USDG, code]);
  await rpc("anvil_setStorageAt", [USDG, "0x2", toHex32(6n)]);
  await walletV.writeContract({ address: USDG, abi: mocks.abi, functionName: "mint", args: [V, 500000n * 10n ** 6n] });
  await walletV.writeContract({ address: USDG, abi: mocks.abi, functionName: "mint", args: [A, 1000000n * 10n ** 6n] });
  // Live escrow v3 zerofee (feeSigner patched to 0) for open() modes k2740/k2741.
  const escZero = "0x" + fs.readFileSync(path.join(ROOT, "mocks/escrow-v3-zerofee.hex"), "utf8").trim().replace(/^0x/, "");
  await rpc("anvil_setCode", [ESCROW, escZero]);
  // Live escrow's reentrancy guard `_lock` lives in SLOT 5 and must be 1
  // (fresh Anvil storage is 0; without this, fundPayment/cancel revert
  // Reentrancy() 0xab143c06 — a harness artifact, not live behaviour).
  await rpc("anvil_setStorageAt", [ESCROW, "0x5", toHex32(1n)]);
  // Lock token (fresh MockERC20) + TrapLocker + honest MockLocker for k2742/k2743/k2751.
  const ltHash = await walletV.deployContract({ abi: mocks.abi, bytecode: mocks.bytecode.object, args: [] });
  LOCKTOKEN = (await publicClient.waitForTransactionReceipt({ hash: ltHash })).contractAddress;
  await walletV.writeContract({ address: LOCKTOKEN, abi: mocks.abi, functionName: "mint", args: [V, 1000000n * 10n ** 18n] });
  const trapJson = JSON.parse(fs.readFileSync(path.join(ROOT, "mocks/TrapLocker.json"), "utf8"));
  const trapHash = await walletV.deployContract({ abi: trapJson.abi, bytecode: trapJson.bytecode.object, args: [] });
  TRAPLOCKER = (await publicClient.waitForTransactionReceipt({ hash: trapHash })).contractAddress;
  const lockerJson = JSON.parse(fs.readFileSync(path.join(ROOT, "mocks/MockLocker.json"), "utf8"));
  const lockerHash = await walletV.deployContract({ abi: lockerJson.abi, bytecode: lockerJson.bytecode.object, args: [] });
  MOCKLOCKER = (await publicClient.waitForTransactionReceipt({ hash: lockerHash })).contractAddress;
}

async function main() {
  const mode = process.argv[2] || "k2190";
  current.mode = mode;
  await setup();
  const bull = new Bull({ walletClient: walletV, publicClient, baseUrl: `http://127.0.0.1:${API_PORT}` });
  const results = [];
  const push = (o) => { results.push(o); console.log(`[${o.case}]`, JSON.stringify(o)); };

  if (mode === "k2190") {
    let id = null, err = "";
    try { id = await bull.deal("optimistic", { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 48 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2190 CONTROL deal(optimistic) kind-5 value=now, windowHours=48 asked", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refusedBySdkWindowCheck: err.includes("Bull SDK safety check failed") && err.includes("objection window") });
  }
  if (mode === "k2191") {
    let id = null, err = "";
    try { id = await bull.deal("balance_trigger", { payee: A, asset: "usdg", amount: "500", token: USDG, holder: H, min: "1000000", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2191 CONTROL deal(balance_trigger) data=balanceOf(attacker) value=1", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refusedBySdkBalanceCheck: err.includes("Bull SDK safety check failed") && err.includes("balance condition") });
  }
  if (mode === "k2192") {
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("panel", { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let vote = false, rel = false;
    if (sent) { vote = await tryCall(walletA, "vote", id); rel = await tryCall(walletA, "release", id); }
    const after = await bal(USDG, A);
    push({ case: "K-2192 deal(panel) quorum swapped to [attacker]/k=1", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, attackerVoted: vote, released: rel, payeeGainedUsdg: usdg(after - before), exploited: sent && vote && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2193") {
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("confirmed_with_cooling", { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, relEarly = false, relAfter = false;
    if (sent) {
      att = await tryCall(walletR, "attest", id);
      relEarly = await tryCall(walletA, "release", id);
      await rpc("anvil_increaseTime", [3601]);
      await rpc("anvil_setBalance", [A, "0x8ac7230489e80000"]);
      relAfter = await tryCall(walletA, "release", id);
    }
    const after = await bal(USDG, A);
    push({ case: "K-2193 deal(confirmed_with_cooling) kind-9 value=3600, windowHours=720 asked", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, arbiterAttested: att, releaseBlockedEarly: !relEarly, releasedAfter1h: relAfter, payeeGainedUsdg: usdg(after - before), windowShrunk720hTo1h: sent && att && !relEarly && relAfter && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2194") {
    const payerBefore = await bal(USDG, V);
    let id = null, err = "";
    try { id = await bull.deal("arbiter_escrow", { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 1 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let refAt1h = false, refAt24h = false;
    if (sent) {
      await rpc("anvil_increaseTime", [3601]);
      await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]);
      refAt1h = await tryCall(walletS, "refund", id);
      await rpc("anvil_increaseTime", [23 * 3600 + 1]);
      refAt24h = await tryCall(walletS, "refund", id);
    }
    const payerAfter = await bal(USDG, V);
    push({ case: "K-2194 deal(arbiter_escrow) expiryHours=1 asked, server set now+24h", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refundBlockedAt1h: !refAt1h, refundSucceededAt24h: refAt24h, payerRestoredToPreDeal: payerAfter === payerBefore, lockStretched1hTo24h: sent && !refAt1h && refAt24h && payerAfter === payerBefore });
  }
  if (mode === "k2549") {
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("panel", { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let vote = false, rel = false;
    if (sent) { vote = await tryCall(walletA, "vote", id); rel = await tryCall(walletA, "release", id); }
    const after = await bal(USDG, A);
    push({ case: "K-2549 deal(panel) quorum swapped to [attacker]/k=1 (B-23 re-grade)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, attackerVoted: vote, released: rel, payeeGainedUsdg: usdg(after - before), exploited: sent && vote && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2550") {
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("confirmed_with_cooling", { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, relEarly = false, relAfter = false;
    if (sent) {
      att = await tryCall(walletR, "attest", id);
      relEarly = await tryCall(walletA, "release", id);
      await rpc("anvil_increaseTime", [3601]);
      await rpc("anvil_setBalance", [A, "0x8ac7230489e80000"]);
      relAfter = await tryCall(walletA, "release", id);
    }
    const after = await bal(USDG, A);
    push({ case: "K-2550 deal(confirmed_with_cooling) kind-9 value=3600, windowHours=720 asked (B-23 re-grade)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, arbiterAttested: att, releaseBlockedEarly: !relEarly, releasedAfter1h: relAfter, payeeGainedUsdg: usdg(after - before), windowShrunk720hTo1h: sent && att && !relEarly && relAfter && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2370") {
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("token_price_trigger", { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "100", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, rel = false;
    if (sent) { att = await tryCall(walletA, "attest", id); rel = await tryCall(walletA, "release", id); }
    const after = await bal(USDG, A);
    push({ case: "K-2370 deal(token_price_trigger) server returns kind-1 attest-by-payee, no price check (B-15 re-grade)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, payeeSelfAttested: att, released: rel, payeeGainedUsdg: usdg(after - before), exploited: sent && att && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2372") {
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let refBlocked = false, attAtt = false, rel = false;
    if (sent) {
      refBlocked = !(await tryCall(walletS, "refund", id));
      attAtt = await tryCall(walletA, "attest", id);
      rel = await tryCall(walletA, "release", id);
    }
    const after = await bal(USDG, A);
    push({ case: "K-2372 agree() NO conditions + NO expiryHours; server: attest-by-attacker + expiry now+100y (B-28 re-grade)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refundBlocked: refBlocked, attackerAttested: attAtt, attackerReleased: rel, payeeGainedUsdg: usdg(after - before), lockedHostage100y: sent && refBlocked && attAtt && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2373") {
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", conditions: [{ type: "attest", by: ARB }] }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, rel = false, refBlocked = false;
    if (sent) {
      att = await tryCall(walletR, "attest", id);
      rel = await tryCall(walletA, "release", id);
      refBlocked = !(await tryCall(walletS, "refund", id));
    }
    const after = await bal(USDG, A);
    push({ case: "K-2373 agree() honest conditions + NO expiryHours; server: expiry now+100y", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, arbiterAttested: att, released: rel, refundBlocked100y: refBlocked, payeeGainedUsdg: usdg(after - before), releasePathIntact: sent && att && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2374") {
    let ids = null, err = "";
    try { ids = await bull.deal("milestones", { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 168, arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2374 deal(milestones x2) step 2 carries EVIL termsHash (multi exempt from termsHash check)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, evilTermsHashAccepted: !!ids && ids.length === 2 });
  }
  if (mode === "k2379") {
    let id = null, err = "";
    try { id = await bull.deal("scheduled_payment", { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2379 deal(scheduled_payment) afterHours OMITTED; server returns kind-0 now+24h", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refusedBySdkTimeCheck: err.includes("Bull SDK safety check failed") && err.includes("time condition") });
  }
  if (mode === "k2542") {
    let ids = null, err = "";
    try { ids = await bull.deal("milestones", { payee: A, asset: "usdg", amount: "500", milestones: 3, stepHours: 24, expiryHours: 500, arbiter: ARB, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2542 LEAD deal(milestones x3) stepHours=24 expiryHours=500 EXPLICIT; server expiry now+500h/step (documented max())", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, sentAll3: !!ids && ids.length === 3, noFalseRejection: !!ids && ids.length === 3 });
  }
  if (mode === "k2543") {
    let ids = null, err = "";
    try { ids = await bull.deal("milestones", { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 24, arbiter: ARB, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2543 LEAD deal(milestones x2) stepHours=24 expiryHours OMITTED; server expiry now+72h/step (documented default 72)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refusedAtStep1: err.includes("milestone 1") && err.includes("24 hours"), falseRejection: !ids && err.includes("milestone 1") });
  }
  if (mode === "k2544") {
    let ids = null, err = "";
    try { ids = await bull.deal("milestones", { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 168, arbiter: ARB, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2544 CONTROL deal(milestones x2) stepHours=168 expiryHours OMITTED; server expiry now+168h/336h", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, sentBoth: !!ids && ids.length === 2 });
  }
  if (mode === "k2545") {
    const payerBefore = await bal(USDG, V);
    let ids = null, err = "";
    try { ids = await bull.deal("milestones", { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 24, expiryHours: 24, arbiter: ARB, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!ids && ids.length === 2;
    const payerAfterDeal = await bal(USDG, V);
    let refAt25h = false;
    if (sent) {
      await rpc("anvil_increaseTime", [25 * 3600]);
      await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]);
      refAt25h = await tryCall(walletS, "refund", ids[0]);
    }
    const payerAfter = await bal(USDG, V);
    push({ case: "K-2545 WORKAROUND deal(milestones x2) stepHours=24 expiryHours=24 EXPLICIT; server expiry now+24h/48h; refund step1 at +25h", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refundStep1At25h: refAt25h, payerRecoveredStep1: refAt25h && (payerAfter - payerAfterDeal) === 250n * 10n ** 6n });
  }
  if (mode === "k2551") {
    let ids = null, err = "";
    try { ids = await bull.deal("recurring_payment", { payee: A, asset: "usdg", amount: "500", payments: 2, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2551 CONTROL deal(recurring_payment x2) everyHours OMITTED; server kind-0 now+168h/336h", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, sentBoth: !!ids && ids.length === 2 });
  }
  if (mode === "k2568") {
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("two_of_three", { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let vote = false, rel = false;
    if (sent) { vote = await tryCall(walletA, "vote", id); rel = await tryCall(walletA, "release", id); }
    const after = await bal(USDG, A);
    push({ case: "K-2568 deal(two_of_three) quorum swapped to [attacker]/k=1 (B-23 re-grade)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, attackerVoted: vote, released: rel, payeeGainedUsdg: usdg(after - before), exploited: sent && vote && rel && (after - before) === 500n * 10n ** 6n });
  }

  async function lastAgrTxData() {
    const blk = await rpc("eth_getBlockByNumber", ["latest", true]);
    const txs = (blk.transactions || []).filter((t) => t.to && t.to.toLowerCase() === AGREEMENT.toLowerCase() && t.from && t.from.toLowerCase() === V.toLowerCase());
    if (!txs.length) return null;
    const { decodeFunctionData } = await import("viem");
    return decodeFunctionData({ abi: AGR_ABI, data: txs[txs.length - 1].input });
  }

  if (mode === "k2722") {
    let ids = null, err = "";
    try { ids = await bull.deal("milestones", { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 48, arbiter: ARB, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2722 deal(milestones x2) stepHours=48 expiryHours OMITTED; server expiry now+72h/step (M-394 OBS)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refusedAtStep1: err.includes("milestone 1") && err.includes("48 hours"), falseRejection: !ids && err.includes("milestone 1") });
  }
  if (mode === "k2723") {
    let tx = null, err = "";
    try { tx = await bull.claim(1, { locker: "0x1111111111111111111111111111111111111111" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2723 claim(1) with vesting API 503 (M-395 re-triage M-233)", sdkSent: !!tx, sdkThrew: err.slice(0, 300), threwVestingNotLive: err.includes("Vesting is not live yet"), noTxSent: !tx });
  }
  if (mode === "k2731") {
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("optimistic", { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 48 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let rel = false;
    if (sent) { rel = await tryCall(walletA, "release", id); }
    const after = await bal(USDG, A);
    push({ case: "K-2731 deal(optimistic) windowHours=48; server kind-5 value=now (B-23 K-595 re-grade)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refusedBySdkWindowCheck: err.includes("Bull SDK safety check failed") && err.includes("objection window"), releasedImmediately: rel, payeeGainedUsdg: usdg(after - before), kind5Live: sent && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2733") {
    let ids = null, err = "";
    try { ids = await bull.deal("split_payment", { payees: [A, S], shares: [1, 1], asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2733 deal(split_payment) NO arbiter + NO afterHours; server kind-0 now+24h (M-403)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refusedBySdkTimeCheck: err.includes("Bull SDK safety check failed") && err.includes("unlocks at another time") });
  }
  if (mode === "k2735") {
    let id = null, err = "", vetoData = null;
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }, { type: "attest", by: V1 }, { type: "veto", by: V, afterHours: 24 }] }); }
    catch (e) { err = String(e.message || e); }
    if (id) { const fn = await lastAgrTxData(); if (fn) vetoData = String(fn.args[0].conditions[2].data); }
    push({ case: "K-2735 agree() [attest ARB, attest V1, veto] default attestIndex (M-405)", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, vetoDataOnChain: vetoData, vetoTargetsLastAttest: vetoData === "0x" + "00".repeat(31) + "01" });
  }
  if (mode === "k2736") {
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, rel = false;
    if (sent) { att = await tryCall(walletA, "attest", id); rel = await tryCall(walletA, "release", id); }
    const after = await bal(USDG, A);
    push({ case: "K-2736 agree() NO conditions, expiryHours=72 PASSED; server attest-by-attacker (M-406 B-44)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, attackerAttested: att, attackerReleased: rel, payeeGainedUsdg: usdg(after - before), exploited: sent && att && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2737") {
    let id = null, err = "";
    try { id = await bull.deal("performance_bond", { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2737 deal(performance_bond) server swaps arbiter -> attacker (M-407)", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refusedBySdkTargetCheck: err.includes("Bull SDK safety check failed") && err.includes("template defines") });
  }
  if (mode === "k2738") {
    let id = null, err = "";
    try { id = await bull.deal("balance_trigger", { payee: A, asset: "usdg", amount: "500", holder: H, min: "1000000", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2738 deal(balance_trigger) token OMITTED (M-408)", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refusedBeforeSend: !id });
  }
  if (mode === "k2739") {
    let id = null, err = "";
    try { id = await bull.deal("price_trigger", { payee: A, asset: "usdg", amount: "500", target: USDG, data: "0x1234", value: "100", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2739 deal(price_trigger) op OMITTED; server returns kind-8 (M-409)", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refusedBySdkKindCheck: err.includes("Bull SDK safety check failed") && err.includes("template defines") });
  }
  const signConsentFor = (deadline, validUntil) => walletR.signTypedData({ account: arbiter, domain: { name: "BullEscrow", version: "3", chainId: 4663, verifyingContract: ESCROW }, types: { Consent: [{ name: "buyer", type: "address" }, { name: "seller", type: "address" }, { name: "sellerPayout", type: "address" }, { name: "buyerReceive", type: "address" }, { name: "sellToken", type: "address" }, { name: "sellAmount", type: "uint256" }, { name: "payToken", type: "address" }, { name: "payAmount", type: "uint256" }, { name: "deadline", type: "uint64" }, { name: "validUntil", type: "uint64" }] }, primaryType: "Consent", message: { buyer: V, seller: ARB, sellerPayout: ZERO, buyerReceive: ZERO, sellToken: LOCKTOKEN, sellAmount: 1000n * 10n ** 18n, payToken: ZERO, payAmount: 250000000000000000n, deadline: BigInt(deadline), validUntil: BigInt(validUntil) } });
  // MINOR 10: generic consent — arbitrary signer/seller/amounts (k2941 self-deal, k2942 zero amounts).
  const signConsentAs = (signerWallet, sellerAddr, sellAmt, payAmt, deadline, validUntil) => signerWallet.signTypedData({ account: signerWallet.account, domain: { name: "BullEscrow", version: "3", chainId: 4663, verifyingContract: ESCROW }, types: { Consent: [{ name: "buyer", type: "address" }, { name: "seller", type: "address" }, { name: "sellerPayout", type: "address" }, { name: "buyerReceive", type: "address" }, { name: "sellToken", type: "address" }, { name: "sellAmount", type: "uint256" }, { name: "payToken", type: "address" }, { name: "payAmount", type: "uint256" }, { name: "deadline", type: "uint64" }, { name: "validUntil", type: "uint64" }] }, primaryType: "Consent", message: { buyer: V, seller: sellerAddr, sellerPayout: ZERO, buyerReceive: ZERO, sellToken: LOCKTOKEN, sellAmount: sellAmt, payToken: ZERO, payAmount: payAmt, deadline: BigInt(deadline), validUntil: BigInt(validUntil) } });
  const readDeal = (id) => publicClient.readContract({ address: ESCROW, abi: ESC_ABI, functionName: "deals", args: [BigInt(id)] });
  const tryEscrow = async (wallet, fn, id, value = 0n) => {
    try { const h = await wallet.writeContract({ address: ESCROW, abi: ESC_ABI, functionName: fn, args: [BigInt(id)], value }); await publicClient.waitForTransactionReceipt({ hash: h }); return true; }
    catch { return false; }
  };
  if (mode === "k2740" || mode === "k2741") {
    const w = wall();
    const deadline = w + 24 * 3600;
    const validUntil = mode === "k2740" ? deadline + 3600 : deadline - 3600;
    const sellAmt = 1000n * 10n ** 18n, payAmt = 250000000000000000n;
    const sellerSig = await walletR.signTypedData({ account: arbiter, domain: { name: "BullEscrow", version: "3", chainId: 4663, verifyingContract: ESCROW }, types: { Consent: [{ name: "buyer", type: "address" }, { name: "seller", type: "address" }, { name: "sellerPayout", type: "address" }, { name: "buyerReceive", type: "address" }, { name: "sellToken", type: "address" }, { name: "sellAmount", type: "uint256" }, { name: "payToken", type: "address" }, { name: "payAmount", type: "uint256" }, { name: "deadline", type: "uint64" }, { name: "validUntil", type: "uint64" }] }, primaryType: "Consent", message: { buyer: V, seller: ARB, sellerPayout: ZERO, buyerReceive: ZERO, sellToken: LOCKTOKEN, sellAmount: sellAmt, payToken: ZERO, payAmount: payAmt, deadline: BigInt(deadline), validUntil: BigInt(validUntil) } });
    let id = null, err = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(validUntil), deadline: String(deadline) }); }
    catch (e) { err = String(e.message || e); }
    push({ case: mode === "k2740" ? "K-2740 open() consent validUntil=deadline+1h (M-410)" : "K-2741 open() CONTROL consent validUntil=deadline-1h (M-410)", sdkSent: !!id, sdkThrew: err.slice(0, 400), dealId: id ? String(id) : null, sdkRefusedValidUntil: err.includes("Bull SDK safety check failed") && err.includes("valid"), escrowAccepted: !!id });
  }
  if (mode === "k2742" || mode === "k2743" || mode === "k2751") {
    current.lockerAddr = mode === "k2743" ? MOCKLOCKER : TRAPLOCKER;
    const tokBal = async (who) => publicClient.readContract({ address: LOCKTOKEN, abi: erc20Abi, functionName: "balanceOf", args: [who] });
    const beforeA = await tokBal(A), beforeV = await tokBal(V);
    let lockId = null, err = "";
    try {
      if (mode === "k2742") lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 0, durationDays: 0, stepDays: 0, locker: TRAPLOCKER });
      else if (mode === "k2743") lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 30, durationDays: 365, stepDays: 30, locker: MOCKLOCKER });
      else lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 30, durationDays: 365, stepDays: 30, locker: TRAPLOCKER });
    } catch (e) { err = String(e.message || e); }
    const afterA = await tokBal(A), afterV = await tokBal(V);
    push({ case: mode === "k2742" ? "K-2742 lock() trap(token,amount,beneficiary,attacker) passes substring check (M-411)" : mode === "k2743" ? "K-2743 lock() CONTROL honest createLock via MockLocker (M-411)" : "K-2751 lock() locker call without token/beneficiary hex (M-411)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, attackerGained: (afterA - beforeA).toString(), victimLost: (beforeV - afterV).toString(), trapDrained1000: mode === "k2742" && (afterA - beforeA) === 1000n * 10n ** 18n, refusedBySdkSubstringCheck: err.includes("Bull SDK safety check failed") && err.includes("does not name the token") });
  }
  if (mode === "k2757") { // M-411 redirect: caller pins MOCKLOCKER, server steps target TRAPLOCKER
    SERVER_LOCKER = TRAPLOCKER;
    current.lockerAddr = MOCKLOCKER;
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 30, durationDays: 365, stepDays: 30, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2757 lock() server redirects steps to TRAPLOCKER while caller pinned MOCKLOCKER (M-411)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, refusedBySdkLockerPin: err.includes("Bull SDK safety check failed") });
  }
  if (mode === "k2759" || mode === "k2760") { // M-412 open() deadline stretch (mock) vs honest control
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, err = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { err = String(e.message || e); }
    let onChainDeadline = null, dealExists = false;
    try { const d = await readDeal(0); dealExists = d[0] !== ZERO; onChainDeadline = Number(d[6]); } catch {}
    push({ case: mode === "k2759" ? "K-2759 open() server stretches deadline 24h->72h (M-412)" : "K-2760 open() CONTROL honest deadline 24h (M-412)", sdkSent: !!id, sdkThrew: err.slice(0, 400), dealId: id ? String(id) : null, escrowReverted: err.toLowerCase().includes("revert"), dealExistsOnChain: dealExists, onChainDeadline, askedDeadline: deadline, stretched: dealExists && onChainDeadline !== null && Math.abs(onChainDeadline - deadline) > 60 });
  }
  if (mode === "k2761") { // M-412 open() stretch via deal("delivery_vs_payment"): seller consent pre-signed for 72h
    const w = wall();
    current.stretchDeadline = w + 72 * 3600;
    current.stretchValidUntil = w + 73 * 3600;
    STRETCHED_SIG = await signConsentFor(current.stretchDeadline, current.stretchValidUntil);
    let id = null, err = "";
    try { id = await bull.deal("delivery_vs_payment", { seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24 }); }
    catch (e) { err = String(e.message || e); }
    let onChainDeadline = null, dealExists = false;
    try { const d = await readDeal(0); dealExists = d[0] !== ZERO; onChainDeadline = Number(d[6]); } catch {}
    // Harm demo: buyer funds 0.25 ETH, then cancel must fail at +25h and succeed only at +73h.
    let funded = false, cancelAt25h = null, cancelAt73h = null, buyerRefunded = false;
    if (id) {
      funded = await tryEscrow(walletV, "fundPayment", 0, 250000000000000000n);
      await rpc("anvil_increaseTime", [25 * 3600]);
      await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]);
      cancelAt25h = await tryEscrow(walletS, "cancel", 0);
      await rpc("anvil_increaseTime", [48 * 3600]);
      const balBefore = await publicClient.getBalance({ address: V });
      cancelAt73h = await tryEscrow(walletS, "cancel", 0);
      const balAfter = await publicClient.getBalance({ address: V });
      buyerRefunded = cancelAt73h && (balAfter - balBefore) >= 200000000000000000n;
    }
    push({ case: "K-2761 deal(delivery_vs_payment) server stretches deadline 24h->72h via 72h seller consent (M-412)", sdkSent: !!id, sdkThrew: err.slice(0, 400), dealId: id ? String(id) : null, dealExistsOnChain: dealExists, onChainDeadline, askedDeadline: w + 24 * 3600, stretched: dealExists && onChainDeadline !== null && Math.abs(onChainDeadline - (w + 24 * 3600)) > 60, buyerFunded: funded, cancelBlockedAt25h: cancelAt25h === false, cancelSucceedsAt73h: cancelAt73h === true, buyerRefundedAt73h: buyerRefunded });
  }
  if (mode === "k2761b") { // M-412 DECISIVE re-test: who can cancel a funded 72h deal at +25h?
    // Same stretch setup as k2761, but cancel is attempted by the BUYER (walletV)
    // AND by a stranger (walletS) at +25h. Per escrow source, buyer/seller may cancel
    // any time while Open; only strangers wait until after the deadline.
    const w = wall();
    current.stretchDeadline = w + 72 * 3600;
    current.stretchValidUntil = w + 73 * 3600;
    STRETCHED_SIG = await signConsentFor(current.stretchDeadline, current.stretchValidUntil);
    let id = null, err = "";
    try { id = await bull.deal("delivery_vs_payment", { seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24 }); }
    catch (e) { err = String(e.message || e); }
    let onChainDeadline = null, dealExists = false;
    try { const d = await readDeal(0); dealExists = d[0] !== ZERO; onChainDeadline = Number(d[6]); } catch {}
    let funded = false, buyerCancelAt25h = null, strangerCancelAt25h = null, buyerRefundedAt25h = false, statusAfter = null;
    if (id) {
      funded = await tryEscrow(walletV, "fundPayment", 0, 250000000000000000n);
      await rpc("anvil_increaseTime", [25 * 3600]);
      const balBefore = await publicClient.getBalance({ address: V });
      buyerCancelAt25h = await tryEscrow(walletV, "cancel", 0);
      const balAfter = await publicClient.getBalance({ address: V });
      buyerRefundedAt25h = buyerCancelAt25h && (balAfter - balBefore) >= 200000000000000000n;
      try { const d = await readDeal(0); statusAfter = Number(d[9]); } catch {}
      if (!buyerCancelAt25h) strangerCancelAt25h = await tryEscrow(walletS, "cancel", 0);
    }
    push({ case: "K-2761b M-412 decisive: BUYER cancel at +25h on funded 72h deal (vs stranger)", sdkSent: !!id, sdkThrew: err.slice(0, 400), dealId: id ? String(id) : null, dealExistsOnChain: dealExists, onChainDeadline, askedDeadline: w + 24 * 3600, stretched: dealExists && onChainDeadline !== null && Math.abs(onChainDeadline - (w + 24 * 3600)) > 60, buyerFunded: funded, buyerCancelAt25h, strangerCancelAt25h, buyerRefundedAt25h, statusAfter });
  }
  if (mode === "k2762") { // M-413 lock() startAt 30d in the past; server returns honest lock starting now
    const w = wall();
    current.lockerAddr = MOCKLOCKER;
    const tokBal = async (who) => publicClient.readContract({ address: LOCKTOKEN, abi: erc20Abi, functionName: "balanceOf", args: [who] });
    const beforeV = await tokBal(V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 30, durationDays: 365, stepDays: 30, startAt: String(w - 30 * 86400), locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const afterV = await tokBal(V);
    push({ case: "K-2762 lock() startAt 30d in the past, server lock starts now (M-413)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, threwAfterSend: err.includes("different cliff, end or step"), victimLockedTokens: (beforeV - afterV).toString() });
  }
  if (mode === "k2763") { // M-414 consent() with server validUntil AFTER the deadline
    let r = null, err = "";
    try { r = await bull.consent({ buyer: S, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2763 consent() server validUntil=deadline+1h (M-414)", sdkSent: !!r, sdkThrew: err.slice(0, 300), refusedValidUntilAfterDeadline: err.includes("Bull SDK safety check failed") && err.includes("longer than the deal deadline") });
  }
  if (mode === "k2764") { // M-415 forged receipt (wrong escrow + attacker-signed, well-formed sig)
    const r = { version: "bull-receipt-1", chainId: 4663, escrow: "0xd685d39E7a3deF19E52B9AB09679b7452C23e20b", dealId: "1", buyer: V, seller: ARB, sellToken: USDG, sellAmount: "5200000", payToken: ZERO, payAmount: "2900000000000000", feeBps: 250 };
    const message = ["Bull receipt v1", ...Object.entries(r).map(([k, x]) => `${k}:${x}`)].join("\n");
    current.receiptSig = await walletA.signMessage({ account: attacker, message });
    let j = null, err = "";
    try { j = await bull.receipt(1); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2764 receipt() forged receipt, DvP escrow + attacker sig (M-415)", sdkSent: !!j, sdkThrew: err.slice(0, 300), refusedNotSignedByBull: err.includes("not signed by Bull") });
  }
  if (mode === "k2765") { // M-416 waitSettled(): server says settled, chain says not
    let s = null, err = "";
    try { s = await bull.waitSettled(1, { timeoutMs: 5000, everyMs: 1000 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2765 waitSettled() server says settled, chain disagrees (M-416)", sdkSent: !!s, sdkThrew: err.slice(0, 300), refusedChainMismatch: err.includes("the chain does not") });
  }
  if (mode === "k2766") { // M-417 attest() action for the WRONG agreement id
    let h = null, err = "";
    try { h = await bull.attest(1); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2766 attest(1) server returns attest tx for agreement 2 (M-417)", sdkSent: !!h, sdkThrew: err.slice(0, 300), refusedBySdkIdCheck: err.includes("Bull SDK safety check failed") && err.includes("not the 1 you asked for") });
  }
  if (mode === "k2767") { // M-418 release() tx for the WRONG agreement id
    let h = null, err = "";
    try { h = await bull.release(1); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2767 release(1) server returns release tx for agreement 2 (M-418)", sdkSent: !!h, sdkThrew: err.slice(0, 300), refusedBySdkIdCheck: err.includes("Bull SDK safety check failed") && err.includes("not the 1 you asked for") });
  }
  if (mode === "k2768") { // M-419 fund(0) — server returns a fundPayment step for deal 1
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, openErr = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { openErr = String(e.message || e); }
    let hashes = null, err = "";
    if (id) { try { hashes = await bull.fund(0); } catch (e) { err = String(e.message || e); } }
    push({ case: "K-2768 fund(0) server returns fundPayment step for deal 1 (M-419)", openDealId: id ? String(id) : null, openErr: openErr.slice(0, 200), sdkSent: !!hashes, sdkThrew: err.slice(0, 300), refusedBySdkIdCheck: err.includes("Bull SDK safety check failed") && err.includes("not the 0 you asked for") });
  }
  if (mode === "k2769" || mode === "k2770") { // M-420/M-421 open() sellerPayout swap / feeBps 300
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, err = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { err = String(e.message || e); }
    push({ case: mode === "k2769" ? "K-2769 open() server swaps sellerPayout to attacker (M-420)" : "K-2770 open() server sets feeBps 300 (M-421)", sdkSent: !!id, sdkThrew: err.slice(0, 300), dealId: id ? String(id) : null, refusedBySdkPreCheck: err.includes("Bull SDK safety check failed") });
  }
  if (mode === "k2778") { // M-293 OBS: milestones x2, stepHours=12, expiryHours OMITTED; server expiry now+72h/step
    let ids = null, err = "";
    try { ids = await bull.deal("milestones", { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 12, arbiter: ARB, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2778 deal(milestones x2) stepHours=12 expiryHours OMITTED; server expiry now+72h/step (M-293 OBS)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refusedAtStep1: err.includes("milestone 1") && err.includes("12 hours"), falseRejection: !ids && err.includes("milestone 1") });
  }
  if (mode === "k2845") { // M-233 re-triage: claim(1) with vesting API 503 (ROUND 30)
    let txh = null, err = "";
    try { txh = await bull.claim(1, { locker: "0x1111111111111111111111111111111111111111" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2845 claim(1) with vesting API 503 (M-233 re-triage)", sdkSent: !!txh, sdkThrew: err.slice(0, 300), threwVestingNotLive: err.includes("Vesting is not live yet"), noTxSent: !txh });
  }
  if (mode === "k2850") { // M-293 boundary: milestones x2, stepHours=72, expiryHours OMITTED; server expiry now+72h/step
    let ids = null, err = "";
    try { ids = await bull.deal("milestones", { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 72, arbiter: ARB, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2850 deal(milestones x2) stepHours=72 expiryHours OMITTED; server expiry now+72h/step (M-293 boundary)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refusedAtStep: err.includes("milestone 2") ? 2 : (err.includes("milestone 1") ? 1 : 0), step1PassedStep2Refused: !ids && err.includes("milestone 2") });
  }
  if (mode === "k2851") { // B-23 re-grade panel
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("panel", { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let vote = false, rel = false;
    if (sent) { vote = await tryCall(walletA, "vote", id); rel = await tryCall(walletA, "release", id); }
    const after = await bal(USDG, A);
    push({ case: "K-2851 deal(panel) quorum swapped to [attacker]/k=1 (B-23 re-grade)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, attackerVoted: vote, released: rel, payeeGainedUsdg: usdg(after - before), exploited: sent && vote && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2852") { // B-23 re-grade confirmed_with_cooling kind-9
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("confirmed_with_cooling", { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, relEarly = false, relAfter = false;
    if (sent) {
      att = await tryCall(walletR, "attest", id);
      relEarly = await tryCall(walletA, "release", id);
      await rpc("anvil_increaseTime", [3601]);
      await rpc("anvil_setBalance", [A, "0x8ac7230489e80000"]);
      relAfter = await tryCall(walletA, "release", id);
    }
    const after = await bal(USDG, A);
    push({ case: "K-2852 deal(confirmed_with_cooling) kind-9 value=3600, windowHours=720 asked (B-23 re-grade)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, arbiterAttested: att, releaseBlockedEarly: !relEarly, releasedAfter1h: relAfter, payeeGainedUsdg: usdg(after - before), windowShrunk720hTo1h: sent && att && !relEarly && relAfter && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2853") { // B-15 re-grade token_price_trigger
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("token_price_trigger", { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "100", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, rel = false;
    if (sent) { att = await tryCall(walletA, "attest", id); rel = await tryCall(walletA, "release", id); }
    const after = await bal(USDG, A);
    push({ case: "K-2853 deal(token_price_trigger) server returns kind-1 attest-by-payee, no price check (B-15 re-grade)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, payeeSelfAttested: att, released: rel, payeeGainedUsdg: usdg(after - before), exploited: sent && att && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2854") { // M-497 after_deal kind-4 target = DvP escrow (deal 1 settled there live)
    let id = null, err = "";
    try { id = await bull.deal("after_deal", { payee: A, asset: "usdg", amount: "500", dealId: 1, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2854 deal(after_deal) kind-4 target=DvP escrow 0xd685, dealId=1 (M-497)", sdkSent: !!id, sdkThrew: err.slice(0, 400), agreementId: id ? String(id) : null, sdkPassedTargetCheck: !err.includes("Bull SDK safety check failed"), txRevertedAtContract: err.includes("Transaction failed"), contractBlocked: !id && err.includes("Transaction failed") });
  }
  if (mode === "k2855") { // M-498 recurring x3, every step expiry now+24h (unlocks +168/+336/+504h)
    let ids = null, err = "";
    try { ids = await bull.deal("recurring_payment", { payee: A, asset: "usdg", amount: "500", payments: 3, everyHours: 168, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!ids && ids.length === 3;
    let refundStep3At25h = false, payerRecoveredStep3 = false;
    if (sent) {
      const payerBefore = await bal(USDG, V);
      await rpc("anvil_increaseTime", [25 * 3600]);
      await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]);
      refundStep3At25h = await tryCall(walletS, "refund", ids[2]);
      const payerAfter = await bal(USDG, V);
      payerRecoveredStep3 = refundStep3At25h && (payerAfter - payerBefore) === 500n * 10n ** 6n;
    }
    push({ case: "K-2855 deal(recurring_payment x3) every step expiry now+24h, unlocks +168/+336/+504h (M-498)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refundStep3At25h, payerRecoveredStep3, payeeLosesPayment3Early: refundStep3At25h });
  }
  if (mode === "k2856") { // M-499 agree() veto without any prior attest
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "veto", by: V, afterHours: 24 }] }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2856 agree() veto without prior attest (attestIndex -1) (M-499)", sdkSent: !!id, sdkThrew: err.slice(0, 300), threwBeforeSend: !id && (err.includes("256-bit") || err.includes("safe integer") || err.includes("BigInt")), noTxSent: !id });
  }
  if (mode === "k2857") { // M-500 bridge quote: approve spender = attacker (B-42 fold re-confirm)
    const before = await bal(USDG, A);
    let q = null, quoteErr = "";
    try { q = await bull.bridge.quote({ from: "robinhood", to: "base", amount: "100" }); }
    catch (e) { quoteErr = String(e.message || e); }
    let hashes = null, sendErr = "";
    if (q) { try { hashes = await bull.bridge.send(q); } catch (e) { sendErr = String(e.message || e); } }
    let drained = false;
    if (hashes) {
      try { await walletA.writeContract({ address: USDG, abi: erc20Abi, functionName: "transferFrom", args: [V, A, 100n * 10n ** 6n] }); drained = true; } catch {}
    }
    const after = await bal(USDG, A);
    push({ case: "K-2857 bridge.quote/send: approve spender=attacker passes checkBridge, attacker drains 100 USDG (M-500, B-42 fold)", quotePassedCheckBridge: !!q, quoteErr: quoteErr.slice(0, 200), approveSent: !!hashes, sendErr: sendErr.slice(0, 200), attackerDrained100: drained && (after - before) === 100n * 10n ** 6n, payeeGainedUsdg: usdg(after - before) });
  }
  if (mode === "k2858") { // M-501 scheduled_payment afterHours OMITTED
    let id = null, err = "";
    try { id = await bull.deal("scheduled_payment", { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2858 deal(scheduled_payment) afterHours OMITTED; server returns kind-0 now+24h (M-501)", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refusedBySdkTimeCheck: err.includes("Bull SDK safety check failed") && err.includes("time condition") });
  }
  if (mode === "k2859") { // M-502 fund(0) — server returns a fundPayment step for deal 1
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, openErr = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { openErr = String(e.message || e); }
    let hashes = null, err = "";
    if (id) { try { hashes = await bull.fund(0); } catch (e) { err = String(e.message || e); } }
    push({ case: "K-2859 fund(0) server returns fundPayment step for deal 1 (M-502)", openDealId: id ? String(id) : null, openErr: openErr.slice(0, 200), sdkSent: !!hashes, sdkThrew: err.slice(0, 300), refusedBySdkIdCheck: err.includes("Bull SDK safety check failed") && err.includes("not the 0 you asked for") });
  }
  if (mode === "k2860") { // M-503 attest() action for the WRONG condition index
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }, { type: "attest", by: V1 }] }); }
    catch (e) { err = String(e.message || e); }
    let h = null, attErr = "";
    if (id) { try { h = await bull.attest(id); } catch (e) { attErr = String(e.message || e); } }
    push({ case: "K-2860 attest() server returns attest(id,1) action to victim V (not the index-1 arbiter V1) (M-503)", agreementId: id ? String(id) : null, createErr: err.slice(0, 200), sdkSentAttest: !!h, attThrew: attErr.slice(0, 300), txRevertedOnChain: attErr.includes("Transaction failed"), refusedBySdk: attErr.includes("Bull SDK safety check failed") });
  }
  if (mode === "k2861") { // M-504 refund(1) server returns refund tx for agreement 2
    let h = null, err = "";
    try { h = await bull.refund(1); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2861 refund(1) server returns refund tx for agreement 2 (M-504)", sdkSent: !!h, sdkThrew: err.slice(0, 300), refusedBySdkIdCheck: err.includes("Bull SDK safety check failed") && err.includes("not the 1 you asked for") });
  }
  if (mode === "k2862") { // M-505 claim() server returns createLock(attacker beneficiary) as the claim tx
    current.lockerAddr = MOCKLOCKER;
    const tokBal = async (who) => publicClient.readContract({ address: LOCKTOKEN, abi: erc20Abi, functionName: "balanceOf", args: [who] });
    const beforeA = await tokBal(A), beforeV = await tokBal(V);
    let txh = null, err = "";
    try { txh = await bull.claim(1, { locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const afterA = await tokBal(A), afterV = await tokBal(V);
    push({ case: "K-2862 claim(1) server returns createLock(token,1000,beneficiary=attacker) as claim tx (M-505)", sdkSent: !!txh, sdkThrew: err.slice(0, 300), txRevertedOnChain: err.includes("Transaction failed"), attackerGained: (afterA - beforeA).toString(), victimLost: (beforeV - afterV).toString(), noFundsMoved: (afterA - beforeA) === 0n && (beforeV - afterV) === 0n });
  }
  if (mode === "k2864") { // M-507 split_payment NO arbiter + NO afterHours
    let ids = null, err = "";
    try { ids = await bull.deal("split_payment", { payees: [A, S], shares: [1, 1], asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2864 deal(split_payment) NO arbiter + NO afterHours; server kind-0 now+24h (M-507)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refusedBySdkTimeCheck: err.includes("Bull SDK safety check failed") && err.includes("unlocks at another time") });
  }
  if (mode === "k2865") { // M-507 CONTROL: split_payment NO arbiter + afterHours=24
    let ids = null, err = "";
    try { ids = await bull.deal("split_payment", { payees: [A, S], shares: [1, 1], asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2865 deal(split_payment) CONTROL NO arbiter + afterHours=24; server kind-0 now+24h (M-507)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, sentBoth: !!ids && ids.length === 2 });
  }
  if (mode === "k2866") { // M-508 open() tx feeBps 250 but quote response claims 100
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, err = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { err = String(e.message || e); }
    let onChainFee = null, dealExists = false;
    try { const d = await readDeal(0); dealExists = d[0] !== ZERO; onChainFee = Number(d[12]); } catch {}
    push({ case: "K-2866 open() tx feeBps=250 but quote response feeBps=100 (M-508)", sdkSent: !!id, sdkThrew: err.slice(0, 400), dealId: id ? String(id) : null, dealExistsOnChain: dealExists, onChainFeeBps: onChainFee, threwPostCheckFeeMismatch: err.includes("different fee than the quote"), dealLeftUnfunded: dealExists && !id });
  }
  if (mode === "k2867") { // M-509 lock() startAt omitted; server lock starts now+365d
    current.lockerAddr = MOCKLOCKER;
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 30, durationDays: 365, stepDays: 30, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    let lockStart = null;
    if (lockId) {
      try {
        const l = await publicClient.readContract({ address: MOCKLOCKER, abi: parseAbi(["function locks(uint256) view returns (address token,address beneficiary,uint256 amount,uint64 start,uint64 cliff,uint64 end,uint64 step)"]), functionName: "locks", args: [BigInt(lockId)] });
        lockStart = Number(l[3]);
      } catch {}
    }
    push({ case: "K-2867 lock() startAt OMITTED; server lock starts now+365d (M-509)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, lockStart, startDelayedDays: lockStart !== null ? Math.round((lockStart - wall()) / 86400) : null, postCheckPassedSilently: !!lockId });
  }
  if (mode === "k2868") { // M-510 agree() honest conditions + NO expiryHours; server expiry now+100y (B-28 fold)
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", conditions: [{ type: "attest", by: ARB }] }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, rel = false, refBlocked = false;
    if (sent) {
      att = await tryCall(walletR, "attest", id);
      rel = await tryCall(walletA, "release", id);
      refBlocked = !(await tryCall(walletS, "refund", id));
    }
    const after = await bal(USDG, A);
    push({ case: "K-2868 agree() honest conditions + NO expiryHours; server expiry now+100y (M-510, B-28 fold)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, arbiterAttested: att, released: rel, refundBlocked100y: refBlocked, payeeGainedUsdg: usdg(after - before), releasePathIntact: sent && att && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2939") { // M-233 re-triage: claim(1) with vesting API 503 (MINOR 10)
    let txh = null, err = "";
    try { txh = await bull.claim(1, { locker: "0x1111111111111111111111111111111111111111" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2939 claim(1) with vesting API 503 (M-233 re-triage)", sdkSent: !!txh, sdkThrew: err.slice(0, 300), threwVestingNotLive: err.includes("Vesting is not live yet"), noTxSent: !txh });
  }
  if (mode === "k2940") { // M-293 family: milestones x2, stepHours=36, expiryHours OMITTED; server expiry now+72h/step
    let ids = null, err = "";
    try { ids = await bull.deal("milestones", { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 36, arbiter: ARB, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2940 deal(milestones x2) stepHours=36 expiryHours OMITTED; server expiry now+72h/step (M-293 family)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refusedAtStep1: err.includes("milestone 1") && err.includes("36 hours") });
  }
  if (mode === "k2941") { // M-582 open() self-deal: seller == buyer (V)
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentAs(walletV, V, 1000n * 10n ** 18n, 250000000000000000n, deadline, deadline + 3600);
    let id = null, err = "";
    try { id = await bull.open({ seller: V, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { err = String(e.message || e); }
    let onChain = null, dealExists = false;
    try { const d = await readDeal(0); dealExists = d[0] !== ZERO; onChain = { buyer: d[0], seller: d[1], sellAmount: d[3].toString(), payAmount: d[5].toString(), status: Number(d[9]) }; } catch {}
    push({ case: "K-2941 open() self-deal seller==buyer (M-582)", sdkSent: !!id, sdkThrew: err.slice(0, 400), dealId: id ? String(id) : null, dealExistsOnChain: dealExists, onChain, buyerIsSellerOnChain: dealExists && onChain.buyer.toLowerCase() === onChain.seller.toLowerCase() });
  }
  if (mode === "k2942") { // M-583 open() zero amounts (sell 0 / pay 0)
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentAs(walletR, ARB, 0n, 0n, deadline, deadline + 3600);
    let id = null, err = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "0", payAsset: "eth", payAmount: "0", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { err = String(e.message || e); }
    let onChain = null, dealExists = false;
    try { const d = await readDeal(0); dealExists = d[0] !== ZERO; onChain = { sellAmount: d[3].toString(), payAmount: d[5].toString(), status: Number(d[9]) }; } catch {}
    push({ case: "K-2942 open() zero amounts sell=0 pay=0 (M-583)", sdkSent: !!id, sdkThrew: err.slice(0, 400), dealId: id ? String(id) : null, txRevertedOnChain: err.includes("Transaction failed"), dealExistsOnChain: dealExists, onChain });
  }
  if (mode === "k2943") { // M-584 split_payment shares [1e15, 1]: second share is 0 micro
    const payerBefore = await bal(USDG, V);
    let ids = null, err = "";
    try { ids = await bull.deal("split_payment", { payees: [A, S], shares: [1000000000000000, 1], asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const payerAfter = await bal(USDG, V);
    push({ case: "K-2943 deal(split_payment) shares [1e15, 1] amount 500 (M-584)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, sentBoth: !!ids && ids.length === 2, txRevertedOnChain: err.includes("Transaction failed") || err.includes("Execution reverted"), payerLockedStep1Usdg: usdg(payerBefore - payerAfter) });
  }
  if (mode === "k2944") { // M-585 agree() conditions:[] EXPLICIT -> zero-condition agreement, instant release?
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [] }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let rel = false;
    if (sent) rel = await tryCall(walletA, "release", id);
    const after = await bal(USDG, A);
    push({ case: "K-2944 agree() conditions:[] explicit; zero-condition agreement releases immediately (M-585)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, releasedWithNoConditions: rel, payeeGainedUsdg: usdg(after - before), instantRelease: sent && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2945") { // M-586 agree() expiryHours=0; server returns expiry now+3600
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 0, conditions: [{ type: "attest", by: ARB }] }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2945 agree() expiryHours=0; server expiry now+3600 (M-586)", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refusedExpiryMismatch: err.includes("Bull SDK safety check failed") && err.includes("different expiry") });
  }
  if (mode === "k2946") { // M-587 deal() unknown template
    let id = null, err = "";
    try { id = await bull.deal("bogus_template", { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2946 deal(bogus_template) unknown template (M-587)", sdkSent: !!id, sdkThrew: err.slice(0, 300), threwBeforeSend: !id && (err.includes("unknown template") || err.includes("createAgreement steps")) });
  }
  if (mode === "k2947") { // M-588 agree() unknown condition type
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "bogus" }] }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2947 agree() unknown condition type bogus (M-588)", sdkSent: !!id, sdkThrew: err.slice(0, 300), threwClientSide: !id && err.includes("unknown condition type") });
  }
  if (mode === "k2948") { // M-589 milestones x2, server UNDER-pays [400, 50] of 500
    const payerBefore = await bal(USDG, V);
    let ids = null, err = "";
    try { ids = await bull.deal("milestones", { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 168, arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const payerAfter = await bal(USDG, V);
    push({ case: "K-2948 deal(milestones x2) server under-pays steps [400, 50] of 500 (M-589)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refusedAtStep2: err.includes("milestone 2") || err.includes("different amount"), payerLockedStep1Usdg: usdg(payerBefore - payerAfter) });
  }
  if (mode === "k2949") { // M-590 recurring x2, everyHours OMITTED; server kind-0 now+24h/48h
    let ids = null, err = "";
    try { ids = await bull.deal("recurring_payment", { payee: A, asset: "usdg", amount: "500", payments: 2, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2949 deal(recurring_payment x2) everyHours OMITTED; server kind-0 now+24h (M-590)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refusedAtStep1: err.includes("payment 1") && err.includes("another time") });
  }
  if (mode === "k2950") { // M-591 split_payment WITH arbiter; server returns kind-0 (no arbiter)
    let ids = null, err = "";
    try { ids = await bull.deal("split_payment", { payees: [A, S], shares: [1, 1], asset: "usdg", amount: "500", arbiter: ARB, afterHours: 24, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2950 deal(split_payment) arbiter passed; server kind-0 no arbiter (M-591)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refusedConditionMismatch: err.includes("Bull SDK safety check failed") && err.includes("condition") });
  }
  if (mode === "k2951") { // M-592 lock() durationDays OMITTED; server honest 365d lock
    current.lockerAddr = MOCKLOCKER;
    const tokBefore = await bal(LOCKTOKEN, V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 30, durationDays: undefined, stepDays: 30, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const tokAfter = await bal(LOCKTOKEN, V);
    push({ case: "K-2951 lock() durationDays OMITTED; server honest 365d lock (M-592)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, threwPostCheckAfterSend: !lockId && err.includes("different cliff, end or step"), victimTokensLocked: (tokBefore - tokAfter).toString() });
  }
  if (mode === "k2952") { // M-593 lock() startAt = now+30d; server lock starts now
    current.lockerAddr = MOCKLOCKER;
    const w = wall();
    const tokBefore = await bal(LOCKTOKEN, V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 30, durationDays: 365, stepDays: 30, startAt: String(w + 30 * 86400), locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const tokAfter = await bal(LOCKTOKEN, V);
    push({ case: "K-2952 lock() startAt now+30d; server lock starts now (M-593)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, threwPostCheckAfterSend: !lockId && err.includes("different cliff, end or step"), victimTokensLocked: (tokBefore - tokAfter).toString() });
  }
  if (mode === "k2953") { // M-594 lock() beneficiary = ZERO address (burn address)
    current.lockerAddr = MOCKLOCKER;
    const tokBefore = await bal(LOCKTOKEN, V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: ZERO, cliffDays: 30, durationDays: 365, stepDays: 30, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const tokAfter = await bal(LOCKTOKEN, V);
    let lockBeneficiary = null;
    if (lockId) {
      try {
        const l = await publicClient.readContract({ address: MOCKLOCKER, abi: parseAbi(["function locks(uint256) view returns (address token,address beneficiary,uint256 amount,uint64 start,uint64 cliff,uint64 end,uint64 step)"]), functionName: "locks", args: [BigInt(lockId)] });
        lockBeneficiary = l[1];
      } catch {}
    }
    push({ case: "K-2953 lock() beneficiary=0x0 burn address (M-594)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, lockBeneficiaryOnChain: lockBeneficiary, tokensLockedToZero: lockBeneficiary === ZERO ? (tokBefore - tokAfter).toString() : "0" });
  }
  if (mode === "k2954") { // M-595 waitSettled(): server claims cancelled, chain says open (M-416 variant)
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, err = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { err = String(e.message || e); }
    let waitErr = "";
    if (id) {
      try { await bull.waitSettled(0, { timeoutMs: 5000, everyMs: 500 }); } catch (e) { waitErr = String(e.message || e); }
    }
    let statusAfter = null;
    try { const d = await readDeal(0); statusAfter = Number(d[9]); } catch {}
    push({ case: "K-2954 waitSettled() server claims cancelled, chain says open (M-595, M-416 variant)", sdkSent: !!id, openErr: err.slice(0, 200), dealStatusOnChain: statusAfter, waitThrewMismatch: waitErr.includes("server says the deal is cancelled"), waitErr: waitErr.slice(0, 300) });
  }
  if (mode === "k2955") { // M-596 token_price_trigger re-grade: attest-by-ATTACKER (B-15 family)
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("token_price_trigger", { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "100", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, rel = false;
    if (sent) { att = await tryCall(walletA, "attest", id); rel = await tryCall(walletA, "release", id); }
    const after = await bal(USDG, A);
    push({ case: "K-2955 deal(token_price_trigger) server kind-1 attest-by-attacker (M-596, B-15 re-grade)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, attackerAttested: att, released: rel, payeeGainedUsdg: usdg(after - before), exploited: sent && att && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2956") { // M-597 fund() after the deal was cancelled
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, err = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { err = String(e.message || e); }
    let cancelled = false, fundErr = "";
    if (id) {
      try { const h = await walletV.writeContract({ address: ESCROW, abi: ESC_ABI, functionName: "cancel", args: [0n] }); await publicClient.waitForTransactionReceipt({ hash: h }); cancelled = true; } catch {}
      try { await bull.fund(0); } catch (e) { fundErr = String(e.message || e); }
    }
    let statusAfter = null;
    try { const d = await readDeal(0); statusAfter = Number(d[9]); } catch {}
    push({ case: "K-2956 fund(0) after deal cancelled (M-597)", sdkSent: !!id, openErr: err.slice(0, 200), cancelled, dealStatusAfterCancel: statusAfter, fundThrewNotOpen: fundErr.includes("deal is not open"), fundErr: fundErr.slice(0, 200) });
  }
  if (mode === "k2957") { // M-598 fund() by a stranger wallet (neither buyer nor seller)
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, err = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { err = String(e.message || e); }
    let fundErr = "";
    if (id) {
      const bullS = new Bull({ walletClient: walletS, publicClient, baseUrl: `http://127.0.0.1:${API_PORT}` });
      try { await bullS.fund(0); } catch (e) { fundErr = String(e.message || e); }
    }
    push({ case: "K-2957 fund(0) by stranger wallet (M-598)", sdkSent: !!id, openErr: err.slice(0, 200), fundThrewNotParty: fundErr.includes("neither the buyer nor the seller"), fundErr: fundErr.slice(0, 200) });
  }
  if (mode === "k2958") { // M-599 deal(DvP) deadlineHours=1464 (61d); server deadline +59d (M-486 family)
    const w = wall();
    current.stretchDeadline = w + 59 * 86400;
    current.stretchValidUntil = current.stretchDeadline + 3600;
    STRETCHED_SIG = await signConsentFor(current.stretchDeadline, current.stretchValidUntil);
    let id = null, err = "";
    try { id = await bull.deal("delivery_vs_payment", { seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 1464 }); }
    catch (e) { err = String(e.message || e); }
    let onChainDeadline = null, dealExists = false;
    try { const d = await readDeal(0); dealExists = d[0] !== ZERO; onChainDeadline = Number(d[6]); } catch {}
    push({ case: "K-2958 deal(DvP) deadlineHours=1464 asked; server deadline +59d (M-599, M-486 family)", sdkSent: !!id, sdkThrew: err.slice(0, 400), dealId: id ? String(id) : null, dealExistsOnChain: dealExists, onChainDeadline, askedDeadlineHours: 1464, stretchedToDays: dealExists && onChainDeadline !== null ? Math.round((onChainDeadline - w) / 86400) : null });
  }
  if (mode === "k2959") { // M-600 open() consent validUntil == deadline (boundary, allowed by design)
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline);
    let id = null, err = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline), deadline: String(deadline) }); }
    catch (e) { err = String(e.message || e); }
    let dealExists = false, onChainDeadline = null;
    try { const d = await readDeal(0); dealExists = d[0] !== ZERO; onChainDeadline = Number(d[6]); } catch {}
    push({ case: "K-2959 open() consent validUntil==deadline boundary (M-600)", sdkSent: !!id, sdkThrew: err.slice(0, 400), dealId: id ? String(id) : null, dealExistsOnChain: dealExists, onChainDeadline, askedDeadline: deadline });
  }
  // ================= MINOR 11 (M-762..M-781) =================
  if (mode === "k3121") { // M-762 agree() attest by the PAYEE (caller passed by=payee)
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: A }] }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, rel = false;
    if (sent) { att = await tryCall(walletA, "attest", id); rel = await tryCall(walletA, "release", id); }
    const after = await bal(USDG, A);
    push({ case: "K-3121 agree() attest by the PAYEE (caller passed by=payee) (M-762)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, payeeSelfAttested: att, released: rel, payeeGainedUsdg: usdg(after - before), selfAttestPays: sent && att && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k3122") { // M-763 agree() expiryHours=87600 (10y)
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 87600, conditions: [{ type: "attest", by: ARB }] }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let refundAt72h = null;
    if (sent) {
      await rpc("anvil_increaseTime", [72 * 3600 + 1]);
      await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]);
      refundAt72h = await tryCall(walletS, "refund", id);
    }
    push({ case: "K-3122 agree() expiryHours=87600 (10y); server expiry now+10y (M-763)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refundBlockedAt72h: refundAt72h === false, payerLocked10y: sent && refundAt72h === false });
  }
  if (mode === "k3123") { // M-764 scheduled_payment afterHours=8760 (1y)
    let id = null, err = "";
    try { id = await bull.deal("scheduled_payment", { payee: A, asset: "usdg", amount: "500", afterHours: 8760, expiryHours: 8784, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let relNow = null, refNow = null;
    if (sent) { relNow = await tryCall(walletA, "release", id); refNow = await tryCall(walletS, "refund", id); }
    push({ case: "K-3123 deal(scheduled_payment) afterHours=8760 (1y); server kind-0 now+8760h (M-764)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, unlockInHours: 8760, releaseBlockedNow: relNow === false, refundBlockedNow: refNow === false, payerLocked1y: sent && relNow === false && refNow === false });
  }
  if (mode === "k3124") { // M-765 scheduled_payment afterHours=0 (unlock now)
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("scheduled_payment", { payee: A, asset: "usdg", amount: "500", afterHours: 0, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let rel = false;
    if (sent) rel = await tryCall(walletA, "release", id);
    const after = await bal(USDG, A);
    push({ case: "K-3124 deal(scheduled_payment) afterHours=0; server kind-0 value=now (M-765)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, releasedImmediately: rel, payeeGainedUsdg: usdg(after - before), unlockNowAsAsked: sent && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k3125") { // M-766 panel quorum k=99 with 3 voters (B-23 data/value gap, opposite direction)
    const payerBefore = await bal(USDG, V);
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("panel", { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let vV = false, vA = false, vR = false, rel = false, refAt73h = false;
    if (sent) {
      vV = await tryCall(walletV, "vote", id); vA = await tryCall(walletA, "vote", id); vR = await tryCall(walletR, "vote", id);
      rel = await tryCall(walletA, "release", id);
      await rpc("anvil_increaseTime", [73 * 3600]);
      await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]);
      refAt73h = await tryCall(walletS, "refund", id);
    }
    const payerAfter = await bal(USDG, V);
    const after = await bal(USDG, A);
    push({ case: "K-3125 deal(panel) quorum k=99 with 3 voters [V,A,S] (M-766)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, votesCast: [vV, vA, vR].filter(Boolean).length, releaseBlocked: rel === false, payeeGainedUsdg: usdg(after - before), refundAt73h: refAt73h, payerRefundedWhole: refAt73h && payerAfter === payerBefore, txRevertedOnChain: err.includes("Transaction failed") || err.includes("Execution reverted"), contractEnforcesKLeVoters: !sent && (err.includes("Transaction failed") || err.includes("Execution reverted")) });
  }
  if (mode === "k3126") { // M-767 agree() conditions OMITTED; server kind-0 time_after=now (B-44 fold)
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let rel = false;
    if (sent) rel = await tryCall(walletA, "release", id);
    const after = await bal(USDG, A);
    push({ case: "K-3126 agree() conditions OMITTED; server kind-0 time_after=now (M-767, B-44 fold)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, releasedImmediately: rel, payeeGainedUsdg: usdg(after - before), noConditionCheckAtAll: sent && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k3127") { // M-768 deal(arbiter_escrow) feeWei=0.04 ETH (B-45 fold)
    const treasuryBefore = await publicClient.getBalance({ address: TREASURY });
    const payerEthBefore = await publicClient.getBalance({ address: V });
    let id = null, err = "";
    try { id = await bull.deal("arbiter_escrow", { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    const treasuryAfter = await publicClient.getBalance({ address: TREASURY });
    const payerEthAfter = await publicClient.getBalance({ address: V });
    push({ case: "K-3127 deal(arbiter_escrow) feeWei=0.04 ETH in createAgreement value (M-768, B-45 fold)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, treasuryGainedWei: (treasuryAfter - treasuryBefore).toString(), treasuryGainedEth: (Number(treasuryAfter - treasuryBefore) / 1e18).toFixed(4), payerPaidFeeWei: (payerEthBefore - payerEthAfter) >= 40000000000000000n, feeTakenWithoutCheck: sent && (treasuryAfter - treasuryBefore) === 40000000000000000n });
  }
  if (mode === "k3128") { // M-769 lock() cliffDays=400 > durationDays=365
    current.lockerAddr = MOCKLOCKER;
    const tokBefore = await bal(LOCKTOKEN, V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 400, durationDays: 365, stepDays: 30, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const tokAfter = await bal(LOCKTOKEN, V);
    let lock = null, claimableNow = null, claimable401d = null;
    if (lockId) {
      const LOCKER_READ = parseAbi(["function locks(uint256) view returns (address token,address beneficiary,uint256 amount,uint64 start,uint64 cliff,uint64 end,uint64 step)", "function claimable(uint256 id) view returns (uint256)"]);
      try {
        const l = await publicClient.readContract({ address: MOCKLOCKER, abi: LOCKER_READ, functionName: "locks", args: [BigInt(lockId)] });
        lock = { token: l[0], beneficiary: l[1], amount: l[2].toString(), start: Number(l[3]), cliff: Number(l[4]), end: Number(l[5]), step: Number(l[6]) };
        claimableNow = (await publicClient.readContract({ address: MOCKLOCKER, abi: LOCKER_READ, functionName: "claimable", args: [BigInt(lockId)] })).toString();
        await rpc("anvil_increaseTime", [401 * 86400]);
        await rpc("evm_mine", []); // increaseTime alone does not move the latest block's timestamp for reads
        claimable401d = (await publicClient.readContract({ address: MOCKLOCKER, abi: LOCKER_READ, functionName: "claimable", args: [BigInt(lockId)] })).toString();
      } catch (e) { err += " | readLock: " + String(e.message || e); }
    }
    push({ case: "K-3128 lock() cliffDays=400 > durationDays=365 (M-769)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, lock, claimableNow, claimableAfter401d: claimable401d, victimTokensLocked: (tokBefore - tokAfter).toString(), cliffAfterEnd: lock !== null && lock.cliff > lock.end, unlocksFullyAtCliff: claimable401d === (1000n * 10n ** 18n).toString() });
  }
  if (mode === "k3129") { // M-770 after_deal dealId=999 (nonexistent)
    const payerBefore = await bal(USDG, V);
    let id = null, err = "";
    try { id = await bull.deal("after_deal", { payee: A, asset: "usdg", amount: "500", dealId: 999, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let rel = null, refAt73h = false;
    if (sent) {
      rel = await tryCall(walletA, "release", id);
      await rpc("anvil_increaseTime", [73 * 3600]);
      await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]);
      refAt73h = await tryCall(walletS, "refund", id);
    }
    const payerAfter = await bal(USDG, V);
    push({ case: "K-3129 deal(after_deal) dealId=999 nonexistent (M-770)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, releaseBlocked: rel === false, refundAt73h: refAt73h, payerRefundedWhole: refAt73h && payerAfter === payerBefore, neverReleasable: sent && rel === false });
  }
  if (mode === "k3130") { // M-771 balance_trigger min=0 (trivially true); kind-7 leg expected dead (NotMet)
    let id = null, err = "";
    try { id = await bull.deal("balance_trigger", { payee: A, asset: "usdg", amount: "500", token: USDG, holder: H, min: "0", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let pokeOk = false, rel = null, metRaw = null;
    if (sent) {
      try {
        const data = "0x8029e7c0" + encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(id), 0n]).slice(2);
        const h = await walletV.sendTransaction({ to: AGREEMENT, data });
        await publicClient.waitForTransactionReceipt({ hash: h });
        pokeOk = true;
      } catch { pokeOk = false; }
      await rpc("anvil_increaseTime", [601]);
      try { const r = await publicClient.call({ to: AGREEMENT, data: "0x7bfa56d0" + encodeAbiParameters([{ type: "uint256" }], [BigInt(id)]).slice(2) }); metRaw = String(r.data || "").slice(0, 66); } catch { metRaw = null; }
      rel = await tryCall(walletA, "release", id);
    }
    push({ case: "K-3130 deal(balance_trigger) min=0, balanceOf(H)>=0 always true (M-771)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, pokeSent: pokeOk, metProbeRaw: metRaw, releaseAfterPokeWarp: rel, releaseBlockedNotMet: rel === false, kind7LegDead: sent && rel === false });
  }
  if (mode === "k3131") { // M-772 agree() amount=0
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "0", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }] }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-3131 agree() amount=0 (M-772)", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, txRevertedOnChain: err.includes("Transaction failed") || err.includes("Execution reverted"), noAgreementCreated: !id });
  }
  if (mode === "k3132") { // M-773 open() payAsset="btc" (invalid)
    let id = null, err = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "btc", payAmount: "0.25", deadlineHours: 24, sellerSig: "0x", validUntil: "0", deadline: "0" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-3132 open() payAsset=btc invalid (M-773)", sdkSent: !!id, sdkThrew: err.slice(0, 300), threwClientSide: !id && err.includes("payAsset must be eth or usdg"), noTxSent: !id });
  }
  if (mode === "k3133") { // M-774 lock() without locker
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 30, durationDays: 365, stepDays: 30 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-3133 lock() without locker (M-774)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), threwBeforeApiCall: !lockId && err.includes("pass { locker }"), noTxSent: !lockId });
  }
  if (mode === "k3134") { // M-775 optimistic windowHours=0 (caller asked zero window)
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("optimistic", { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 0 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let rel = false;
    if (sent) rel = await tryCall(walletA, "release", id);
    const after = await bal(USDG, A);
    push({ case: "K-3134 deal(optimistic) windowHours=0; server kind-5 value=now (M-775)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, releasedImmediately: rel, payeeGainedUsdg: usdg(after - before), zeroWindowAsAsked: sent && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k3135") { // M-776 consent() deadlineHours OMITTED; server returns 59-day deadline
    let r = null, err = "";
    try { r = await bull.consent({ buyer: S, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25" }); }
    catch (e) { err = String(e.message || e); }
    const w = wall();
    push({ case: "K-3135 consent() deadlineHours OMITTED; server deadline +59d (M-776)", sdkSent: !!r, sdkThrew: err.slice(0, 300), signed: !!r, deadlineDays: r ? Math.round((Number(r.deadline) - w) / 86400) : null, validUntilDays: r ? Math.round((Number(r.validUntil) - w) / 86400) : null, noDeadlinePinWhenOmitted: !!r && Math.round((Number(r.deadline) - w) / 86400) === 59 });
  }
  if (mode === "k3136") { // M-777 split_payment 1 micro, 10 payees (M-584 family)
    const payerBefore = await bal(USDG, V);
    let ids = null, err = "";
    try { ids = await bull.deal("split_payment", { payees: [A, S, V1, V2, V3, V4, V5, V6, V7, V8], shares: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], asset: "usdg", amount: "0.000001", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const payerAfter = await bal(USDG, V);
    push({ case: "K-3136 deal(split_payment) 1 micro, 10 payees, shares 1x10 (M-777, M-584 family)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, sentAll10: !!ids && ids.length === 10, txRevertedOnChain: err.includes("Transaction failed") || err.includes("Execution reverted"), payerLockedStep1RawUnits: (payerBefore - payerAfter).toString(), step1LockedStep2Reverted: !ids && (payerBefore - payerAfter) === 1n });
  }
  if (mode === "k3137") { // M-778 milestones x8, stepHours=1, expiryHours=72 (control)
    let ids = null, err = "";
    try { ids = await bull.deal("milestones", { payee: A, asset: "usdg", amount: "500", milestones: 8, stepHours: 1, expiryHours: 72, arbiter: ARB, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-3137 deal(milestones x8) stepHours=1 expiryHours=72 (M-778 control)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, sentAll8: !!ids && ids.length === 8 });
  }
  if (mode === "k3139") { // M-780 seller funds first, then seller cancels + refund
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, openErr = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { openErr = String(e.message || e); }
    let sellerFunded = false, fundErr = "", cancelled = false, sellerRefunded = false;
    if (id) {
      const mocks = JSON.parse(fs.readFileSync(path.join(ROOT, "mocks/MockERC20.json"), "utf8"));
      await walletV.writeContract({ address: LOCKTOKEN, abi: mocks.abi, functionName: "mint", args: [ARB, 1000n * 10n ** 18n] });
      const sellerBefore = await publicClient.readContract({ address: LOCKTOKEN, abi: erc20Abi, functionName: "balanceOf", args: [ARB] });
      const bullR = new Bull({ walletClient: walletR, publicClient, baseUrl: `http://127.0.0.1:${API_PORT}` });
      try { await bullR.fund(0); } catch (e) { fundErr = String(e.message || e); }
      try { const d = await readDeal(0); sellerFunded = d[8] === true; } catch {}
      cancelled = await tryEscrow(walletR, "cancel", 0);
      const sellerAfter = await publicClient.readContract({ address: LOCKTOKEN, abi: erc20Abi, functionName: "balanceOf", args: [ARB] });
      sellerRefunded = cancelled && sellerAfter === sellerBefore;
    }
    push({ case: "K-3139 fund(0) by SELLER first, then seller cancels (M-780)", sdkSent: !!id, openErr: openErr.slice(0, 200), sellerFunded, fundErr: fundErr.slice(0, 200), sellerCancelled: cancelled, sellerRefundedWhole: sellerRefunded });
  }
  if (mode === "k3140") { // M-781 receipt() message text does not match fields
    let j = null, err = "";
    try { j = await bull.receipt(1); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-3140 receipt() message text mismatches receipt fields (M-781)", sdkSent: !!j, sdkThrew: err.slice(0, 300), refusedTextMismatch: err.includes("receipt text does not match its fields"), noTxSent: !j });
  }
  if (mode === "kfe1") { // FE-C1 verification: milestones x2, stepHours=168, expiryHours=100; server expiry now+100h/step
    let ids = null, err = "";
    try { ids = await bull.deal("milestones", { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 168, expiryHours: 100, arbiter: ARB, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "FE-C1 milestones x2 stepHours=168 expiryHours=100; server expiry now+100h/step", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refusedAtStep1: err.includes("milestone 1") });
  }
  // ================= ROUND 32 (M-852..M-881, K-3202..K-3231) =================
  // Generic deal()/agree() executor: call spec from R32CALL, then run the
  // named probe (attest/vote + release, optional warp + refund) and record
  // balances. Special modes (open/lock/consent/release-swap) have their own
  // blocks below the table.
  const R32CALL = {
    k3202: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3203: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolRelease" },
    k3204: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "100", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "releaseOnly" },
    k3205: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "100", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "releaseOnly" },
    k3206: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3207: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3208: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3209: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: A, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolReleaseA" },
    k3210: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "veto", by: V, afterHours: 24 }, { type: "attest", by: ARB }] }, probe: "none" },
    k3211: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ZERO }] }, probe: "refund73" },
    k3212: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3213: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "refund2h" },
    k3214: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 168, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3215: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 8, stepHours: 168, expiryHours: 72, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3216: { fn: "deal", template: "recurring_payment", params: { payee: A, asset: "usdg", amount: "500", payments: 3, everyHours: 168, expiryHours: 72, terms: "Deliver the report" }, probe: "refund25h" },
    k3217: { fn: "deal", template: "split_payment", params: { payees: [A, S], shares: [1, 1], asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3218: { fn: "deal", template: "split_payment", params: { payees: [A, S], shares: [1, 1], arbiter: ARB, asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3219: { fn: "deal", template: "scheduled_payment", params: { payee: A, asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "releaseRefund73" },
    k3220: { fn: "deal", template: "price_trigger", params: { payee: A, asset: "usdg", amount: "500", target: USDG, data: "0x1234", value: "100", op: "gte", terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3221: { fn: "deal", template: "price_trigger", params: { payee: A, asset: "usdg", amount: "500", target: USDG, data: "0x1234", value: "100", op: "gte", terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3222: { fn: "deal", template: "balance_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, holder: H, min: "1000000", terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3223: { fn: "deal", template: "after_deal", params: { payee: A, asset: "usdg", amount: "500", dealId: 1, terms: "Deliver the report", expiryHours: 72 }, probe: "releaseRefund73" },
  };
  // ================= MINOR 12-A (M-942..M-971, K-3292..K-3321) =================
  const R12CALL = {
    k3292: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3293: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "vote2Release" },
    k3294: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3295: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: A, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolReleaseA" },
    k3296: { fn: "deal", template: "optimistic", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3297: { fn: "deal", template: "price_trigger", params: { payee: A, asset: "usdg", amount: "500", target: USDG, data: "0x1234", value: "100", op: "gte", terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3298: { fn: "deal", template: "balance_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, holder: H, min: "0", terms: "Deliver the report", expiryHours: 72 }, probe: "refund73" },
    k3299: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 168 }, probe: "refund25h" },
    k3300: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 6, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3301: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 100, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3302: { fn: "deal", template: "split_payment", params: { payees: [A, S, V1], shares: [1, 1, 1], asset: "usdg", amount: "600", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3303: { fn: "deal", template: "split_payment", params: { payees: [A, S], shares: [1, 1], asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3304: { fn: "deal", template: "recurring_payment", params: { payee: A, asset: "usdg", amount: "500", payments: 12, everyHours: 168, expiryHours: 72, terms: "Deliver the report" }, probe: "refund73" },
    k3305: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }, { type: "attest", by: ARB }] }, probe: "attest2Release" },
    k3309: { fn: "deal", template: "scheduled_payment", params: { payee: A, asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "releaseOnly" },
    k3310: { fn: "deal", template: "scheduled_payment", params: { payee: A, asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3311: { fn: "deal", template: "optimistic", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 1 }, probe: "none" },
    k3312: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 3, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3313: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3314: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3315: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolRelease" },
    k3316: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ZERO, terms: "Deliver the report", expiryHours: 72 }, probe: "refund73" },
    k3317: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 168, expiryHours: 72, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3321: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "0.000001", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
  };
  // ================= ROUND 33-A (M-1032..M-1061, K-3382..K-3411) =================
  const R33CALL = {
    k3382: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteReleaseV" },
    k3383: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "vote2Release" },
    k3384: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 1 }, probe: "coolRelease" },
    k3385: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 24 }, probe: "none" },
    k3386: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolRelease24h" },
    k3387: { fn: "deal", template: "optimistic", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 168 }, probe: "none" },
    k3388: { fn: "deal", template: "optimistic", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 24 }, probe: "none" },
    k3389: { fn: "deal", template: "balance_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, holder: A, min: "1000000", terms: "Deliver the report", expiryHours: 72 }, probe: "releaseOnly" },
    k3390: { fn: "deal", template: "price_trigger", params: { payee: A, asset: "usdg", amount: "500", target: USDG, data: "0x1234", value: "100", op: "gte", terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3391: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "0", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "attestRelease" },
    k3392: { fn: "deal", template: "after_deal", params: { payee: A, asset: "usdg", amount: "500", dealId: 1, terms: "Deliver the report", expiryHours: 72 }, probe: "releaseRefund73" },
    k3393: { fn: "deal", template: "after_deal", params: { payee: A, asset: "usdg", amount: "500", dealId: 0, terms: "Deliver the report", expiryHours: 72 }, probe: "releaseRefund73" },
    k3394: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 71, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3395: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 24, expiryHours: 72, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3396: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 168, expiryHours: 24, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3397: { fn: "deal", template: "recurring_payment", params: { payee: A, asset: "usdg", amount: "500", payments: 2, everyHours: 1, expiryHours: 72, terms: "Deliver the report" }, probe: "none" },
    k3398: { fn: "deal", template: "recurring_payment", params: { payee: A, asset: "usdg", amount: "500", payments: 12, everyHours: 8760, expiryHours: 72, terms: "Deliver the report" }, probe: "refund73" },
    k3399: { fn: "deal", template: "split_payment", params: { payees: [A, S, V1], shares: [1, 2, 3], asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3400: { fn: "deal", template: "split_payment", params: { payees: [A, S], shares: [999999, 1], asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3401: { fn: "deal", template: "scheduled_payment", params: { payee: A, asset: "usdg", amount: "500", afterHours: 168, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3403: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 1, conditions: [{ type: "attest", by: ARB }] }, probe: "none" },
    k3404: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }, { type: "attest", by: V1 }] }, probe: "none" },
    k3405: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }, { type: "veto", by: V, afterHours: 24 }] }, probe: "none" },
    k3406: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 24 }, probe: "refund25h" },
    k3411: { fn: "deal", template: "panel", params: { payee: S, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
  };
  // ================= MINOR 13-A (M-1122..M-1151, K-3472..K-3501) =================
  const M13CALL = {
    k3472: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 48, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3473: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 168 }, probe: "refund2h" },
    k3474: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "refund2h" },
    k3475: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "releaseOnly" },
    k3476: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "releaseOnly" },
    k3477: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 1 }, probe: "coolRelease" },
    k3478: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 2 }, probe: "none" },
    k3479: { fn: "deal", template: "optimistic", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 1 }, probe: "none" },
    k3480: { fn: "deal", template: "optimistic", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 24 }, probe: "none" },
    k3481: { fn: "deal", template: "scheduled_payment", params: { payee: A, asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3482: { fn: "deal", template: "scheduled_payment", params: { payee: A, asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3483: { fn: "deal", template: "balance_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, holder: H, min: "1", terms: "Deliver the report", expiryHours: 72 }, probe: "releaseOnly" },
    k3484: { fn: "deal", template: "price_trigger", params: { payee: A, asset: "usdg", amount: "500", target: USDG, data: "0x1234", value: "100", op: "lte", terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3485: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "1", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "attestRelease" },
    k3486: { fn: "deal", template: "after_deal", params: { payee: A, asset: "usdg", amount: "500", dealId: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "releaseRefund73" },
    k3487: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 24, expiryHours: 48, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3488: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 72, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3489: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 73, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3490: { fn: "deal", template: "recurring_payment", params: { payee: A, asset: "usdg", amount: "500", payments: 2, everyHours: 24, expiryHours: 72, terms: "Deliver the report" }, probe: "none" },
    k3491: { fn: "deal", template: "recurring_payment", params: { payee: A, asset: "usdg", amount: "500", payments: 12, everyHours: 1, expiryHours: 72, terms: "Deliver the report" }, probe: "none" },
    k3492: { fn: "deal", template: "split_payment", params: { payees: [A, S], shares: [1, 1], asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3493: { fn: "deal", template: "split_payment", params: { payees: [A, S], shares: [2, 1], asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3494: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }, { type: "veto", by: V, afterHours: 1 }] }, probe: "none" },
    k3495: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }, { type: "attest", by: V1 }, { type: "attest", by: V2 }] }, probe: "none" },
    k3496: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 168, conditions: [{ type: "attest", by: ARB }] }, probe: "none" },
  };
  // ================= MINOR 14-A (M-1302..M-1331, K-3652..K-3681) =================
  const M14CALL = {
    k3652: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 12, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3653: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 120, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3654: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 49, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3655: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3656: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "vote2Release" },
    k3657: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolRelease" },
    k3658: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "500", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "attestRelease" },
    k3659: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "999", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "attestRelease" },
    k3664: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 168 }, probe: "refund25h" },
    k3665: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 24, conditions: [{ type: "attest", by: ARB }] }, probe: "none" },
    k3666: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 24, expiryHours: 24, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3667: { fn: "deal", template: "optimistic", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 48 }, probe: "none" },
    k3668: { fn: "deal", template: "optimistic", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 48 }, probe: "none" },
    k3669: { fn: "deal", template: "scheduled_payment", params: { payee: A, asset: "usdg", amount: "500", afterHours: 168, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3670: { fn: "deal", template: "scheduled_payment", params: { payee: A, asset: "usdg", amount: "500", afterHours: 168, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3671: { fn: "deal", template: "balance_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, holder: A, min: "1", terms: "Deliver the report", expiryHours: 72 }, probe: "releaseOnly" },
    k3672: { fn: "deal", template: "price_trigger", params: { payee: A, asset: "usdg", amount: "500", target: USDG, data: "0x1234", value: "100", op: "gte", terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3673: { fn: "deal", template: "price_trigger", params: { payee: A, asset: "usdg", amount: "500", target: USDG, data: "0x1234", value: "100", op: "lte", terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3674: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 3, terms: "Deliver the report", expiryHours: 72 }, probe: "releaseOnly" },
    k3675: { fn: "deal", template: "after_deal", params: { payee: A, asset: "usdg", amount: "500", dealId: 0, terms: "Deliver the report", expiryHours: 72 }, probe: "releaseRefund73" },
    k3676: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 24 }, probe: "none" },
    k3677: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 1 }, probe: "none" },
    k3678: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }, { type: "veto", by: V, afterHours: 24 }] }, probe: "none" },
    k3679: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }, { type: "veto", by: ARB, afterHours: 1 }] }, probe: "none" },
  };
  // ================= ROUND 35-A (M-1392..M-1421, K-3742..K-3771) =================
  const R35CALL = {
    k3742: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3743: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "vote2Release" },
    k3744: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolRelease" },
    k3745: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "500", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "attestRelease" },
    k3751: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 60, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3754: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3755: { fn: "deal", template: "optimistic", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 1 }, probe: "none" },
    k3756: { fn: "deal", template: "scheduled_payment", params: { payee: A, asset: "usdg", amount: "500", afterHours: 168, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3757: { fn: "deal", template: "optimistic", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 1 }, probe: "none" },
    k3758: { fn: "deal", template: "price_trigger", params: { payee: A, asset: "usdg", amount: "500", target: USDG, data: "0x1234", value: "100", op: "gte", terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3759: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3760: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 0, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3761: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3762: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }, { type: "veto", by: V, afterHours: 24 }] }, probe: "none" },
    k3763: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "none" },
    k3765: { fn: "deal", template: "recurring_payment", params: { payee: A, asset: "usdg", amount: "500", payments: 13, everyHours: 24, expiryHours: 72, terms: "Deliver the report" }, probe: "none" },
    k3766: { fn: "deal", template: "split_payment", params: { payees: [A, S, V1], shares: [1, 1, 1], asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3767: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 3, stepHours: 168, expiryHours: 72, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3768: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 0 }, probe: "refund25h" },
    k3770: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "0", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
  };
  // ================= MINOR 15-A (M-1482..M-1511, K-3832..K-3861) =================
  const M15CALL = {
    k3843: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 96, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3849: { fn: "deal", template: "optimistic", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 1 }, probe: "none" },
    k3850: { fn: "deal", template: "scheduled_payment", params: { payee: A, asset: "usdg", amount: "500", afterHours: 168, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3851: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 3, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3854: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }] }, probe: "none" },
    k3856: { fn: "deal", template: "split_payment", params: { payees: [A, S, V1], shares: [1, 1, 1], asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3857: { fn: "deal", template: "recurring_payment", params: { payee: A, asset: "usdg", amount: "500", payments: 2, everyHours: 1, expiryHours: 72, terms: "Deliver the report" }, probe: "none" },
  };
  // ================= ROUND 36-A (M-1572..M-1601, K-3922..K-3951) =================
  const R36CALL = {
    k3923: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3924: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "vote2Release" },
    k3925: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolRelease" },
    k3926: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "500", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "attestRelease" },
    k3927: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 1 }, probe: "refund25h" },
    k3930: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 48, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k3931: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 1, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3932: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3933: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 1, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3934: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 12 }, probe: "refund13h" },
    k3935: { fn: "deal", template: "price_trigger", params: { payee: A, asset: "usdg", amount: "500", target: USDG, data: "0x1234", value: "100", op: "lte", terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3936: { fn: "deal", template: "price_trigger", params: { payee: A, asset: "usdg", amount: "500", target: USDG, data: "0x1234", value: "100", op: "gte", terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3938: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k3939: { fn: "deal", template: "optimistic", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 24 }, probe: "none" },
    k3940: { fn: "deal", template: "scheduled_payment", params: { payee: A, asset: "usdg", amount: "500", afterHours: 1, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3941: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }, { type: "veto", by: V, afterHours: 24 }] }, probe: "none" },
    k3942: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }] }, probe: "none" },
    k3943: { fn: "deal", template: "split_payment", params: { payees: [A, S], shares: [2, 1], asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
    k3944: { fn: "deal", template: "recurring_payment", params: { payee: A, asset: "usdg", amount: "500", payments: 12, everyHours: 24, expiryHours: 72, terms: "Deliver the report" }, probe: "none" },
  };
  // ================= ROUND 37-A (M-1752..M-1781, K-4102..K-4131) =================
  const R37CALL = {
    k4103: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k4104: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "vote2Release" },
    k4105: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolRelease" },
    k4106: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "500", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "attestRelease" },
    k4108: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 1 }, probe: "refund25h" },
    k4110: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 54, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
  };
  // ================= MINOR 17-A (M-1842..M-1871, K-4192..K-4221) =================
  const M17CALL = {
    k4196: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 60, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k4198: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k4199: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "vote2Release" },
    k4200: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolRelease" },
    k4201: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "500", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "attestRelease" },
    k4204: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 1 }, probe: "refund25h" },
    k4220: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
  };
  // ================= ROUND 39-A (M-1932..M-1961, K-4282..K-4311) =================
  const R38CALL = {
    k4285: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 60, expiryHours: 500, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k4288: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k4289: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "vote2Release" },
    k4290: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolRelease" },
    k4291: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "500", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "attestRelease" },
    k4294: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 1 }, probe: "refund25h" },
  };
  // ================= ROUND 39-A (M-2022..M-2051, K-4372..K-4401) =================
  const M18CALL = {
    k4376: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 60, expiryHours: 72, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k4379: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k4380: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "vote2Release" },
    k4381: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolRelease" },
    k4382: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "500", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "attestRelease" },
    k4385: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 1 }, probe: "refund25h" },
    // k4386 (B-48) is a quote() special mode, not a CALL spec — see below.
    k4399: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 72, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k4400: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ZERO }] }, probe: "none" },
  };
  // ================= ROUND 39-A (M-2112..M-2141, K-4462..K-4491) =================
  const R39CALL = {
    k4462: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
    k4463: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "vote2Release" },
    k4464: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolRelease" },
    k4465: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "500", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "attestRelease" },
    k4469: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 1 }, probe: "refund25h" },
    k4471: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 36, expiryHours: 72, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k4472: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 60, expiryHours: 120, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
    k4488: { fn: "deal", template: "scheduled_payment", params: { payee: A, asset: "usdg", amount: "500", afterHours: 0, terms: "Deliver the report", expiryHours: 72 }, probe: "releaseOnly" },
    k4489: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "none" },
  };
// ================= MINOR 19-A (M-2202..M-2231, K-4552..K-4581) =================
const M19CALL = {
  k4552: { fn: "deal", template: "panel", params: { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }, probe: "voteRelease" },
  k4553: { fn: "deal", template: "two_of_three", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 }, probe: "vote2Release" },
  k4554: { fn: "deal", template: "confirmed_with_cooling", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }, probe: "coolRelease" },
  k4555: { fn: "deal", template: "token_price_trigger", params: { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "500", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }, probe: "attestRelease" },
  k4559: { fn: "deal", template: "arbiter_escrow", params: { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 1 }, probe: "refund25h" },
  k4561: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 48, expiryHours: 72, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
  k4562: { fn: "deal", template: "milestones", params: { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 60, expiryHours: 168, arbiter: ARB, terms: "Deliver the report" }, probe: "none" },
  k4568: { fn: "deal", template: "recurring_payment", params: { payee: A, asset: "usdg", amount: "500", payments: 2, everyHours: 0, expiryHours: 72, terms: "Deliver the report" }, probe: "none" },
  k4569: { fn: "agree", params: { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: -1, conditions: [{ type: "attest", by: ARB }] }, probe: "none" },
  k4570: { fn: "deal", template: "scheduled_payment", params: { payee: A, asset: "usdg", amount: "500", afterHours: -1, terms: "Deliver the report", expiryHours: 72 }, probe: "releaseOnly" },
};

  if (M19CALL[mode] || R39CALL[mode] || M18CALL[mode] || R38CALL[mode] || M17CALL[mode] || M15CALL[mode] || R36CALL[mode] || R37CALL[mode] || R32CALL[mode] || R12CALL[mode] || R33CALL[mode] || M13CALL[mode] || M14CALL[mode] || R35CALL[mode]) {
    const spec = M19CALL[mode] || R39CALL[mode] || M18CALL[mode] || R38CALL[mode] || M17CALL[mode] || M15CALL[mode] || R36CALL[mode] || R37CALL[mode] || R32CALL[mode] || R12CALL[mode] || R33CALL[mode] || M13CALL[mode] || M14CALL[mode] || R35CALL[mode];
    const payerBefore = await bal(USDG, V);
    const before = await bal(USDG, A);
    const sBefore = await bal(USDG, S);
    let out = null, err = "";
    let ethBefore = null, nonceBefore = null, ethAfterSet = null;
    if (mode === "k4220" || mode === "k4489") { // M-1870 / M-2139: #preflight — wallet holds ~0.00001 ETH, deal needs 0.00005 reserve
      ethBefore = await publicClient.getBalance({ address: V });
      nonceBefore = await publicClient.getTransactionCount({ address: V });
      await rpc("anvil_setBalance", [V, "0xE8D4A51000"]); // 0.000001 ETH (1e12 wei) < 0.00005 GAS_RESERVE_WEI
      ethAfterSet = await publicClient.getBalance({ address: V });
    }
    try { out = spec.fn === "deal" ? await bull.deal(spec.template, spec.params) : await bull.agree(spec.params); }
    catch (e) { err = String(e.message || e); }
    const ids = out === null || out === undefined ? null : (Array.isArray(out) ? out.map(String) : [String(out)]);
    const first = ids ? ids[0] : null;
    let voted = null, voted2 = null, attested = null, attested2 = null, relEarly = null, rel = null, refunded = null, refundedEarly = null, relAt1h = null;
    if (first) {
      if (spec.probe === "voteRelease") { voted = await tryCall(walletA, "vote", first); rel = await tryCall(walletA, "release", first); }
      else if (spec.probe === "voteReleaseV") { voted = await tryCall(walletV, "vote", first); rel = await tryCall(walletA, "release", first); } // R33: voter is the payer V himself
      else if (spec.probe === "vote2Release") { await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]); voted = await tryCall(walletA, "vote", first); voted2 = await tryCall(walletS, "vote", first); rel = await tryCall(walletA, "release", first); } // S is not a default Anvil key — fund it first (cf. refund probes)
      else if (spec.probe === "attest2Release") { attested = await tryCall(walletR, "attest", first); attested2 = await tryCall(walletR, "attest", first, 1n); rel = await tryCall(walletA, "release", first); }
      else if (spec.probe === "attestRelease") { attested = await tryCall(walletA, "attest", first); rel = await tryCall(walletA, "release", first); }
      else if (spec.probe === "coolRelease" || spec.probe === "coolReleaseA") {
        attested = spec.probe === "coolRelease" ? await tryCall(walletR, "attest", first) : await tryCall(walletA, "attest", first);
        relEarly = await tryCall(walletA, "release", first);
        await rpc("anvil_increaseTime", [3601]); await rpc("anvil_setBalance", [A, "0x8ac7230489e80000"]); await rpc("evm_mine", []);
        rel = await tryCall(walletA, "release", first);
      }
      else if (spec.probe === "coolRelease24h") { // R33: cooling value 86400 (24h)
        attested = await tryCall(walletR, "attest", first);
        relEarly = await tryCall(walletA, "release", first);
        await rpc("anvil_increaseTime", [3601]); await rpc("anvil_setBalance", [A, "0x8ac7230489e80000"]); await rpc("evm_mine", []);
        relAt1h = await tryCall(walletA, "release", first);
        await rpc("anvil_increaseTime", [86401 - 3601]); await rpc("evm_mine", []);
        rel = await tryCall(walletA, "release", first);
      }
      else if (spec.probe === "releaseOnly") { rel = await tryCall(walletA, "release", first); }
      else if (spec.probe === "refund73" || spec.probe === "releaseRefund73") {
        if (spec.probe === "releaseRefund73") rel = await tryCall(walletA, "release", first);
        await rpc("anvil_increaseTime", [73 * 3600]); await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]); await rpc("evm_mine", []);
        refunded = await tryCall(walletS, "refund", first);
      }
      else if (spec.probe === "refund2h") { await rpc("anvil_increaseTime", [2 * 3600]); await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]); await rpc("evm_mine", []); refunded = await tryCall(walletS, "refund", first); }
      else if (spec.probe === "refund25h") { await rpc("anvil_increaseTime", [25 * 3600]); await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]); await rpc("evm_mine", []); refunded = await tryCall(walletS, "refund", first); }
      else if (spec.probe === "refund13h") { await rpc("anvil_increaseTime", [12 * 3600]); await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]); await rpc("evm_mine", []); refundedEarly = await tryCall(walletS, "refund", first); await rpc("anvil_increaseTime", [3600]); await rpc("evm_mine", []); refunded = await tryCall(walletS, "refund", first); }
    }
    const payerAfter = await bal(USDG, V);
    const after = await bal(USDG, A);
    const sAfter = await bal(USDG, S);
    const nonceAfter = (mode === "k4220" || mode === "k4489") ? await publicClient.getTransactionCount({ address: V }) : null;
    push({ case: `K-${mode.slice(1)} R32 ${spec.fn === "deal" ? `deal(${spec.template})` : "agree()"} probe=${spec.probe}`, sdkSent: !!out, sdkThrew: err.slice(0, 300), agreementIds: ids, attackerVoted: voted, attackerVoted2: voted2, attackerAttested: attested, attackerAttested2: attested2, releaseBlockedEarly: relEarly === false, releaseBlockedAt1h: relAt1h === false, released: rel, refunded, refundBlockedAt12h: refundedEarly === false, payeeGainedUsdg: usdg(after - before), payeeSGainedUsdg: usdg(sAfter - sBefore), payerRefundedWhole: refunded === true && payerAfter === payerBefore, txRevertedOnChain: err.includes("Transaction failed") || err.includes("Execution reverted"), refusedBySdk: err.includes("Bull SDK safety check failed"), preflightEthBefore: ethBefore ? ethBefore.toString() : null, preflightEthAfterSet: ethAfterSet ? ethAfterSet.toString() : null, preflightThrewNeedEth: err.includes("Need at least") && err.includes("Nothing was sent"), preflightNoTxSent: nonceBefore !== null && nonceAfter !== null && nonceAfter === nonceBefore });
  }
  if (mode === "k3224" || mode === "k3225" || mode === "k3226") { // M-874/M-875/M-876 open() variants
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, err = "";
    try {
      const params = { seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) };
      if (mode === "k3225") params.buyerReceive = A;
      id = await bull.open(params);
    } catch (e) { err = String(e.message || e); }
    let onChain = null;
    try { const d = await readDeal(0); onChain = { buyerReceive: d[11], sellerPayout: d[10], feeBps: d[12], deadline: Number(d[6]) }; } catch {}
    push({ case: mode === "k3224" ? "K-3224 open() server swaps sellerPayout -> attacker (M-874)" : mode === "k3225" ? "K-3225 open() caller asks buyerReceive=attacker (M-875)" : "K-3226 open() quote omits feeBps, tx carries 250 (M-876)", sdkSent: !!id, sdkThrew: err.slice(0, 400), dealId: id ? String(id) : null, onChain, refusedBySdk: err.includes("Bull SDK safety check failed"), escrowAccepted: !!id });
  }
  if (mode === "k3227" || mode === "k3228") { // M-877/M-878 consent() variants
    let r = null, err = "";
    try { r = await bull.consent({ buyer: S, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24 }); }
    catch (e) { err = String(e.message || e); }
    const w = wall();
    push({ case: mode === "k3227" ? "K-3227 consent() validUntil == deadline boundary (M-877)" : "K-3228 consent() server swaps seller -> attacker in typedData (M-878)", sdkSent: !!r, sdkThrew: err.slice(0, 300), signed: !!r, validUntilEqDeadline: !!r && Number(r.validUntil) === Number(r.deadline), deadlineDays: r ? Math.round((Number(r.deadline) - w) / 86400) : null, refusedBySdk: err.includes("Bull SDK safety check failed") });
  }
  if (mode === "k3229" || mode === "k3230") { // M-879/M-880 lock() variants
    current.lockerAddr = MOCKLOCKER;
    const tokBefore = await bal(LOCKTOKEN, V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: mode === "k3229" ? A : S, cliffDays: 30, durationDays: 365, stepDays: 30, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const tokAfter = await bal(LOCKTOKEN, V);
    let lock = null;
    if (lockId) {
      const LOCKER_READ = parseAbi(["function locks(uint256) view returns (address token,address beneficiary,uint256 amount,uint64 start,uint64 cliff,uint64 end,uint64 step)"]);
      try { const l = await publicClient.readContract({ address: MOCKLOCKER, abi: LOCKER_READ, functionName: "locks", args: [BigInt(lockId)] }); lock = { token: l[0], beneficiary: l[1], amount: l[2].toString(), start: Number(l[3]), cliff: Number(l[4]), end: Number(l[5]), step: Number(l[6]) }; } catch (e) { err += " | readLock: " + String(e.message || e); }
    }
    const w = wall();
    push({ case: mode === "k3229" ? "K-3229 lock() caller names beneficiary=attacker (M-879)" : "K-3230 lock() start +365d, caller omitted startAt (M-880, B-26 fold)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, lock, victimTokensLocked: (tokBefore - tokAfter).toString(), startInDays: lock ? Math.round((lock.start - w) / 86400) : null, beneficiaryIsAttacker: lock ? lock.beneficiary.toLowerCase() === A.toLowerCase() : null });
  }
  if (mode === "k3231") { // M-881 release() server swaps release -> refund tx
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }] }); }
    catch (e) { err = String(e.message || e); }
    let relErr = "", relTx = null;
    if (id) { try { relTx = await bull.release(id); } catch (e) { relErr = String(e.message || e); } }
    const after = await bal(USDG, A);
    push({ case: "K-3231 release() server returns a refund() tx instead of release() (M-881)", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, releaseTx: relTx, releaseErr: relErr.slice(0, 300), refusedBySdkFnCheck: relErr.includes("Bull SDK safety check failed"), payeeGainedUsdg: usdg(after - before) });
  }
  // ================= MINOR 12-A special modes =================
  if (mode === "k3306") { // M-956 consent() server validUntil < deadline (1h vs 24h)
    let r = null, err = "";
    try { r = await bull.consent({ buyer: S, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24 }); }
    catch (e) { err = String(e.message || e); }
    const w = wall();
    push({ case: "K-3306 consent() server validUntil=deadline-23h (M-956)", sdkSent: !!r, sdkThrew: err.slice(0, 300), signed: !!r, validUntilBeforeDeadline: !!r && Number(r.validUntil) < Number(r.deadline), deadlineDays: r ? Math.round((Number(r.deadline) - w) / 86400) : null, refusedBySdk: err.includes("Bull SDK safety check failed") });
  }
  if (mode === "k3307") { // M-957 open() deadline stretch 24h->72h (M-412 family re-confirm)
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, err = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { err = String(e.message || e); }
    let onChainDeadline = null, dealExists = false;
    try { const d = await readDeal(0); dealExists = d[0] !== ZERO; onChainDeadline = Number(d[6]); } catch {}
    push({ case: "K-3307 open() server stretches deadline 24h->72h (M-957)", sdkSent: !!id, sdkThrew: err.slice(0, 400), dealId: id ? String(id) : null, escrowReverted: err.toLowerCase().includes("revert"), dealExistsOnChain: dealExists, onChainDeadline, askedDeadline: deadline, stretched: dealExists && onChainDeadline !== null && Math.abs(onChainDeadline - deadline) > 60 });
  }
  if (mode === "k3318") { // M-968 waitSettled(0): server says settled, chain says none
    let s = null, err = "";
    try { s = await bull.waitSettled(0, { timeoutMs: 5000, everyMs: 1000 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-3318 waitSettled(0) server says settled, chain disagrees (M-968)", sdkSent: !!s, sdkThrew: err.slice(0, 300), refusedChainMismatch: err.includes("the chain does not") });
  }
  if (mode === "k3319") { // M-969 receipt() server receipt is for deal 2, caller asked 1
    let j = null, err = "";
    try { j = await bull.receipt(1); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-3319 receipt(1) server returns receipt for deal 2 (M-969)", sdkSent: !!j, sdkThrew: err.slice(0, 300), refusedDealMismatch: err.includes("deal") });
  }
  if (mode === "k3320") { // M-970 lock() server swaps beneficiary -> ZERO (burn)
    current.lockerAddr = MOCKLOCKER;
    const tokBefore = await bal(LOCKTOKEN, V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 30, durationDays: 365, stepDays: 30, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const tokAfter = await bal(LOCKTOKEN, V);
    let lock = null;
    if (lockId) {
      const LOCKER_READ = parseAbi(["function locks(uint256) view returns (address token,address beneficiary,uint256 amount,uint64 start,uint64 cliff,uint64 end,uint64 step)"]);
      try { const l = await publicClient.readContract({ address: MOCKLOCKER, abi: LOCKER_READ, functionName: "locks", args: [BigInt(lockId)] }); lock = { token: l[0], beneficiary: l[1], amount: l[2].toString(), start: Number(l[3]), cliff: Number(l[4]), end: Number(l[5]), step: Number(l[6]) }; } catch (e) { err += " | readLock: " + String(e.message || e); }
    }
    push({ case: "K-3320 lock() server swaps beneficiary S -> ZERO (M-970)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, lock, victimTokensLocked: (tokBefore - tokAfter).toString(), beneficiaryIsZero: lock ? lock.beneficiary.toLowerCase() === ZERO.toLowerCase() : null, refusedBySdk: err.includes("Bull SDK safety check failed") });
  }
  // ================= ROUND 33-A special modes =================
  if (mode === "k3402") { // M-1052 scheduled_payment afterHours=24, expiryHours=24 (expiry == unlock, B-38 boundary)
    // PRECISE boundary test: read the exact on-chain condition value + expiry
    // from the creation tx, then mine the release tx as the next block at
    // exactly that timestamp (anvil_setNextBlockTimestamp, no evm_mine first —
    // a plain increaseTime(24h) overshoots by the real seconds spent in the
    // SDK calls, which is a clock-drift artefact, not the boundary).
    const before = await bal(USDG, A);
    const payerBefore = await bal(USDG, V);
    let id = null, err = "";
    try { id = await bull.deal("scheduled_payment", { payee: A, asset: "usdg", amount: "500", afterHours: 24, terms: "Deliver the report", expiryHours: 24 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let condValue = null, expiryOnChain = null, relAtExactly = null, relAtPlus1s = null, refundAfter = null;
    if (sent) {
      const fn = await lastAgrTxData();
      if (fn) { condValue = Number(fn.args[0].conditions[0].value); expiryOnChain = Number(fn.args[0].expiry); }
      await rpc("anvil_setNextBlockTimestamp", [condValue]);
      relAtExactly = await tryCall(walletA, "release", id);
      if (!relAtExactly) {
        await rpc("anvil_setNextBlockTimestamp", [condValue + 1]);
        relAtPlus1s = await tryCall(walletA, "release", id);
      }
      await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]);
      await rpc("anvil_setNextBlockTimestamp", [condValue + 2]);
      refundAfter = await tryCall(walletS, "refund", id);
    }
    const payerAfter = await bal(USDG, V);
    const after = await bal(USDG, A);
    push({ case: "K-3402 deal(scheduled_payment) afterHours=24 expiryHours=24, expiry == unlock (M-1052, B-38 boundary, precise)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, condValue, expiryOnChain, expiryEqUnlock: condValue !== null && condValue === expiryOnChain, releasedAtExactlyUnlock: relAtExactly, releasedAtUnlockPlus1s: relAtPlus1s, refundedAfter: refundAfter, payeeGainedUsdg: usdg(after - before), payerRefundedWhole: refundAfter === true && payerAfter === payerBefore, deadOnArrival: sent && relAtExactly === false && relAtPlus1s === false });
  }
  if (mode === "k3407") { // M-1057 arbiter_escrow expiryHours=23 asked, server now+24h (B-46 stretch)
    const payerBefore = await bal(USDG, V);
    let id = null, err = "";
    try { id = await bull.deal("arbiter_escrow", { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 23 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let refundAt23h = null, refundAt24h = null;
    if (sent) {
      await rpc("anvil_increaseTime", [23 * 3600]); await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]); await rpc("evm_mine", []);
      refundAt23h = await tryCall(walletS, "refund", id);
      await rpc("anvil_increaseTime", [3601]); await rpc("evm_mine", []);
      refundAt24h = await tryCall(walletS, "refund", id);
    }
    const payerAfter = await bal(USDG, V);
    push({ case: "K-3407 deal(arbiter_escrow) expiryHours=23 asked, server expiry now+24h (M-1057, B-46 stretch)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refundBlockedAt23h: refundAt23h === false, refundSucceededAt24h: refundAt24h === true, payerRefundedWhole: refundAt24h === true && payerAfter === payerBefore, lockStretched23hTo24h: sent && refundAt23h === false && refundAt24h === true });
  }
  if (mode === "k3408" || mode === "k3409" || mode === "k3497" || mode === "k3498" || mode === "k3680" || mode === "k3769" || mode === "k3858" || mode === "k3945") { // M-1058/M-1059 + M-1147 open() quote 0 vs tx 250 / M-1148 open() payAmount grow 0.25 -> 0.26 ETH / M-1330 open() payAmount shrink 0.25 -> 0.24 ETH / M-1419 open() deadline 1441h (>60d max) / M-1508 open() deadline 1440h (exactly 60d max) / M-1595 open() deadline 1h (minimum)
    const w = wall();
    const deadline = mode === "k3769" ? w + 1441 * 3600 : mode === "k3858" ? w + 1440 * 3600 : mode === "k3945" ? w + 3600 : w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, err = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: mode === "k3769" ? 1441 : mode === "k3858" ? 1440 : mode === "k3945" ? 1 : 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { err = String(e.message || e); }
    let onChain = null, dealExists = false;
    try { const d = await readDeal(0); dealExists = d[0] !== ZERO; onChain = { payAmount: d[5].toString(), feeBps: Number(d[12]), deadline: Number(d[6]) }; } catch {}
    push({ case: mode === "k3408" ? "K-3408 open() server shrinks payAmount 0.25 -> 0.245 ETH in createDeal (M-1058)" : mode === "k3497" ? "K-3497 open() tx feeBps=250 but quote response feeBps=0 (M-1147, mirror M-1059)" : mode === "k3498" ? "K-3498 open() server grows payAmount 0.25 -> 0.26 ETH in createDeal (M-1148)" : mode === "k3680" ? "K-3680 open() server shrinks payAmount 0.25 -> 0.24 ETH in createDeal (M-1330)" : mode === "k3769" ? "K-3769 open() deadlineHours=1441 (60d+1h, over 60d max) (M-1419)" : mode === "k3858" ? "K-3858 open() deadlineHours=1440 (exactly 60d max) (M-1508)" : mode === "k3945" ? "K-3945 open() deadlineHours=1 (minimum, 1h) (M-1595)" : "K-3409 open() tx feeBps=0 but quote response feeBps=250 (M-1059)", sdkSent: !!id, sdkThrew: err.slice(0, 400), dealId: id ? String(id) : null, dealExistsOnChain: dealExists, onChain, refusedBySdkPreCheck: err.includes("Bull SDK safety check failed") && err.includes("other terms"), threwPostCheckFeeMismatch: err.includes("different fee than the quote"), dealLeftUnfunded: dealExists && !id, refusedUnreasonableDeadline: err.includes("unreasonable deadline") });
  }
  if (mode === "k3410") { // M-1060 lock() server backdates start 365d (B-26 family)
    current.lockerAddr = MOCKLOCKER;
    const tokBefore = await bal(LOCKTOKEN, V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 30, durationDays: 365, stepDays: 30, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const tokAfter = await bal(LOCKTOKEN, V);
    let lock = null;
    if (lockId) {
      const LOCKER_READ = parseAbi(["function locks(uint256) view returns (address token,address beneficiary,uint256 amount,uint64 start,uint64 cliff,uint64 end,uint64 step)", "function claimable(uint256 id) view returns (uint256)"]);
      try {
        const l = await publicClient.readContract({ address: MOCKLOCKER, abi: LOCKER_READ, functionName: "locks", args: [BigInt(lockId)] });
        lock = { token: l[0], beneficiary: l[1], amount: l[2].toString(), start: Number(l[3]), cliff: Number(l[4]), end: Number(l[5]), step: Number(l[6]) };
      } catch (e) { err += " | readLock: " + String(e.message || e); }
    }
    const w = wall();
    push({ case: "K-3410 lock() server backdates start 365d, caller omitted startAt (M-1060, B-26 fold)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, lock, victimTokensLocked: (tokBefore - tokAfter).toString(), startInDays: lock ? Math.round((lock.start - w) / 86400) : null, startBackdated: lock ? lock.start < w - 300 * 86400 : null });
  }
  if (mode === "k3499") { // M-1149 lock() cliffDays=0 (cliff == start), caller asked
    current.lockerAddr = MOCKLOCKER;
    const tokBefore = await bal(LOCKTOKEN, V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 0, durationDays: 365, stepDays: 30, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const tokAfter = await bal(LOCKTOKEN, V);
    let lock = null;
    if (lockId) {
      const LOCKER_READ = parseAbi(["function locks(uint256) view returns (address token,address beneficiary,uint256 amount,uint64 start,uint64 cliff,uint64 end,uint64 step)"]);
      try { const l = await publicClient.readContract({ address: MOCKLOCKER, abi: LOCKER_READ, functionName: "locks", args: [BigInt(lockId)] }); lock = { token: l[0], beneficiary: l[1], amount: l[2].toString(), start: Number(l[3]), cliff: Number(l[4]), end: Number(l[5]), step: Number(l[6]) }; } catch (e) { err += " | readLock: " + String(e.message || e); }
    }
    const w = wall();
    push({ case: "K-3499 lock() cliffDays=0 (cliff == start), caller asked (M-1149)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, lock, victimTokensLocked: (tokBefore - tokAfter).toString(), cliffEqStart: lock ? lock.cliff === lock.start : null, startInDays: lock ? Math.round((lock.start - w) / 86400) : null });
  }
  if (mode === "k3500") { // M-1150 lock() caller names beneficiary=ZERO (burn), cf. M-879 BELOW BAR
    current.lockerAddr = MOCKLOCKER;
    const tokBefore = await bal(LOCKTOKEN, V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: ZERO, cliffDays: 30, durationDays: 365, stepDays: 30, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const tokAfter = await bal(LOCKTOKEN, V);
    let lock = null;
    if (lockId) {
      const LOCKER_READ = parseAbi(["function locks(uint256) view returns (address token,address beneficiary,uint256 amount,uint64 start,uint64 cliff,uint64 end,uint64 step)"]);
      try { const l = await publicClient.readContract({ address: MOCKLOCKER, abi: LOCKER_READ, functionName: "locks", args: [BigInt(lockId)] }); lock = { token: l[0], beneficiary: l[1], amount: l[2].toString(), start: Number(l[3]), cliff: Number(l[4]), end: Number(l[5]), step: Number(l[6]) }; } catch (e) { err += " | readLock: " + String(e.message || e); }
    }
    push({ case: "K-3500 lock() caller names beneficiary=ZERO (burn) (M-1150)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, lock, victimTokensLocked: (tokBefore - tokAfter).toString(), beneficiaryIsZero: lock ? lock.beneficiary.toLowerCase() === ZERO.toLowerCase() : null });
  }
  if (mode === "k3501") { // M-1151 re-triage: claim(1) with vesting API 503 (M-233, Minor 13)
    let txh = null, err = "";
    try { txh = await bull.claim(1, { locker: "0x1111111111111111111111111111111111111111" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-3501 claim(1) with vesting API 503 (M-233 re-triage, Minor 13)", sdkSent: !!txh, sdkThrew: err.slice(0, 300), threwVestingNotLive: err.includes("Vesting is not live yet"), noTxSent: !txh });
  }
  if (mode === "k3660") { // M-1310 re-triage: claim(1) with vesting API 503 (M-233, Minor 14)
    let txh = null, err = "";
    try { txh = await bull.claim(1, { locker: "0x1111111111111111111111111111111111111111" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-3660 claim(1) with vesting API 503 (M-233 re-triage, Minor 14)", sdkSent: !!txh, sdkThrew: err.slice(0, 300), threwVestingNotLive: err.includes("Vesting is not live yet"), noTxSent: !txh });
  }
  if (mode === "k3681") { // M-1331 lock() stepDays=400 > durationDays=365, caller asked
    current.lockerAddr = MOCKLOCKER;
    const tokBefore = await bal(LOCKTOKEN, V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 30, durationDays: 365, stepDays: 400, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const tokAfter = await bal(LOCKTOKEN, V);
    let lock = null;
    if (lockId) {
      const LOCKER_READ = parseAbi(["function locks(uint256) view returns (address token,address beneficiary,uint256 amount,uint64 start,uint64 cliff,uint64 end,uint64 step)"]);
      try { const l = await publicClient.readContract({ address: MOCKLOCKER, abi: LOCKER_READ, functionName: "locks", args: [BigInt(lockId)] }); lock = { token: l[0], beneficiary: l[1], amount: l[2].toString(), start: Number(l[3]), cliff: Number(l[4]), end: Number(l[5]), step: Number(l[6]) }; } catch (e) { err += " | readLock: " + String(e.message || e); }
    }
    const w = wall();
    push({ case: "K-3681 lock() stepDays=400 > durationDays=365, caller asked (M-1331)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, lock, victimTokensLocked: (tokBefore - tokAfter).toString(), stepGtDuration: lock ? (lock.step - lock.start) > (lock.end - lock.start) : null, startInDays: lock ? Math.round((lock.start - w) / 86400) : null });
  }
  if (mode === "k3747") { // M-1397 re-triage: claim(1) with vesting API 503 (M-233, Round 35)
    let txh = null, err = "";
    try { txh = await bull.claim(1, { locker: "0x1111111111111111111111111111111111111111" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-3747 claim(1) with vesting API 503 (M-233 re-triage, Round 35)", sdkSent: !!txh, sdkThrew: err.slice(0, 300), threwVestingNotLive: err.includes("Vesting is not live yet"), noTxSent: !txh });
  }
  if (mode === "k4111") { // M-1761 re-triage: claim(1) with vesting API 503 (M-233, Round 37)
    let txh = null, err = "";
    try { txh = await bull.claim(1, { locker: "0x1111111111111111111111111111111111111111" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-4111 claim(1) with vesting API 503 (M-233 re-triage, Round 37)", sdkSent: !!txh, sdkThrew: err.slice(0, 300), threwVestingNotLive: err.includes("Vesting is not live yet"), noTxSent: !txh });
  }
  // ================= MINOR 17-A special modes =================
  if (mode === "k4195") { // M-1845 re-triage: claim(1) with vesting API 503 (M-233, Minor 17; live still 503)
    let txh = null, err = "";
    try { txh = await bull.claim(1, { locker: "0x1111111111111111111111111111111111111111" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-4195 claim(1) with vesting API 503 (M-233 re-triage, Minor 17)", sdkSent: !!txh, sdkThrew: err.slice(0, 300), threwVestingNotLive: err.includes("Vesting is not live yet"), noTxSent: !txh });
  }
  if (mode === "k4197") { // M-1847 FE-OR1: same-kind quote with output token OMITTED / WRONG / OK
    const tryQuote = async (qc) => {
      current.quoteCase = qc;
      let q = null, err = "";
      try { q = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "25" }); }
      catch (e) { err = String(e.message || e); }
      return { q, err };
    };
    const omitted = await tryQuote("out-token-omitted");
    const wrong = await tryQuote("out-token-wrong");
    const ok = await tryQuote("out-token-ok");
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4197 bridge.quote output-token check is presence-conditional (FE-OR1, M-1847)", omittedTokenResolved: !!omitted.q, omittedQuoteId: omitted.q?.id ?? null, omittedToToken: omitted.q?.to?.token ?? null, omittedErr: omitted.err.slice(0, 200), wrongTokenRejected: wrong.err.includes("another currency than you asked for"), wrongMsg: wrong.err.slice(0, 200), okTokenResolved: !!ok.q, okToToken: ok.q?.to?.token ?? null, nonceAfter: String(nonceAfter), zeroTxSent: true, sendNotExecuted: "bridge.send needs a Base-chain Bull instance + live Relay delivery; the gate under test (checkBridge) is shared by quote() and send()" });
  }
  if (mode === "k4205") { // M-1855 B-48 re-grade on SDK b6e7d25c: spender-bypass quote must still resolve; control must still reject
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    current.quoteCase = "spender-bypass";
    let bypassOut = null, bypassErr = "";
    try { bypassOut = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "25" }); }
    catch (e) { bypassErr = String(e.message || e); }
    current.quoteCase = "spender-control";
    let controlErr = "";
    try { await bull.bridge.quote({ from: "base", to: "robinhood", amount: "25" }); }
    catch (e) { controlErr = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    const apprStep = bypassOut?.steps?.[0]?.transaction;
    push({ case: "K-4205 bridge.quote spender-bypass: approve(spender=attacker) + step targeting attacker PASSES checkBridge (M-1855, B-48 re-grade)", bypassResolved: !!bypassOut, bypassQuoteId: bypassOut?.id ?? null, approveSpenderIsAttacker: !!apprStep && String(apprStep.data || "").slice(34, 74).toLowerCase() === A.slice(2).toLowerCase(), approveTargetIsToken: !!apprStep && String(apprStep.to).toLowerCase() === "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase(), secondStepTargetsAttacker: bypassOut?.steps?.[1]?.transaction?.to ? String(bypassOut.steps[1].transaction.to).toLowerCase() === A.toLowerCase() : false, bypassErr: bypassErr.slice(0, 200), controlRejected: controlErr.includes("spender that is not the target"), controlMsg: controlErr.slice(0, 200), nonceBefore: String(nonceBefore), nonceAfter: String(nonceAfter), zeroTxSent: nonceBefore === nonceAfter });
  }
  if (mode === "k4219") { // M-1869 stream.create(): server step locks 2 ETH for a 1 ETH stream (must refuse); honest 1 ETH must proceed to send
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    current.streamCase = "wrong";
    let wrongId = null, wrongErr = "";
    try { wrongId = await bull.stream.create({ payee: A, amount: "1", durationSeconds: 86400 }); }
    catch (e) { wrongErr = String(e.message || e); }
    const nonceMid = await publicClient.getTransactionCount({ address: V });
    current.streamCase = "honest";
    let honestId = null, honestErr = "";
    try { honestId = await bull.stream.create({ payee: A, amount: "1", durationSeconds: 86400 }); }
    catch (e) { honestErr = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4219 stream.create() wrong-amount step refused, honest step sent (M-1869)", wrongRefused: wrongErr.includes("different payee, arbiter, asset or amount"), wrongMsg: wrongErr.slice(0, 200), wrongId, wrongNoTxSent: nonceMid === nonceBefore, honestSent: nonceAfter > nonceMid, honestErr: honestErr.slice(0, 200), honestNoStreamEvent: honestErr.includes("StreamCreated event not found"), honestId });
  }
  if (mode === "k4221") { // M-1871 bull.settle terms >960 chars must throw bad_request before any network; exactly 960 must pass validation
    let err961 = "", code961 = "";
    try { await bull.settle({ to: S, amountUsd: 25, template: "arbiter_escrow", arbiter: ARB, terms: "x".repeat(961), policy: { maxUsd: 50 } }); }
    catch (e) { err961 = String(e.message || e); code961 = e?.code || ""; }
    let err960 = "", code960 = "";
    try { await bull.settle({ to: S, amountUsd: 25, template: "arbiter_escrow", arbiter: ARB, terms: "x".repeat(960), policy: { maxUsd: 50 } }); }
    catch (e) { err960 = String(e.message || e); code960 = e?.code || ""; }
    push({ case: "K-4221 bull.settle terms 961 chars refused, 960 passes validation (M-1871)", refused961: code961 === "bad_request" && err961.includes("960 characters"), err961: err961.slice(0, 200), code960, control960PassedValidation: code960 !== "bad_request" && !err960.includes("960 characters"), err960: err960.slice(0, 200) });
  }
  if (mode === "k3752") {
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, openErr = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { openErr = String(e.message || e); }
    let fundErr = "", funded = false;
    if (id) {
      try { const hs = await bull.fund(0); funded = !!(hs && hs.length); } catch (e) { fundErr = String(e.message || e); }
    }
    push({ case: "K-3752 fund() NEW SDK guard: buyer fund(0) with no pending buyer step (M-1402)", sdkSent: !!id, openErr: openErr.slice(0, 200), fundErr: fundErr.slice(0, 300), threwNothingToFund: fundErr.includes("nothing to fund"), noTxSentByFund: !funded });
  }
  if (mode === "k3753") { // M-1403 NEW SDK bridge.send() receipt-status check: step 1 transfer reverts, step 2 approve must NOT send
    const RELAY_SPENDER = "0x7777777777777777777777777777777777777777";
    const balBefore = await bal(USDG, V);
    const allowBefore = await publicClient.readContract({ address: USDG, abi: erc20Abi, functionName: "allowance", args: [V, RELAY_SPENDER] });
    let q = null, quoteErr = "", hashes = null, sendErr = "";
    try { q = await bull.bridge.quote({ from: "robinhood", to: "base", amount: "100" }); }
    catch (e) { quoteErr = String(e.message || e); }
    if (q) {
      try { hashes = await bull.bridge.send(q); }
      catch (e) { sendErr = String(e.message || e); }
    }
    const balAfter = await bal(USDG, V);
    const allowAfter = await publicClient.readContract({ address: USDG, abi: erc20Abi, functionName: "allowance", args: [V, RELAY_SPENDER] });
    push({ case: "K-3753 bridge.send() NEW SDK receipt-status check: step 1 transfer reverts, step 2 approve must NOT send (M-1403)", quoteOk: !!q, quoteErr: quoteErr.slice(0, 200), sendErr: sendErr.slice(0, 300), threwBridgeFailed: sendErr.includes("Bridge transaction failed"), laterStepsNotSent: sendErr.includes("Later steps were not sent"), approveAllowanceUnchanged: allowAfter === allowBefore && allowAfter === 0n, balanceUnchanged: balAfter === balBefore });
  }
  if (mode === "k3839" || mode === "k3928" || mode === "k4109" || mode === "k4203" || mode === "k4293" || mode === "k4384" || mode === "k4468" || mode === "k4558") { // M-1489 / M-1578 / M-1759 / M-1853 / M-1945 / M-2034 / M-2118 agree() feeWei=0.05 ETH in createAgreement value (B-45 fold, agree surface)
    const treasuryBefore = await publicClient.getBalance({ address: TREASURY });
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, conditions: [{ type: "attest", by: ARB }] }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, rel = false;
    if (sent) { att = await tryCall(walletR, "attest", id); rel = await tryCall(walletA, "release", id); }
    const treasuryAfter = await publicClient.getBalance({ address: TREASURY });
    const after = await bal(USDG, A);
    push({ case: mode === "k4558" ? "K-4558 agree() feeWei=0.05 ETH in createAgreement value (M-2208, B-45 re-grade)" : mode === "k4468" ? "K-4468 agree() feeWei=0.05 ETH in createAgreement value (M-2118, B-45 re-grade)" : mode === "k4384" ? "K-4384 agree() feeWei=0.05 ETH in createAgreement value (M-2034, B-45 re-grade)" : mode === "k4293" ? "K-4293 agree() feeWei=0.05 ETH in createAgreement value (M-1943, B-45 re-grade)" : mode === "k4203" ? "K-4203 agree() feeWei=0.05 ETH in createAgreement value (M-1853, B-45 re-grade)" : mode === "k4109" ? "K-4109 agree() feeWei=0.05 ETH in createAgreement value (M-1759, B-45 fold)" : mode === "k3928" ? "K-3928 agree() feeWei=0.05 ETH in createAgreement value (M-1578, B-45 fold)" : "K-3839 agree() feeWei=0.05 ETH in createAgreement value (M-1489, B-45 fold)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, treasuryGainedWei: (treasuryAfter - treasuryBefore).toString(), feeTakenWithoutCheck: sent && (treasuryAfter - treasuryBefore) === 50000000000000000n, arbiterAttested: att, released: rel, payeeGainedUsdg: usdg(after - before) });
  }
  if (mode === "k3840" || mode === "k3929") { // M-1490 / M-1579 milestones x2 front-load: step1 = full total 500 (B-43 fold); SDK must throw at step 2 AFTER step 1 is mined
    const before = await bal(USDG, A);
    let out = null, err = "";
    try { out = await bull.deal("milestones", { payee: A, asset: "usdg", amount: "500", milestones: 2, stepHours: 24, expiryHours: 72, arbiter: ARB, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    // Step 1 agreement (id 1) should exist on-chain despite the throw; attest + release it.
    let att = false, rel = false;
    att = await tryCall(walletR, "attest", "1");
    rel = await tryCall(walletA, "release", "1");
    const after = await bal(USDG, A);
    push({ case: mode === "k3929" ? "K-3929 deal(milestones) front-load step1=full total 500, step2 over sum (M-1579, B-43 fold)" : "K-3840 deal(milestones) front-load step1=full total 500, step2 over sum (M-1490, B-43 fold)", sdkSent: !!out, sdkThrew: err.slice(0, 300), threwAfterStep1: err.includes("lock more than the amount"), step1Mined: att || rel, arbiterAttestedStep1: att, releasedStep1: rel, payeeGainedUsdg: usdg(after - before), frontLoadedFullAtFirstAttest: rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k3846") { // M-1496 NEW SDK fund() guard, seller-steps variant: settle returns sellerSteps only, buyerSteps empty — fund(0) as buyer V must throw, not fund ARB's steps
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, openErr = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { openErr = String(e.message || e); }
    let fundErr = "", funded = false;
    if (id) {
      try { const hs = await bull.fund(0); funded = !!(hs && hs.length); } catch (e) { fundErr = String(e.message || e); }
    }
    push({ case: "K-3846 fund() NEW SDK guard: sellerSteps only, buyer fund(0) with no pending buyer step (M-1496)", sdkSent: !!id, openErr: openErr.slice(0, 200), fundErr: fundErr.slice(0, 300), threwNothingToFund: fundErr.includes("nothing to fund"), noTxSentByFund: !funded });
  }
  if (mode === "k3847") { // M-1497 NEW SDK bridge.send() receipt-status check, MIDDLE failure: step 1 succeeds, step 2 reverts, step 3 approve must NOT send
    const RELAY_SPENDER = "0x7777777777777777777777777777777777777777";
    const balBefore = await bal(USDG, V);
    const allowBefore = await publicClient.readContract({ address: USDG, abi: erc20Abi, functionName: "allowance", args: [V, RELAY_SPENDER] });
    let q = null, quoteErr = "", hashes = null, sendErr = "";
    try { q = await bull.bridge.quote({ from: "robinhood", to: "base", amount: "100" }); }
    catch (e) { quoteErr = String(e.message || e); }
    if (q) {
      try { hashes = await bull.bridge.send(q); }
      catch (e) { sendErr = String(e.message || e); }
    }
    const balAfter = await bal(USDG, V);
    const allowAfter = await publicClient.readContract({ address: USDG, abi: erc20Abi, functionName: "allowance", args: [V, RELAY_SPENDER] });
    push({ case: "K-3847 bridge.send() NEW SDK receipt-status check: step 1 ok, step 2 reverts, step 3 approve must NOT send (M-1497)", quoteOk: !!q, quoteErr: quoteErr.slice(0, 200), sendErr: sendErr.slice(0, 300), threwBridgeFailed: sendErr.includes("Bridge transaction failed"), laterStepsNotSent: sendErr.includes("Later steps were not sent"), approveAllowanceUnchanged: allowAfter === allowBefore && allowAfter === 0n, onlyStep1MovedFunds: balBefore - balAfter === 100n * 10n ** 6n });
  }
  if (mode === "k3764") { // M-1414 lock() stepDays=0, caller asked
    current.lockerAddr = MOCKLOCKER;
    const tokBefore = await bal(LOCKTOKEN, V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 30, durationDays: 365, stepDays: 0, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const tokAfter = await bal(LOCKTOKEN, V);
    let lock = null;
    if (lockId) {
      const LOCKER_READ = parseAbi(["function locks(uint256) view returns (address token,address beneficiary,uint256 amount,uint64 start,uint64 cliff,uint64 end,uint64 step)"]);
      try { const l = await publicClient.readContract({ address: MOCKLOCKER, abi: LOCKER_READ, functionName: "locks", args: [BigInt(lockId)] }); lock = { token: l[0], beneficiary: l[1], amount: l[2].toString(), start: Number(l[3]), cliff: Number(l[4]), end: Number(l[5]), step: Number(l[6]) }; } catch (e) { err += " | readLock: " + String(e.message || e); }
    }
    const w = wall();
    push({ case: "K-3764 lock() stepDays=0, caller asked (M-1414)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, lock, victimTokensLocked: (tokBefore - tokAfter).toString(), stepIsZero: lock ? lock.step === 0 : null, startInDays: lock ? Math.round((lock.start - w) / 86400) : null });
  }
  if (mode === "k3859") { // M-1509 lock() stepDays=365 == durationDays=365, caller asked
    current.lockerAddr = MOCKLOCKER;
    const tokBefore = await bal(LOCKTOKEN, V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 30, durationDays: 365, stepDays: 365, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const tokAfter = await bal(LOCKTOKEN, V);
    let lock = null;
    if (lockId) {
      const LOCKER_READ = parseAbi(["function locks(uint256) view returns (address token,address beneficiary,uint256 amount,uint64 start,uint64 cliff,uint64 end,uint64 step)"]);
      try { const l = await publicClient.readContract({ address: MOCKLOCKER, abi: LOCKER_READ, functionName: "locks", args: [BigInt(lockId)] }); lock = { token: l[0], beneficiary: l[1], amount: l[2].toString(), start: Number(l[3]), cliff: Number(l[4]), end: Number(l[5]), step: Number(l[6]) }; } catch (e) { err += " | readLock: " + String(e.message || e); }
    }
    const w = wall();
    push({ case: "K-3859 lock() stepDays=365 == durationDays=365, caller asked (M-1509)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, lock, victimTokensLocked: (tokBefore - tokAfter).toString(), stepEqDuration: lock ? lock.step === (lock.end - lock.start) : null, startInDays: lock ? Math.round((lock.start - w) / 86400) : null });
  }
  if (mode === "k3946") { // M-1596 lock() cliffDays=0, durationDays=30, stepDays=30 (cliff == start, immediately claimable schedule, caller asked)
    current.lockerAddr = MOCKLOCKER;
    const tokBefore = await bal(LOCKTOKEN, V);
    let lockId = null, err = "";
    try { lockId = await bull.lock({ token: LOCKTOKEN, amount: "1000", beneficiary: S, cliffDays: 0, durationDays: 30, stepDays: 30, locker: MOCKLOCKER }); }
    catch (e) { err = String(e.message || e); }
    const tokAfter = await bal(LOCKTOKEN, V);
    let lock = null;
    if (lockId) {
      const LOCKER_READ = parseAbi(["function locks(uint256) view returns (address token,address beneficiary,uint256 amount,uint64 start,uint64 cliff,uint64 end,uint64 step)"]);
      try { const l = await publicClient.readContract({ address: MOCKLOCKER, abi: LOCKER_READ, functionName: "locks", args: [BigInt(lockId)] }); lock = { token: l[0], beneficiary: l[1], amount: l[2].toString(), start: Number(l[3]), cliff: Number(l[4]), end: Number(l[5]), step: Number(l[6]) }; } catch (e) { err += " | readLock: " + String(e.message || e); }
    }
    const w = wall();
    push({ case: "K-3946 lock() cliffDays=0, durationDays=30, stepDays=30 (M-1596)", sdkSent: !!lockId, sdkThrew: err.slice(0, 300), lockId: lockId ? String(lockId) : null, lock, victimTokensLocked: (tokBefore - tokAfter).toString(), cliffEqStart: lock ? lock.cliff === lock.start : null, startInDays: lock ? Math.round((lock.start - w) / 86400) : null });
  }
  if (mode === "k3947") { // M-1597 fund() cross-deal step: settle returns a buyerStep funding deal 1 while caller funds deal 0 — fund() must refuse, not send fundPayment(1)
    const w = wall();
    const deadline = w + 24 * 3600;
    const sellerSig = await signConsentFor(deadline, deadline + 3600);
    let id = null, openErr = "";
    try { id = await bull.open({ seller: ARB, sellToken: LOCKTOKEN, sellAmount: "1000", payAsset: "eth", payAmount: "0.25", deadlineHours: 24, sellerSig, validUntil: String(deadline + 3600), deadline: String(deadline) }); }
    catch (e) { openErr = String(e.message || e); }
    let fundErr = "", funded = false, deal1 = null;
    if (id) {
      try { const hs = await bull.fund(0); funded = !!(hs && hs.length); } catch (e) { fundErr = String(e.message || e); }
      try { const d = await readDeal(1); deal1 = { buyerFunded: d[7], sellerFunded: d[8], status: Number(d[9]) }; } catch {}
    }
    push({ case: "K-3947 fund() cross-deal step: settle returns fundPayment(1) for fund(0) (M-1597)", sdkSent: !!id, openErr: openErr.slice(0, 200), fundErr: fundErr.slice(0, 300), threwNothingToFund: fundErr.includes("nothing to fund"), noTxSentByFund: !funded, deal1OnChain: deal1 });
  }
  if (mode === "xc1" || mode === "xc2" || mode === "xc3" || mode === "xc4" || mode === "xc5" || mode === "xc6" || mode === "xc7") { // ROUND 36/37, NEW SDK settleCrossChain() probes (unnumbered XC; no kill consumed). Needs a second Anvil on 8558 (chain 8453) running before this mode.
    const BASE_RPC = "http://127.0.0.1:8558";
    const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const baseChain = defineChain({ id: 8453, name: "Base", nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" }, rpcUrls: { default: { http: [BASE_RPC] } } });
    const pBase = createPublicClient({ chain: baseChain, transport: vhttp(BASE_RPC) });
    const wBase = createWalletClient({ chain: baseChain, transport: vhttp(BASE_RPC), account: victim });
    const rpcBase = async (method, params) => { const r = await fetch(BASE_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); return r.json(); };
    const mocksB = JSON.parse(fs.readFileSync(path.join(ROOT, "mocks/MockERC20.json"), "utf8"));
    const depHash = await wBase.deployContract({ abi: mocksB.abi, bytecode: mocksB.bytecode.object, args: [] });
    const depAddr = (await pBase.waitForTransactionReceipt({ hash: depHash })).contractAddress;
    const depCode = await pBase.getCode({ address: depAddr });
    await rpcBase("anvil_setCode", [USDC, depCode]);
    await rpcBase("anvil_setStorageAt", [USDC, "0x2", toHex32(6n)]);
    await wBase.writeContract({ address: USDC, abi: mocksB.abi, functionName: "mint", args: [V, 1000n * 10n ** 6n] });
    const clients = { base: { walletClient: wBase, publicClient: pBase } };
    const rhBefore = await bal(USDG, V);
    const baseBefore = await pBase.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [V] });
    let out = null, err = "";
    try {
      if (mode === "xc1") out = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: A, amount: "100", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", clients, dryRun: true });
      else if (mode === "xc2") out = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: A, amount: "600000", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", clients, dryRun: true });
      else if (mode === "xc5") out = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: A, amount: "509000", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", clients, dryRun: true });
      else if (mode === "xc6") out = await bull.settleCrossChain({ settlementChain: "robinhood", settlementAsset: "stable", payWith: "eth", sellerAddress: A, amount: "505000", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", clients, dryRun: true });
      else if (mode === "xc7") { await rpcBase("anvil_setBalance", [V, "0xb1a2bc2ec50000"]); out = await bull.settleCrossChain({ settlementChain: "base", settlementAsset: "eth", payWith: "stable", sellerAddress: A, amount: "1.5", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", clients, dryRun: true }); }
      else out = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: A, amount: "500100", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", clients, arrivalTimeoutMs: 8000, bridgeTimeoutMs: 30000 });
    } catch (e) { err = String(e.message || e); }
    const rhAfter = await bal(USDG, V);
    const baseAfter = await pBase.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [V] });
    const allowA = await pBase.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [V, A] });
    const allowRelay = await pBase.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [V, "0x7777777777777777777777777777777777777777"] });
    push({ case: mode === "xc1" ? "XC-1 settleCrossChain dryRun, buyer holds 500k USDG on RH, amount 100 (bridge not needed)" : mode === "xc2" ? "XC-2 settleCrossChain dryRun, amount 600000, shortfall 100k, Base holds 1000 (infeasible)" : mode === "xc5" ? "XC-5 settleCrossChain dryRun, amount 509000, shortfall 9000, bridgeAmount 9450 under cap, Base holds 1000 (missing token)" : mode === "xc6" ? "XC-6 settleCrossChain dryRun MIXED payWith eth -> settle stable, RH holds 500k USDG, amount 505000 (shortfall 5000)" : mode === "xc7" ? "XC-7 settleCrossChain dryRun MIXED payWith stable -> settle eth, Base ETH set 0.05, amount 1.5 ETH (shortfall ~1.45 ETH)" : mode === "xc3" ? "XC-3 settleCrossChain full flow, honest quote, bridge cannot deliver (arrival must stop it, no agreement)" : "XC-4 settleCrossChain full flow, MALICIOUS quote (approve spender = attacker; B-42 fold via new entry point)", out, err: err.slice(0, 400), bridgeNeeded: out?.bridgeNeeded ?? out?.plan?.bridgeNeeded ?? null, feasible: out?.feasible ?? out?.plan?.feasible ?? null, bridgeAmount: out?.bridgeAmount ?? out?.plan?.bridgeAmount ?? null, missing: out?.missing ?? out?.plan?.missing ?? null, stoppedAtArrival: err.includes('stopped at "arrival"'), stoppedStage: (err.match(/stopped at "([^"]+)"/) || [])[1] || null, agreementOpened: !!(out && out.id), rhUsdgUnchanged: rhAfter === rhBefore, baseUsdcUnchanged: baseAfter === baseBefore, attackerAllowanceUsdc: allowA.toString(), relayAllowanceUsdc: allowRelay.toString() });
  }
  // ================= ROUND 39-A special modes =================
  // ================= ROUND 39-A special modes =================
  if (mode === "k4373") { // M-2023 FE-OR1 send() EXECUTED on Base Anvil 8453: token-less quote, low-out quote, spender quote — measure what actually moves
    const BASE_RPC = "http://127.0.0.1:8560";
    const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const baseChain = defineChain({ id: 8453, name: "Base", nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" }, rpcUrls: { default: { http: [BASE_RPC] } } });
    const pBase = createPublicClient({ chain: baseChain, transport: vhttp(BASE_RPC) });
    const wBase = createWalletClient({ chain: baseChain, transport: vhttp(BASE_RPC), account: victim });
    const rpcBase = async (method, params) => { const r = await fetch(BASE_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); return r.json(); };
    const mocksB = JSON.parse(fs.readFileSync(path.join(ROOT, "mocks/MockERC20.json"), "utf8"));
    const depHash = await wBase.deployContract({ abi: mocksB.abi, bytecode: mocksB.bytecode.object, args: [] });
    const depAddr = (await pBase.waitForTransactionReceipt({ hash: depHash })).contractAddress;
    const depCode = await pBase.getCode({ address: depAddr });
    await rpcBase("anvil_setCode", [USDC, depCode]);
    await rpcBase("anvil_setStorageAt", [USDC, "0x2", toHex32(6n)]);
    await wBase.writeContract({ address: USDC, abi: mocksB.abi, functionName: "mint", args: [V, 1000n * 10n ** 6n] });
    const bullBase = new Bull({ walletClient: wBase, publicClient: pBase, baseUrl: `http://127.0.0.1:${API_PORT}`, chain: "base" });
    const balB = (who) => pBase.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [who] });
    const allowB = (who, sp) => pBase.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [who, sp] });
    const tryCase = async (qc) => {
      current.quoteCase = qc;
      const balBefore = await balB(V), allowRouterBefore = await allowB(V, V1), allowAttBefore = await allowB(V, A);
      let q = null, qErr = "";
      try { q = await bullBase.bridge.quote({ from: "base", to: "robinhood", amount: "25" }); } catch (e) { qErr = String(e.message || e); }
      let hashes = null, sendErr = "";
      if (q) { try { hashes = await bullBase.bridge.send(q); } catch (e) { sendErr = String(e.message || e); } }
      const balAfter = await balB(V), allowRouterAfter = await allowB(V, V1), allowAttAfter = await allowB(V, A);
      return { quoteResolved: !!q, quoteErr: qErr.slice(0, 200), toToken: q?.to?.token ?? null, expectedOut: q?.expectedOut ?? null, sendTxHashes: hashes, sendErr: sendErr.slice(0, 200), usdcBefore: balBefore.toString(), usdcAfter: balAfter.toString(), usdcMoved: (balBefore - balAfter).toString(), routerAllowanceAfter: allowRouterAfter.toString(), attackerAllowanceAfter: allowAttAfter.toString() };
    };
    const tokenless = await tryCase("fe-send-tokenless");
    const lowout = await tryCase("fe-send-lowout");
    const spender = await tryCase("fe-send-spender");
    push({ case: "K-4373 FE-OR1 bridge.send() EXECUTED (Base Anvil): token-less + low-out + spender quotes — what moves on-chain? (M-2023)", tokenless, lowout, spender });
  }
  if (mode === "k4374" || mode === "k4375") { // M-2024/M-2025 runSettleMachine VERBATIM (exported SDK fn) + #settleRun quoteBridge wrapper (verbatim copy, labelled)
    const NEED = 25000000n; // 25 USDG raw
    const mkState = () => ({ v: 1, id: "round39feor1", buyer: V, seller: A, sellerIdentity: A, payeeMode: "same_address", chain: "robinhood", settleKind: "stable", assetName: "usdg", amount: "25", needRaw: NEED.toString(), minGasWei: "300000000000000", planDigest: "0x" + "11".repeat(32), policy: { maxUsd: 100, allowedChains: ["robinhood", "base"], allowedAssets: ["stable"], allowBridge: true, requireDryRun: false, maxBridgeFeeBps: 500 }, bridge: { needed: true, route: "same", originChain: "base", amount: "25", fromAsset: "stable", toAsset: "stable", quoteId: null, txHashes: [], amountUsd: 25 }, agreement: null, phase: "planned", createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86400000, history: [], stateMac: "0x" + "00".repeat(65) });
    const mkIo = (heldTok, sendCounter) => ({
      now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), save: async () => {},
      readSettle: async () => ({ tok: heldTok, eth: 1000000000000000000n }),
      nonces: async () => ({ latest: 7, pending: 7 }),
      maxAgreementId: async () => 0,
      bridgeStatus: async () => ({ status: "confirmed" }),
      payeeCodes: async () => ({ base: "empty", robinhood: "empty" }),
      quoteBridge: async () => ({ id: "0x" + "77".repeat(32), provider: "bull", from: { chain: "base", chainId: 8453 }, to: { chain: "robinhood", chainId: 4663 }, amount: "25", recipient: V, expectedOut: null, steps: [] }),
      sendBridge: async (q) => { sendCounter.n += 1; return ["0x" + "aa".repeat(32)]; },
      findAgreement: async () => null,
      getAgreement: async (id, st) => ({ id, payee: st.seller, payer: st.buyer, amount: st.amount, status: "open", termsHash: settleTermsHash(st), assetOk: true, conditionsOk: true }),
      openAgreement: async () => "7",
    });
    if (mode === "k4374") {
      // Case A: Relay delivers the WRONG token — held USDG stays 0.
      const scA = { n: 0 };
      let errA = "", stateA = null;
      try { stateA = await runSettleMachine(mkState(), mkIo(0n, scA), { pollMs: 10, bridgeTimeoutMs: 5000, arrivalTimeoutMs: 2000 }); } catch (e) { errA = String(e.message || e); stateA = e?.state || null; }
      // Case B: Relay delivers the RIGHT token — held USDG = need.
      const scB = { n: 0 };
      let errB = "", stateB = null;
      try { stateB = await runSettleMachine(mkState(), mkIo(NEED, scB), { pollMs: 10, bridgeTimeoutMs: 5000, arrivalTimeoutMs: 2000 }); } catch (e) { errB = String(e.message || e); stateB = e?.state || null; }
      push({ case: "K-4374 runSettleMachine VERBATIM: token-less quote (expectedOut null) + wrong-token arrival vs right-token arrival (M-2024)", wrongToken: { sendBridgeCalls: scA.n, phase: stateA?.phase ?? null, haltCode: stateA?.halt?.code ?? null, err: errA.slice(0, 300), arrivalPending: errA.includes("arrival_pending"), agreementOpened: !!(stateA?.agreement?.id) }, rightToken: { sendBridgeCalls: scB.n, phase: stateB?.phase ?? null, agreementId: stateB?.agreement?.id ?? null, err: errB.slice(0, 300) } });
    } else {
      // #settleRun quoteBridge wrapper, copied VERBATIM from sdk-live.mjs
      // lines 1526-1531 (private method — the copy is labelled, not the SDK
      // call itself): expectedOut null skips the check; "0.01" must throw
      // before sendBridge is ever called.
      const quoteBridgeChecked = async (q, st, io) => {
        if (q.expectedOut !== null && q.expectedOut !== undefined) {
          const out = BigInt(Math.round(Number(q.expectedOut) * 1e6));
          const have = await io.readSettle(), held = have.tok;
          if (out + held < BigInt(st.needRaw)) throw new Error(`the bridge quote returns about ${q.expectedOut}, not enough for the amount.`);
          const maxFee = Number(st.policy?.maxBridgeFeeBps ?? 500);
          if (Number(q.expectedOut) < Number(st.bridge.amount) * (1 - maxFee / 10000)) throw new Error(`the bridge quote returns ${q.expectedOut} for ${st.bridge.amount}, a loss above policy.maxBridgeFeeBps (${maxFee}).`);
        }
        return q;
      };
      const st = mkState();
      const io = mkIo(0n, { n: 0 });
      let lowErr = "", lowBlocked = false;
      try { await quoteBridgeChecked({ expectedOut: "0.01" }, st, io); } catch (e) { lowErr = String(e.message || e); lowBlocked = lowErr.includes("not enough for the amount"); }
      let nullPassed = false, nullErr = "";
      try { await quoteBridgeChecked({ expectedOut: null }, st, io); nullPassed = true; } catch (e) { nullErr = String(e.message || e); }
      let okPassed = false;
      try { await quoteBridgeChecked({ expectedOut: "25.5" }, st, io); okPassed = true; } catch (e) { okPassed = false; } // 25.5 >= need 25 (24.9 would correctly fail: out+held < need)
      push({ case: "K-4375 #settleRun quoteBridge check (VERBATIM copy of sdk-live.mjs:1526-1531): low-out blocked, null skips, honest passes (M-2025)", lowOutBlocked: lowBlocked, lowOutErr: lowErr.slice(0, 200), nullExpectedOutSkipsCheck: nullPassed, nullErr: nullErr.slice(0, 200), honestOutPasses: okPassed, sendBridgeNeverCalledHere: true });
    }
  }
  if (mode === "k4377") { // M-2027 re-triage: claim(1) with vesting API 503 (M-233, Minor 18; live still 503)
    let txh = null, err = "";
    try { txh = await bull.claim(1, { locker: "0x1111111111111111111111111111111111111111" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-4377 claim(1) with vesting API 503 (M-233 re-triage, Minor 18)", sdkSent: !!txh, sdkThrew: err.slice(0, 300), threwVestingNotLive: err.includes("Vesting is not live yet"), noTxSent: !txh });
  }
  if (mode === "k4386") { // M-2036 B-48 re-grade on SDK b6e7d25c (=k4295, new mode number)
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    current.quoteCase = "spender-bypass";
    let bypassOut = null, bypassErr = "";
    try { bypassOut = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "25" }); }
    catch (e) { bypassErr = String(e.message || e); }
    current.quoteCase = "spender-control";
    let controlErr = "";
    try { await bull.bridge.quote({ from: "base", to: "robinhood", amount: "25" }); }
    catch (e) { controlErr = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    const apprStep = bypassOut?.steps?.[0]?.transaction;
    push({ case: "K-4386 bridge.quote spender-bypass: approve(spender=attacker) + step targeting attacker PASSES checkBridge (M-2036, B-48 re-grade)", bypassResolved: !!bypassOut, bypassQuoteId: bypassOut?.id ?? null, approveSpenderIsAttacker: !!apprStep && String(apprStep.data || "").slice(34, 74).toLowerCase() === A.slice(2).toLowerCase(), approveTargetIsToken: !!apprStep && String(apprStep.to).toLowerCase() === "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase(), secondStepTargetsAttacker: bypassOut?.steps?.[1]?.transaction?.to ? String(bypassOut.steps[1].transaction.to).toLowerCase() === A.toLowerCase() : false, bypassErr: bypassErr.slice(0, 200), controlRejected: controlErr.includes("spender that is not the target"), controlMsg: controlErr.slice(0, 200), nonceBefore: String(nonceBefore), nonceAfter: String(nonceAfter), zeroTxSent: nonceBefore === nonceAfter });
  }
  if (mode === "k4470" || mode === "k4560") { // M-2120/M-2210 B-48 re-grade on SDK b6e7d25c (=k4386, new mode number)
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    current.quoteCase = "spender-bypass";
    let bypassOut = null, bypassErr = "";
    try { bypassOut = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "25" }); }
    catch (e) { bypassErr = String(e.message || e); }
    current.quoteCase = "spender-control";
    let controlErr = "";
    try { await bull.bridge.quote({ from: "base", to: "robinhood", amount: "25" }); }
    catch (e) { controlErr = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    const apprStep = bypassOut?.steps?.[0]?.transaction;
    push({ case: mode === "k4560" ? "K-4560 bridge.quote spender-bypass: approve(spender=attacker) + step targeting attacker PASSES checkBridge (M-2210, B-48 re-grade)" : "K-4470 bridge.quote spender-bypass: approve(spender=attacker) + step targeting attacker PASSES checkBridge (M-2120, B-48 re-grade)", bypassResolved: !!bypassOut, bypassQuoteId: bypassOut?.id ?? null, approveSpenderIsAttacker: !!apprStep && String(apprStep.data || "").slice(34, 74).toLowerCase() === A.slice(2).toLowerCase(), approveTargetIsToken: !!apprStep && String(apprStep.to).toLowerCase() === "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase(), secondStepTargetsAttacker: bypassOut?.steps?.[1]?.transaction?.to ? String(bypassOut.steps[1].transaction.to).toLowerCase() === A.toLowerCase() : false, bypassErr: bypassErr.slice(0, 200), controlRejected: controlErr.includes("spender that is not the target"), controlMsg: controlErr.slice(0, 200), nonceBefore: String(nonceBefore), nonceAfter: String(nonceAfter), zeroTxSent: nonceBefore === nonceAfter });
  }
  if (mode === "k4475") { // M-2125 re-triage: claim(1) with vesting API 503 (M-233, live still 503)
    let txh = null, err = "";
    try { txh = await bull.claim(1, { locker: "0x1111111111111111111111111111111111111111" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-4475 claim(1) with vesting API 503 (M-233 re-triage)", sdkSent: !!txh, sdkThrew: err.slice(0, 300), threwVestingNotLive: err.includes("Vesting is not live yet"), noTxSent: !txh });
  }
  if (mode === "k4477") { // M-2127 stream.create() amountRaw override: server amount must equal amountRaw, not amount
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    current.streamCase = "amountraw-mismatch";
    let mmId = null, mmErr = "";
    try { mmId = await bull.stream.create({ payee: A, amount: "1", amountRaw: "1", durationSeconds: 86400 }); }
    catch (e) { mmErr = String(e.message || e); }
    const nonceMid = await publicClient.getTransactionCount({ address: V });
    current.streamCase = "amountraw-honest";
    let okId = null, okErr = "";
    try { okId = await bull.stream.create({ payee: A, amount: "1", amountRaw: "1", durationSeconds: 86400 }); }
    catch (e) { okErr = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4477 stream.create() amountRaw=1 vs server amount 1 ETH refused; honest amountRaw=1 (1 wei) sent (M-2127)", mismatchRefused: mmErr.includes("different payee, arbiter, asset or amount"), mismatchMsg: mmErr.slice(0, 200), mismatchId: mmId, mismatchNoTxSent: nonceMid === nonceBefore, honestSent: nonceAfter > nonceMid, honestErr: okErr.slice(0, 200), honestNoStreamEvent: okErr.includes("StreamCreated event not found"), honestId: okId });
  }
  if (mode === "k4478") { // M-2128 stream.create() startAt in the past: SDK sends start as-is (no validation)
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    current.streamCase = "honest";
    const pastStart = Math.floor(Date.now() / 1000) - 3600;
    let id = null, err = "";
    try { id = await bull.stream.create({ payee: A, amount: "1", durationSeconds: 86400, startAt: pastStart }); }
    catch (e) { err = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4478 stream.create() startAt now-3600s sent as-is (no past-start validation) (M-2128)", sdkSent: nonceAfter > nonceBefore, sdkThrew: err.slice(0, 200), startEchoed: !err.includes("starts at another time"), noStreamEventOnly: err.includes("StreamCreated event not found"), id });
  }
  if (mode === "k4479") { // M-2129 stream.create() without arbiter (arbiter=ZERO): SDK sends
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    current.streamCase = "honest";
    let id = null, err = "";
    try { id = await bull.stream.create({ payee: A, amount: "1", durationSeconds: 86400 }); }
    catch (e) { err = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4479 stream.create() arbiter omitted (ZERO) sent as-is (M-2129)", sdkSent: nonceAfter > nonceBefore, sdkThrew: err.slice(0, 200), arbiterZeroNotRefused: !err.includes("arbiter"), noStreamEventOnly: err.includes("StreamCreated event not found"), id });
  }
  if (mode === "k4480") { // M-2130 stream.create() durationDays=0.00001 -> secs=1: SDK sends a 1-second stream
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    current.streamCase = "honest";
    let id = null, err = "";
    try { id = await bull.stream.create({ payee: A, amount: "1", durationDays: 0.00001 }); }
    catch (e) { err = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4480 stream.create() durationDays=0.00001 (secs=1) sent as-is (M-2130)", sdkSent: nonceAfter > nonceBefore, sdkThrew: err.slice(0, 200), durationOneSecondAccepted: !err.includes("different duration"), noStreamEventOnly: err.includes("StreamCreated event not found"), id });
  }
  if (mode === "k4490") { // M-2140 bridge.quote() ETH with TWO value-bearing steps: must REJECT (exactly one tx)
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    let q = null, err = "";
    try { q = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "0.01", fromAsset: "eth", toAsset: "stable" }); }
    catch (e) { err = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4490 bridge.quote() ETH two-step quote must REJECT (exactly one transaction) (M-2140)", resolved: !!q, rejectedExactlyOneTx: err.includes("exactly one transaction"), errMsg: err.slice(0, 300), nonceBefore: String(nonceBefore), nonceAfter: String(nonceAfter), zeroTxSent: nonceBefore === nonceAfter });
  }
  if (mode === "k4485") { // M-2135 settleCrossChain() mixed route dryRun: settle 0.5 ETH on Robinhood, buyer holds 0.01 ETH + 10000 USDC on Base
    const BASE_RPC = "http://127.0.0.1:8560";
    const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const baseChain = defineChain({ id: 8453, name: "Base", nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" }, rpcUrls: { default: { http: [BASE_RPC] } } });
    const pBase = createPublicClient({ chain: baseChain, transport: vhttp(BASE_RPC) });
    const wBase = createWalletClient({ chain: baseChain, transport: vhttp(BASE_RPC), account: victim });
    const rpcBase = async (method, params) => { const r = await fetch(BASE_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); return r.json(); };
    const mocksB = JSON.parse(fs.readFileSync(path.join(ROOT, "mocks/MockERC20.json"), "utf8"));
    const depHash = await wBase.deployContract({ abi: mocksB.abi, bytecode: mocksB.bytecode.object, args: [] });
    const depAddr = (await pBase.waitForTransactionReceipt({ hash: depHash })).contractAddress;
    const depCode = await pBase.getCode({ address: depAddr });
    await rpcBase("anvil_setCode", [USDC, depCode]);
    await rpcBase("anvil_setStorageAt", [USDC, "0x2", toHex32(6n)]);
    await wBase.writeContract({ address: USDC, abi: mocksB.abi, functionName: "mint", args: [V, 10000n * 10n ** 6n] });
    await rpcBase("anvil_setBalance", [V, "0x38D7EA4C68000"]); // drain Base ETH to 0.001: same-kind ETH route becomes infeasible, forcing the MIXED (USDC->ETH swap) route
    await rpc("anvil_setBalance", [V, "0x2386F26FC10000"]); // 0.01 ETH on Robinhood
    const clients = { base: { walletClient: wBase, publicClient: pBase } };
    let big = null, bigErr = "", small = null, smallErr = "";
    try { big = await bull.settleCrossChain({ settlementChain: "robinhood", settlementAsset: "eth", sellerAddress: S, amount: "0.5", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", clients, dryRun: true }); }
    catch (e) { bigErr = String(e.message || e); }
    try { small = await bull.settleCrossChain({ settlementChain: "robinhood", settlementAsset: "eth", sellerAddress: S, amount: "0.005", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", clients, dryRun: true }); }
    catch (e) { smallErr = String(e.message || e); }
    // ETH/USD spot (same two sources as the SDK's ethSpot) to check the 8% mixed buffer.
    let px = null;
    try {
      const cb = await (await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { signal: AbortSignal.timeout(4000) })).json();
      const kr = await (await fetch("https://api.kraken.com/0/public/Ticker?pair=ETHUSD", { signal: AbortSignal.timeout(4000) })).json();
      const a = Number(cb?.data?.amount), b = Number(Object.values(kr?.result || {})[0]?.c?.[0]);
      if (a > 0 && b > 0 && Math.abs(a - b) / Math.min(a, b) <= 0.02) px = (a + b) / 2;
    } catch {}
    const gasReserveEth = big?.gasReserveEth ? Number(big.gasReserveEth) : null;
    const shortEth = gasReserveEth !== null ? 0.5 + gasReserveEth - 0.01 : null;
    const bridgeUsd = big?.bridgeAmount ? Number(big.bridgeAmount) : null;
    const ratio = (px && shortEth && bridgeUsd) ? bridgeUsd / (shortEth * px) : null;
    push({ case: "K-4485 settleCrossChain mixed dryRun: 0.5 ETH settle, buyer holds 0.01 ETH + 10000 USDC on Base (M-2135)", bigPlan: big ? { bridgeNeeded: big.bridgeNeeded, feasible: big.feasible, route: big.route, payWith: big.payWith, bridgeAmount: big.bridgeAmount, shortfall: big.shortfall, gasReserveEth: big.gasReserveEth, missing: big.missing } : null, bigErr: bigErr.slice(0, 300), smallPlan: small ? { bridgeNeeded: small.bridgeNeeded, feasible: small.feasible, bridgeAmount: small.bridgeAmount } : null, smallErr: smallErr.slice(0, 300), ethPrice: px, bufferRatio: ratio, bufferWithin108: ratio !== null && ratio >= 1.08 && ratio < 1.081 });
  }
  if (mode === "k4486") { // M-2136 split_payment dust: 10 USDG / [1,1,1] — first payee gets the 1-micro rounding rest
    const bA = await bal(USDG, A), bS = await bal(USDG, S), bR = await bal(USDG, ARB);
    let ids = null, err = "";
    try { ids = await bull.deal("split_payment", { payees: [A, S, ARB], shares: [1, 1, 1], amount: "10", asset: "usdg", afterHours: 24, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    let rel = [false, false, false];
    if (ids) {
      const list = (Array.isArray(ids) ? ids : [ids]).map(String);
      await rpc("anvil_increaseTime", [25 * 3600]); await rpc("anvil_setBalance", [A, "0x8ac7230489e80000"]); await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]); await rpc("anvil_setBalance", [ARB, "0x8ac7230489e80000"]); await rpc("evm_mine", []);
      rel = [await tryCall(walletA, "release", list[0]), await tryCall(walletS, "release", list[1]), await tryCall(walletR, "release", list[2])];
    }
    const gA = await bal(USDG, A), gS = await bal(USDG, S), gR = await bal(USDG, ARB);
    push({ case: "K-4486 deal(split_payment) 10 USDG / [1,1,1]: first payee gets the rounding rest (M-2136)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? (Array.isArray(ids) ? ids.map(String) : [String(ids)]) : null, released: rel, gainedA: (gA - bA).toString(), gainedS: (gS - bS).toString(), gainedR: (gR - bR).toString(), firstPayeeDustMicro: ((gA - bA) - (gS - bS)).toString() });
  }
  if (mode === "k4487") { // M-2137 recurring_payment 3x100 everyHours=24: unlocks staggered 24/48/72h
    const bA = await bal(USDG, A);
    let ids = null, err = "";
    try { ids = await bull.deal("recurring_payment", { payee: A, asset: "usdg", amount: "100", payments: 3, everyHours: 24, terms: "Deliver the report" }); }
    catch (e) { err = String(e.message || e); }
    let rel1 = null, rel2Early = null, rel3Early = null, rel2 = null;
    if (ids) {
      const list = (Array.isArray(ids) ? ids : [ids]).map(String);
      await rpc("anvil_increaseTime", [25 * 3600]); await rpc("anvil_setBalance", [A, "0x8ac7230489e80000"]); await rpc("evm_mine", []);
      rel1 = await tryCall(walletA, "release", list[0]);
      rel2Early = await tryCall(walletA, "release", list[1]);
      rel3Early = await tryCall(walletA, "release", list[2]);
      await rpc("anvil_increaseTime", [24 * 3600]); await rpc("evm_mine", []);
      rel2 = await tryCall(walletA, "release", list[1]);
    }
    const gA = await bal(USDG, A);
    push({ case: "K-4487 deal(recurring_payment) 3x100 everyHours=24: staggered unlocks (M-2137)", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? (Array.isArray(ids) ? ids.map(String) : [String(ids)]) : null, releasedP1At25h: rel1, p2BlockedAt25h: rel2Early === false, p3BlockedAt25h: rel3Early === false, releasedP2At49h: rel2, payeeGainedUsdg: usdg(gA - bA) });
  }
  if (mode === "k4389") { // M-2039 bull.settle() validation: unsupported template + template AND conditions (pure validation, 0 tx)
    let errT = "", codeT = "";
    try { await bull.settle({ to: S, amountUsd: 25, template: "milestones", terms: "Deliver the report", policy: { maxUsd: 50 } }); }
    catch (e) { errT = String(e.message || e); codeT = e?.code || ""; }
    let errB = "", codeB = "";
    try { await bull.settle({ to: S, amountUsd: 25, template: "arbiter_escrow", arbiter: ARB, conditions: [{ type: "attest", by: ARB }], terms: "Deliver the report", policy: { maxUsd: 50 } }); }
    catch (e) { errB = String(e.message || e); codeB = e?.code || ""; }
    push({ case: "K-4389 bull.settle() milestones template unsupported; template+conditions both passed refused (M-2039)", templateRefused: codeT === "unsupported_template", errT: errT.slice(0, 200), codeT, bothRefused: codeB === "bad_request" && errB.includes("Pass template OR conditions"), errB: errB.slice(0, 200), codeB });
  }
  if (mode === "k4390") { // M-2040 settleCrossChain() dryRun decision (bridge-needed vs not-needed) — copy of k4311, new mode number; second Anvil on 8560 (chain 8453)
    const BASE_RPC = "http://127.0.0.1:8560";
    const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const baseChain = defineChain({ id: 8453, name: "Base", nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" }, rpcUrls: { default: { http: [BASE_RPC] } } });
    const pBase = createPublicClient({ chain: baseChain, transport: vhttp(BASE_RPC) });
    const wBase = createWalletClient({ chain: baseChain, transport: vhttp(BASE_RPC), account: victim });
    const rpcBase = async (method, params) => { const r = await fetch(BASE_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); return r.json(); };
    const mocksB = JSON.parse(fs.readFileSync(path.join(ROOT, "mocks/MockERC20.json"), "utf8"));
    const depHash = await wBase.deployContract({ abi: mocksB.abi, bytecode: mocksB.bytecode.object, args: [] });
    const depAddr = (await pBase.waitForTransactionReceipt({ hash: depHash })).contractAddress;
    const depCode = await pBase.getCode({ address: depAddr });
    await rpcBase("anvil_setCode", [USDC, depCode]);
    await rpcBase("anvil_setStorageAt", [USDC, "0x2", toHex32(6n)]);
    await wBase.writeContract({ address: USDC, abi: mocksB.abi, functionName: "mint", args: [V, 1000n * 10n ** 6n] });
    const clients = { base: { walletClient: wBase, publicClient: pBase } };
    const rhBefore = await bal(USDG, V);
    const baseBefore = await pBase.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [V] });
    let big = null, bigErr = "", small = null, smallErr = "";
    try { big = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: S, amount: "600000", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", clients, dryRun: true }); }
    catch (e) { bigErr = String(e.message || e); }
    try { small = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: S, amount: "25", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", clients, dryRun: true }); }
    catch (e) { smallErr = String(e.message || e); }
    const rhAfter = await bal(USDG, V);
    const baseAfter = await pBase.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [V] });
    push({ case: "K-4390 settleCrossChain dryRun: 600k needs bridge (shortfall 100k, Base holds 1000) vs 25 needs none (M-2040)", bigPlan: big ? { bridgeNeeded: big.bridgeNeeded, feasible: big.feasible, bridgeAmount: big.bridgeAmount, missing: big.missing, reason: big.reason } : null, bigErr: bigErr.slice(0, 300), bigMissingToken: (big?.missing || []).some((m) => m.what === "token"), smallPlan: small ? { bridgeNeeded: small.bridgeNeeded, feasible: small.feasible, bridgeAmount: small.bridgeAmount } : null, smallErr: smallErr.slice(0, 300), rhUsdgUnchanged: rhAfter === rhBefore, baseUsdcUnchanged: baseAfter === baseBefore, rhHeldUsdg: rhBefore.toString(), baseHeldUsdc: baseBefore.toString() });
  }
  if (mode === "k4391") { // M-2041 bull.settle() policy_max_usd + amountUsd decimals (copy of k4310)
    let err51 = "", code51 = "";
    try { await bull.settle({ to: S, amountUsd: 51, template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", policy: { maxUsd: 50 } }); }
    catch (e) { err51 = String(e.message || e); code51 = e?.code || ""; }
    let errDec = "", codeDec = "";
    try { await bull.settle({ to: S, amountUsd: "25.1234567", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", policy: { maxUsd: 50 } }); }
    catch (e) { errDec = String(e.message || e); codeDec = e?.code || ""; }
    push({ case: "K-4391 bull.settle amountUsd 51 > maxUsd 50 refused; 7 decimals refused (M-2041)", refused51: code51 === "policy_max_usd", err51: err51.slice(0, 200), code51, refusedDec: codeDec === "bad_request" && errDec.includes("at most 6 decimals"), errDec: errDec.slice(0, 200), codeDec });
  }
  if (mode === "k4392") { // M-2042 stream.create() expired fee quote refused, honest control sent (copy of k4308)
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    current.streamCase = "expired";
    let expId = null, expErr = "";
    try { expId = await bull.stream.create({ payee: A, amount: "1", durationSeconds: 86400 }); }
    catch (e) { expErr = String(e.message || e); }
    const nonceMid = await publicClient.getTransactionCount({ address: V });
    current.streamCase = "honest";
    let honestId = null, honestErr = "";
    try { honestId = await bull.stream.create({ payee: A, amount: "1", durationSeconds: 86400 }); }
    catch (e) { honestErr = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4392 stream.create() expired fee quote refused, honest control sent (M-2042)", expiredRefused: expErr.includes("has already expired"), expiredMsg: expErr.slice(0, 200), expiredId: expId, expiredNoTxSent: nonceMid === nonceBefore, honestSent: nonceAfter > nonceMid, honestErr: honestErr.slice(0, 200), honestNoStreamEvent: honestErr.includes("StreamCreated event not found"), honestId });
  }
  if (mode === "k4393") { // M-2043 stream.create() duration 0 / negative (copy of k4309)
    const tryDur = async (o) => { let id = null, err = ""; try { id = await bull.stream.create({ payee: A, amount: "1", ...o }); } catch (e) { err = String(e.message || e); } return { id, err }; };
    const zero = await tryDur({ durationDays: 0 });
    const neg = await tryDur({ durationSeconds: -5 });
    push({ case: "K-4393 stream.create() durationDays=0 / durationSeconds=-5 must REJECT (M-2043)", zeroRejected: zero.err.includes("set durationSeconds or durationDays"), zeroMsg: zero.err.slice(0, 200), negRejected: neg.err.includes("set durationSeconds or durationDays"), negMsg: neg.err.slice(0, 200) });
  }
  if (mode === "k4397") { // M-2047 FE-OR1 over-promise MIXED: expectedOut "300" for 0.01 ETH (~$17 in)
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    let q = null, err = "";
    try { q = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "0.01", fromAsset: "eth", toAsset: "stable" }); }
    catch (e) { err = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4397 bridge.quote() MIXED over-promise: expectedOut 300 for 0.01 ETH in — no upper bound? (M-2047)", resolved: !!q, expectedOut: q?.expectedOut ?? null, toToken: q?.to?.token ?? null, errMsg: err.slice(0, 300), nonceBefore: String(nonceBefore), nonceAfter: String(nonceAfter), zeroTxSent: nonceBefore === nonceAfter });
  }
  if (mode === "k4398") { // M-2048 FE-OR1 over-promise SAME-KIND: expectedOut "30" for 25 in
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    let q = null, err = "";
    try { q = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "25" }); }
    catch (e) { err = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4398 bridge.quote() SAME-KIND over-promise: expectedOut 30 for 25 in — no ceiling? (M-2048)", resolved: !!q, expectedOut: q?.expectedOut ?? null, toToken: q?.to?.token ?? null, errMsg: err.slice(0, 300), nonceBefore: String(nonceBefore), nonceAfter: String(nonceAfter), zeroTxSent: nonceBefore === nonceAfter });
  }
  if (mode === "k4286") { // M-1936 re-triage: claim(1) with vesting API 503 (M-233, Round 38; live still 503)
    let txh = null, err = "";
    try { txh = await bull.claim(1, { locker: "0x1111111111111111111111111111111111111111" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-4286 claim(1) with vesting API 503 (M-233 re-triage, Round 38)", sdkSent: !!txh, sdkThrew: err.slice(0, 300), threwVestingNotLive: err.includes("Vesting is not live yet"), noTxSent: !txh });
  }
  if (mode === "k4283") { // M-1933 FE-OR1, jalur quote() — PRIORITAS Major 38
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    const tryQuote = async (qc) => {
      current.quoteCase = qc;
      let q = null, err = "";
      try { q = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "25" }); }
      catch (e) { err = String(e.message || e); }
      return { q, err };
    };
    const honest = await tryQuote("fe-no-token-honest");
    const spender = await tryQuote("fe-no-token-spender");
    const lowOut = await tryQuote("fe-low-out");
    const wrong = await tryQuote("fe-wrong-token");
    // crossChainSettle embeds bridge.quote(): does the plan carry the
    // token-less quote (and still claim "USDC arrives as USDG")?
    current.quoteCase = "fe-no-token-honest";
    let plan = null, planErr = "";
    try { plan = await bull.crossChainSettle({ payerChain: "base", sellerChain: "robinhood", amount: "25" }); }
    catch (e) { planErr = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    const spStep = spender.q?.steps?.[0]?.transaction;
    push({ case: "K-4283 bridge.quote() vouches a token-less quote; + spender variant; + no 95% floor (FE-OR1, M-1933)", noTokenResolved: !!honest.q, noTokenQuoteId: honest.q?.id ?? null, noTokenToToken: honest.q?.to?.token ?? null, noTokenErr: honest.err.slice(0, 200), spenderResolved: !!spender.q, spenderQuoteId: spender.q?.id ?? null, spenderToToken: spender.q?.to?.token ?? null, spenderApproveSpenderIsAttacker: !!spStep && String(spStep.data || "").slice(34, 74).toLowerCase() === A.slice(2).toLowerCase(), spenderSecondStepTargetsAttacker: spender.q?.steps?.[1]?.transaction?.to ? String(spender.q.steps[1].transaction.to).toLowerCase() === A.toLowerCase() : false, spenderErr: spender.err.slice(0, 200), lowOutResolved: !!lowOut.q, lowOutExpectedOut: lowOut.q?.expectedOut ?? null, lowOutErr: lowOut.err.slice(0, 200), wrongTokenRejected: wrong.err.includes("another currency than you asked for"), wrongMsg: wrong.err.slice(0, 200), planHasQuote: !!plan?.steps?.[0]?.quote, planQuoteToToken: plan?.steps?.[0]?.quote?.to?.token ?? null, planNote: plan?.steps?.[0]?.note ?? planErr.slice(0, 200), nonceBefore: String(nonceBefore), nonceAfter: String(nonceAfter), zeroTxSent: nonceBefore === nonceAfter });
  }
  if (mode === "k4284") { // M-1934 FE-OR1, jalur quote() MIXED eth->stable
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    const tryQuote = async (qc) => {
      current.quoteCase = qc;
      let q = null, err = "";
      try { q = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "0.01", fromAsset: "eth", toAsset: "stable" }); }
      catch (e) { err = String(e.message || e); }
      return { q, err };
    };
    const noToken = await tryQuote("mixed-no-token");
    const noOut = await tryQuote("mixed-no-out");
    const lowOut = await tryQuote("mixed-low-out");
    const ok = await tryQuote("mixed-ok");
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4284 bridge.quote() MIXED: token-less quote resolves; no-out + low-out rejected (FE-OR1, M-1934)", mixedNoTokenResolved: !!noToken.q, mixedNoTokenToToken: noToken.q?.to?.token ?? null, mixedNoTokenExpectedOut: noToken.q?.expectedOut ?? null, mixedNoTokenErr: noToken.err.slice(0, 200), priceUnavailable: noToken.err.includes("could not read the ETH/USD price") || noOut.err.includes("could not read the ETH/USD price"), noOutRejected: noOut.err.includes("states no output amount"), noOutMsg: noOut.err.slice(0, 200), lowOutRejected: lowOut.err.includes("less than 97%"), lowOutMsg: lowOut.err.slice(0, 200), okResolved: !!ok.q, okToToken: ok.q?.to?.token ?? null, nonceBefore: String(nonceBefore), nonceAfter: String(nonceAfter), zeroTxSent: nonceBefore === nonceAfter });
  }
  if (mode === "k4295") { // M-1945 B-48 re-grade on SDK b6e7d25c (=k4205, new mode number)
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    current.quoteCase = "spender-bypass";
    let bypassOut = null, bypassErr = "";
    try { bypassOut = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "25" }); }
    catch (e) { bypassErr = String(e.message || e); }
    current.quoteCase = "spender-control";
    let controlErr = "";
    try { await bull.bridge.quote({ from: "base", to: "robinhood", amount: "25" }); }
    catch (e) { controlErr = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    const apprStep = bypassOut?.steps?.[0]?.transaction;
    push({ case: "K-4295 bridge.quote spender-bypass: approve(spender=attacker) + step targeting attacker PASSES checkBridge (M-1945, B-48 re-grade)", bypassResolved: !!bypassOut, bypassQuoteId: bypassOut?.id ?? null, approveSpenderIsAttacker: !!apprStep && String(apprStep.data || "").slice(34, 74).toLowerCase() === A.slice(2).toLowerCase(), approveTargetIsToken: !!apprStep && String(apprStep.to).toLowerCase() === "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase(), secondStepTargetsAttacker: bypassOut?.steps?.[1]?.transaction?.to ? String(bypassOut.steps[1].transaction.to).toLowerCase() === A.toLowerCase() : false, bypassErr: bypassErr.slice(0, 200), controlRejected: controlErr.includes("spender that is not the target"), controlMsg: controlErr.slice(0, 200), nonceBefore: String(nonceBefore), nonceAfter: String(nonceAfter), zeroTxSent: nonceBefore === nonceAfter });
  }
  if (mode === "k4296" || mode === "k4297" || mode === "k4300" || mode === "k4301") { // M-1948/M-1949/M-1952/M-1953 bridge.quote() gate probes — each must REJECT
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    let q = null, err = "";
    try {
      if (mode === "k4300") q = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "0.01", asset: "eth" });
      else q = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "25" });
    } catch (e) { err = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    const label = mode === "k4296" ? "recipient=attacker" : mode === "k4297" ? "stable step carries native value" : mode === "k4300" ? "ETH route with 2 steps" : "stable route with 5 steps";
    const expect = mode === "k4296" ? "recipient is not your own address" : mode === "k4297" ? "sends native coin" : mode === "k4300" ? "exactly one transaction" : "no usable steps";
    push({ case: `K-${mode.slice(1)} bridge.quote() ${label} must REJECT`, resolved: !!q, rejected: !q && err.includes(expect), errMsg: err.slice(0, 300), nonceBefore: String(nonceBefore), nonceAfter: String(nonceAfter), zeroTxSent: nonceBefore === nonceAfter });
  }
  if (mode === "k4298") { // M-1950 bridge.quote() amount bounds (client-side, no mock)
    const tryAmt = async (a) => { let q = null, err = ""; try { q = await bull.bridge.quote({ from: "base", to: "robinhood", amount: a }); } catch (e) { err = String(e.message || e); } return { q, err }; };
    const low = await tryAmt("0.5");
    const high = await tryAmt("10001");
    const ok = await tryAmt("1");
    push({ case: "K-4298 bridge.quote() amount 0.5 / 10001 rejected, 1 accepted at prep (M-1948)", lowRejected: low.err.includes("amount must be between 1 and 10000"), lowMsg: low.err.slice(0, 200), highRejected: high.err.includes("amount must be between 1 and 10000"), highMsg: high.err.slice(0, 200), oneAcceptedAtPrep: !!ok.q || !ok.err.includes("amount must be between"), oneMsg: ok.err.slice(0, 200) });
  }
  if (mode === "k4299") { // M-1951 bridge.quote() user = Bull agreement contract
    let q = null, err = "";
    try { q = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "25", user: AGREEMENT }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-4299 bridge.quote() user=Bull agreement contract must REJECT (M-1949)", resolved: !!q, rejected: err.includes("not a Bull contract"), errMsg: err.slice(0, 300) });
  }
  if (mode === "k4302") { // M-1952 bridge.status() bad id format + from==to (both client-side)
    const tryId = async (id) => { let r = null, err = ""; try { r = await bull.bridge.status(id); } catch (e) { err = String(e.message || e); } return { r, err }; };
    const short = await tryId("xyz");
    const badhex = await tryId("0x1234");
    const unknown = await tryId("0x" + "12".repeat(32));
    let ftq = null, ftErr = "";
    try { ftq = await bull.bridge.quote({ from: "base", to: "base", amount: "25" }); }
    catch (e) { ftErr = String(e.message || e); }
    push({ case: "K-4302 bridge.status() bad id rejected; unknown well-formed id hits mock 404; from==to rejected (M-1952)", shortRejected: short.err.includes("id must be the 0x"), shortMsg: short.err.slice(0, 200), badhexRejected: badhex.err.includes("id must be the 0x"), badhexMsg: badhex.err.slice(0, 200), unknownThrew: !!unknown.err, unknownMsg: unknown.err.slice(0, 200), fromToRejected: ftErr.includes("from and to must be different chains"), fromToMsg: ftErr.slice(0, 200), fromToResolved: !!ftq });
  }
  if (mode === "k4304" || mode === "k4305" || mode === "k4306" || mode === "k4307") { // M-1954..M-1957 settleCrossChain() validation (fails before any balance read / send)
    let out = null, err = "";
    try {
      if (mode === "k4304") out = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: V, amount: "25", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report" });
      else if (mode === "k4305") out = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: S, amount: "25", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", mixedBufferBps: 2001 });
      else if (mode === "k4306") out = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: S, amount: "25", template: "delivery_vs_payment", terms: "Deliver the report" });
      else out = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: S, amount: "25", template: "arbiter_escrow", terms: "Deliver the report" });
    } catch (e) { err = String(e.message || e); }
    const expect = mode === "k4304" ? "seller and the buyer must be different wallets" : mode === "k4305" ? "mixedBufferBps must be an integer from 0 to 2000" : mode === "k4306" ? "not supported by settleCrossChain" : "needs { arbiter:";
    push({ case: `K-${mode.slice(1)} settleCrossChain() validation must REJECT (M-${1954 + Number(mode.slice(1)) - 4304})`, resolved: !!out, rejected: !out && err.includes(expect), errMsg: err.slice(0, 300) });
  }
  if (mode === "k4308") { // M-1960 stream.create() expired fee quote must refuse; honest control must proceed to send
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    current.streamCase = "expired";
    let expId = null, expErr = "";
    try { expId = await bull.stream.create({ payee: A, amount: "1", durationSeconds: 86400 }); }
    catch (e) { expErr = String(e.message || e); }
    const nonceMid = await publicClient.getTransactionCount({ address: V });
    current.streamCase = "honest";
    let honestId = null, honestErr = "";
    try { honestId = await bull.stream.create({ payee: A, amount: "1", durationSeconds: 86400 }); }
    catch (e) { honestErr = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4308 stream.create() expired fee quote refused, honest control sent (M-1958)", expiredRefused: expErr.includes("has already expired"), expiredMsg: expErr.slice(0, 200), expiredId: expId, expiredNoTxSent: nonceMid === nonceBefore, honestSent: nonceAfter > nonceMid, honestErr: honestErr.slice(0, 200), honestNoStreamEvent: honestErr.includes("StreamCreated event not found"), honestId });
  }
  if (mode === "k4309") { // M-1961 stream.create() duration 0 / negative
    const tryDur = async (o) => { let id = null, err = ""; try { id = await bull.stream.create({ payee: A, amount: "1", ...o }); } catch (e) { err = String(e.message || e); } return { id, err }; };
    const zero = await tryDur({ durationDays: 0 });
    const neg = await tryDur({ durationSeconds: -5 });
    push({ case: "K-4309 stream.create() durationDays=0 / durationSeconds=-5 must REJECT (M-1959)", zeroRejected: zero.err.includes("set durationSeconds or durationDays"), zeroMsg: zero.err.slice(0, 200), negRejected: neg.err.includes("set durationSeconds or durationDays"), negMsg: neg.err.slice(0, 200) });
  }
  if (mode === "k4310") { // M-1962 bull.settle() policy_max_usd + amountUsd decimals (pure validation, like k4221)
    let err51 = "", code51 = "";
    try { await bull.settle({ to: S, amountUsd: 51, template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", policy: { maxUsd: 50 } }); }
    catch (e) { err51 = String(e.message || e); code51 = e?.code || ""; }
    let errDec = "", codeDec = "";
    try { await bull.settle({ to: S, amountUsd: "25.1234567", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", policy: { maxUsd: 50 } }); }
    catch (e) { errDec = String(e.message || e); codeDec = e?.code || ""; }
    push({ case: "K-4310 bull.settle amountUsd 51 > maxUsd 50 refused; 7 decimals refused (M-1960)", refused51: code51 === "policy_max_usd", err51: err51.slice(0, 200), code51, refusedDec: codeDec === "bad_request" && errDec.includes("at most 6 decimals"), errDec: errDec.slice(0, 200), codeDec });
  }
  if (mode === "k4311") { // M-1961 settleCrossChain() dryRun decision (bridge-needed vs not-needed). Second Anvil on 8560 (chain 8453) — Tim A port, NOT 8558 (Tim B).
    const BASE_RPC = "http://127.0.0.1:8560";
    const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const baseChain = defineChain({ id: 8453, name: "Base", nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" }, rpcUrls: { default: { http: [BASE_RPC] } } });
    const pBase = createPublicClient({ chain: baseChain, transport: vhttp(BASE_RPC) });
    const wBase = createWalletClient({ chain: baseChain, transport: vhttp(BASE_RPC), account: victim });
    const rpcBase = async (method, params) => { const r = await fetch(BASE_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); return r.json(); };
    const mocksB = JSON.parse(fs.readFileSync(path.join(ROOT, "mocks/MockERC20.json"), "utf8"));
    const depHash = await wBase.deployContract({ abi: mocksB.abi, bytecode: mocksB.bytecode.object, args: [] });
    const depAddr = (await pBase.waitForTransactionReceipt({ hash: depHash })).contractAddress;
    const depCode = await pBase.getCode({ address: depAddr });
    await rpcBase("anvil_setCode", [USDC, depCode]);
    await rpcBase("anvil_setStorageAt", [USDC, "0x2", toHex32(6n)]);
    await wBase.writeContract({ address: USDC, abi: mocksB.abi, functionName: "mint", args: [V, 1000n * 10n ** 6n] });
    const clients = { base: { walletClient: wBase, publicClient: pBase } };
    const rhBefore = await bal(USDG, V);
    const baseBefore = await pBase.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [V] });
    let big = null, bigErr = "", small = null, smallErr = "";
    try { big = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: S, amount: "600000", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", clients, dryRun: true }); }
    catch (e) { bigErr = String(e.message || e); }
    try { small = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: S, amount: "25", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", clients, dryRun: true }); }
    catch (e) { smallErr = String(e.message || e); }
    const rhAfter = await bal(USDG, V);
    const baseAfter = await pBase.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [V] });
    push({ case: "K-4311 settleCrossChain dryRun: 600k needs bridge (shortfall 100k, Base holds 1000) vs 25 needs none (M-1961)", bigPlan: big ? { bridgeNeeded: big.bridgeNeeded, feasible: big.feasible, bridgeAmount: big.bridgeAmount, missing: big.missing, reason: big.reason } : null, bigErr: bigErr.slice(0, 300), bigMissingToken: (big?.missing || []).some((m) => m.what === "token"), smallPlan: small ? { bridgeNeeded: small.bridgeNeeded, feasible: small.feasible, bridgeAmount: small.bridgeAmount } : null, smallErr: smallErr.slice(0, 300), rhUsdgUnchanged: rhAfter === rhBefore, baseUsdcUnchanged: baseAfter === baseBefore, rhHeldUsdg: rhBefore.toString(), baseHeldUsdc: baseBefore.toString() });
  }

  if (mode === "k4563" || mode === "k4564") { // M-2213/M-2214 bull.settle() amountUsd=0 / -5: is zero rejected client-side?
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    let out0 = null, err0 = "", code0 = "";
    try { out0 = await bull.settle({ to: S, amountUsd: 0, template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", policy: { maxUsd: 50 } }); }
    catch (e) { err0 = String(e.message || e); code0 = e?.code || ""; }
    let outNeg = null, errNeg = "", codeNeg = "";
    try { outNeg = await bull.settle({ to: S, amountUsd: -5, template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", policy: { maxUsd: 50 } }); }
    catch (e) { errNeg = String(e.message || e); codeNeg = e?.code || ""; }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4563/K-4564 bull.settle() amountUsd=0 vs -5 (M-2213/M-2214)", zeroSent: !!out0, zeroErr: err0.slice(0, 300), zeroCode: code0, zeroRejectedClientSide: code0 === "bad_request" && err0.includes("positive number"), zeroReachedPlanFetch: code0 === "plan_unavailable", negRejected: codeNeg === "bad_request" && errNeg.includes("positive number"), negErr: errNeg.slice(0, 200), negCode: codeNeg, zeroTxSent: nonceBefore === nonceAfter });
  }
  if (mode === "k4565") { // M-2215 stream.create() durationDays=-1 must REJECT (SDK secs>=1 check)
    const tryDur = async (o) => { let id = null, err = ""; try { id = await bull.stream.create({ payee: A, amount: "1", ...o }); } catch (e) { err = String(e.message || e); } return { id, err }; };
    const neg = await tryDur({ durationDays: -1 });
    const zero = await tryDur({ durationDays: 0 });
    push({ case: "K-4565 stream.create() durationDays=-1 / 0 must REJECT (M-2215)", negRejected: neg.err.includes("set durationSeconds or durationDays"), negMsg: neg.err.slice(0, 200), zeroRejected: zero.err.includes("set durationSeconds or durationDays"), zeroMsg: zero.err.slice(0, 200) });
  }
  if (mode === "k4566") { // M-2216 FE-OR1 arrival PARTIAL (held = half of need): does runSettleMachine halt?
    const NEED = 25000000n;
    const mkState = () => ({ v: 1, id: "minor19feor1", buyer: V, seller: A, sellerIdentity: A, payeeMode: "same_address", chain: "robinhood", settleKind: "stable", assetName: "usdg", amount: "25", needRaw: NEED.toString(), minGasWei: "300000000000000", planDigest: "0x" + "11".repeat(32), policy: { maxUsd: 100, allowedChains: ["robinhood", "base"], allowedAssets: ["stable"], allowBridge: true, requireDryRun: false, maxBridgeFeeBps: 500 }, bridge: { needed: true, route: "same", originChain: "base", amount: "25", fromAsset: "stable", toAsset: "stable", quoteId: null, txHashes: [], amountUsd: 25 }, agreement: null, phase: "planned", createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86400000, history: [], stateMac: "0x" + "00".repeat(65) });
    const mkIo = (heldTok, sendCounter) => ({
      now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), save: async () => {},
      readSettle: async () => ({ tok: heldTok, eth: 1000000000000000000n }),
      nonces: async () => ({ latest: 7, pending: 7 }),
      maxAgreementId: async () => 0,
      bridgeStatus: async () => ({ status: "confirmed" }),
      payeeCodes: async () => ({ base: "empty", robinhood: "empty" }),
      quoteBridge: async () => ({ id: "0x" + "77".repeat(32), provider: "bull", from: { chain: "base", chainId: 8453 }, to: { chain: "robinhood", chainId: 4663 }, amount: "25", recipient: V, expectedOut: null, steps: [] }),
      sendBridge: async (q) => { sendCounter.n += 1; return ["0x" + "aa".repeat(32)]; },
      findAgreement: async () => null,
      getAgreement: async (id, st) => ({ id, payee: st.seller, payer: st.buyer, amount: st.amount, status: "open", termsHash: settleTermsHash(st), assetOk: true, conditionsOk: true }),
      openAgreement: async () => "7",
    });
    const sc = { n: 0 };
    let err = "", state = null;
    try { state = await runSettleMachine(mkState(), mkIo(NEED / 2n, sc), { pollMs: 10, bridgeTimeoutMs: 5000, arrivalTimeoutMs: 2000 }); } catch (e) { err = String(e.message || e); state = e?.state || null; }
    push({ case: "K-4566 runSettleMachine VERBATIM: partial arrival (held = half of need) must halt, no agreement (M-2216)", sendBridgeCalls: sc.n, phase: state?.phase ?? null, haltCode: state?.halt?.code ?? null, err: err.slice(0, 300), arrivalPending: err.includes("arrival_pending"), agreementOpened: !!(state?.agreement?.id) });
  }
  if (mode === "k4567") { // M-2217 stream.create() payee = payer self (V): SDK sends?
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    current.streamCase = "honest";
    let id = null, err = "";
    try { id = await bull.stream.create({ payee: V, amount: "1", durationSeconds: 86400 }); }
    catch (e) { err = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4567 stream.create() payee=self (payer streams to own wallet) sent as-is (M-2217)", sdkSent: nonceAfter > nonceBefore, sdkThrew: err.slice(0, 200), selfPayeeNotRefused: !err.toLowerCase().includes("payee"), noStreamEventOnly: err.includes("StreamCreated event not found"), id });
  }
  if (mode === "k4574") { // M-2224 re-triage: claim(1) with vesting API 503 (M-233, live still 503)
    let txh = null, err = "";
    try { txh = await bull.claim(1, { locker: "0x1111111111111111111111111111111111111111" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-4574 claim(1) with vesting API 503 (M-233 re-triage)", sdkSent: !!txh, sdkThrew: err.slice(0, 300), threwVestingNotLive: err.includes("Vesting is not live yet"), noTxSent: !txh });
  }
  if (mode === "k4659") { // M-2309 NODE PoC: resume state with baselineId tampered 0->99999 — machine must NOT adopt agreement 1, opens a SECOND $100 agreement
    const stateId = "aabbccddeeff0011";
    const settleTag = `settle:${stateId}\nDeliver the report`;
    const bV0 = await bal(USDG, V), bS0 = await bal(USDG, S);
    let id1 = null, err1 = "";
    try { id1 = await bull.deal("arbiter_escrow", { payee: S, asset: "usdg", amount: "100", arbiter: ARB, terms: settleTag, expiryHours: 72 }); }
    catch (e) { err1 = String(e.message || e); }
    const bV1 = await bal(USDG, V);
    const state = {
      v: 1, id: stateId, buyer: V, seller: S, sellerIdentity: S, payeeMode: "same_address",
      chain: "robinhood", settleKind: "stable", assetName: "usdg", amount: "100", amountUsd: 100,
      needRaw: "100000000", minGasWei: "300000000000000",
      planDigest: "0x" + "11".repeat(32), policy: normalizeSettlePolicy({}),
      bridge: { needed: false }, createdAt: Date.now(), updatedAt: Date.now(),
      phase: "opening", executable: true,
      agreement: { baselineId: 99999, nonce0: Number(await publicClient.getTransactionCount({ address: V })) },
      history: [], request: { template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", expiryHours: 72 },
      expiresAt: Date.now() + 86400000,
    };
    current.tagHash = settleTermsHash(state);
    state.stateMac = await walletV.signMessage({ account: victim, message: settleStateMessage(state) });
    // Harness note: the two createAgreement calls must NOT land in the same
    // wall-clock second, or the on-chain duplicate guard (0xf3fb463d) reverts
    // the byte-identical second call. A real resume happens minutes later, so
    // its expiry differs; sleep 2.5s here to emulate that (nonce0 is
    // unaffected — no transaction is sent while sleeping).
    await new Promise((r) => setTimeout(r, 2500));
    let resumed = null, errR = "";
    try { resumed = await bull.settle.resume(state, {}); }
    catch (e) { errR = String(e.message || e); }
    const bV2 = await bal(USDG, V);
    const nextId = await publicClient.getStorageAt({ address: AGREEMENT, slot: "0x0000000000000000000000000000000000000000000000000000000000000000" });
    let att2 = false, rel2 = false;
    if (resumed?.id) { att2 = await tryCall(walletR, "attest", resumed.id); rel2 = await tryCall(walletA, "release", resumed.id); }
    const bS2 = await bal(USDG, S);
    push({ case: "K-4659 NODE resume baselineId 99999: agreement 1 hidden, SECOND $100 agreement opened + funded, duplicate released to seller (M-2309)", firstAgreementId: id1 ? String(id1) : null, firstErr: err1.slice(0, 200), buyerLockedFirst100: (bV0 - bV1).toString(), resumedId: resumed?.id ?? null, resumeErr: errR.slice(0, 300), buyerLockedSecond100: (bV1 - bV2).toString(), buyerLockedTotalUsdg: usdg(bV0 - bV2), nextAgreementIdSlot: nextId, secondAgreementOpened: resumed?.id === "2", duplicateAttested: att2, duplicateReleased: rel2, sellerGainedFromDuplicateUsdg: usdg(bS2 - bS0), doubleOpenProvenOnChain: resumed?.id === "2" && (bV1 - bV2) === 100n * 10n ** 6n && rel2 });
  }
  if (mode === "k4662") { // M-2312 crossChainSettle payerChain == sellerChain must refuse before any quote
    let out = null, err = "";
    try { out = await bull.crossChainSettle({ payerChain: "robinhood", sellerChain: "robinhood", amount: "25" }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-4662 crossChainSettle same chain (robinhood->robinhood) refused (M-2312)", refusedSameChain: err.includes("both agents are on the same chain"), errMsg: err.slice(0, 200), resolved: !!out });
  }
  if (mode === "k4663") { // M-2313 bridge.quote ETH step carrying MORE than the amount must refuse; exact-value control resolves
    const tryQ = async (qc) => {
      current.quoteCase = qc;
      let q = null, err = "";
      try { q = await bull.bridge.quote({ from: "base", to: "robinhood", amount: "0.01", fromAsset: "eth", toAsset: "eth" }); }
      catch (e) { err = String(e.message || e); }
      return { q, err };
    };
    const over = await tryQ("over");
    const exact = await tryQ("exact");
    push({ case: "K-4663 bridge.quote ETH step value 0.02 > amount 0.01 refused; exact 0.01 control resolves (M-2313)", overRefused: over.err.includes("more ETH than the amount you bridge"), overMsg: over.err.slice(0, 200), exactResolved: !!exact.q, exactErr: exact.err.slice(0, 200) });
  }
  if (mode === "k4664") { // M-2314 stream.create amount "0" / amountRaw "0" must refuse before any send
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    current.streamCase = "honest";
    const tryAmt = async (o) => { let id = null, err = ""; try { id = await bull.stream.create({ payee: A, durationSeconds: 86400, ...o }); } catch (e) { err = String(e.message || e); } return { id, err }; };
    const zero = await tryAmt({ amount: "0" });
    const zeroRaw = await tryAmt({ amountRaw: "0" });
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4664 stream.create amount 0 / amountRaw 0 refused (M-2314)", zeroRejected: zero.err.includes("stream amount must be above 0"), zeroMsg: zero.err.slice(0, 200), zeroRawRejected: zeroRaw.err.includes("stream amount must be above 0"), zeroRawMsg: zeroRaw.err.slice(0, 200), zeroTxSent: nonceBefore === nonceAfter });
  }
  if (mode === "k4665") { // M-2315 deal(optimistic) windowHours=0 — silently treated as 24h (K-4601 family)
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    let id = null, err = "";
    try { id = await bull.deal("optimistic", { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 0 }); }
    catch (e) { err = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4665 deal(optimistic) windowHours=0 sent as 24h window (M-2315)", sdkSent: !!id, agreementId: id ? String(id) : null, sdkThrew: err.slice(0, 200), txSent: nonceAfter > nonceBefore });
  }
  if (mode === "k4668") { // M-2318 open() sellToken == payToken must refuse before any quote/send
    const nonceBefore = await publicClient.getTransactionCount({ address: V });
    let id = null, err = "";
    try { id = await bull.open({ seller: S, sellToken: USDG, sellAmount: "1000", payAsset: "usdg", payAmount: "250" }); }
    catch (e) { err = String(e.message || e); }
    const nonceAfter = await publicClient.getTransactionCount({ address: V });
    push({ case: "K-4668 open() sellToken == payToken (USDG == usdg) refused (M-2318)", refusedMustDiffer: err.includes("sellToken and the payment asset must differ"), errMsg: err.slice(0, 200), dealOpened: !!id, zeroTxSent: nonceBefore === nonceAfter });
  }
  if (mode === "k4669") { // M-2319 settleCrossChain seller == buyer must refuse before any balance read/bridge
    let out = null, err = "";
    try { out = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: V, amount: "25", template: "arbiter_escrow", arbiter: ARB, terms: "Deliver the report", dryRun: true }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-4669 settleCrossChain seller == buyer refused (M-2319)", refusedDifferentWallets: err.includes("seller and the buyer must be different wallets"), errMsg: err.slice(0, 200), resolved: !!out });
  }
  console.log(JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(ROOT, `node-result-${mode}.json`), JSON.stringify({ mode, sdk: "b6e7d25c91d1a77f324ec1e97109f01e5ba5110f52f5f1f949fd5ab7d09afe2b", agreement: "v4.1-0x7AB58fAAe65eFCF0037635382cAA546EaC233DA6", results }, null, 2));
  server.close();
  process.exit(0);
}
main().catch((e) => { console.error("RUNNER FATAL", e); server.close(); process.exit(2); });
