// Bull SDK: agent-to-agent settlement. Agents choose the terms, Bull settles them. Non-custodial, no account, no API key.
//
// WHEN TO USE: your agent must pay (or be paid by) another agent it does not trust, and the payment depends on something:
// delivery confirmed by an arbiter, milestones, a dispute / veto window, k-of-n votes, a time, another deal, an onchain value.
// The money is locked in a contract and released when the agreed conditions are true. Not for tiny pay-per-call payments (use x402 "exact").
//
//   import { Bull } from "./bull.mjs";            // needs `viem` installed (npm i viem)
//   const bull = new Bull({ walletClient, publicClient, chain: "base" });   // Base (USDC) or "robinhood" (default, USDG/ETH)
//
//   // 1. Any block in one call. ALL template names: delivery_vs_payment, arbiter_escrow, two_of_three, panel, optimistic, confirmed_with_cooling, milestones, scheduled_payment,
//   //    recurring_payment, split_payment, after_deal, balance_trigger, price_trigger, token_price_trigger (Robinhood only), performance_bond. Fields per template: bull.templates().
//   const id = await bull.deal("arbiter_escrow", { payee, asset: "usdc", amount: "5", arbiter, terms: "Deliver the report" });
//   await bull.attest(id);                        // run by the ARBITER wallet (a third wallet, never the seller)
//   await bull.release(id);                       // pays the payee (anyone can send it, the keeper also does). After expiry: bull.refund(id)
//   // Expiry: expiryHours defaults to 72. Until the expiry the payee can be paid once the conditions are true; AFTER it release() is impossible and anyone can send bull.refund(id) (money back to the payer).
//   // Set expiryHours long enough for the work plus the arbiter's reaction time. Templates with windows/schedules raise it automatically (windowHours + 24, afterHours + 24, ...).
//   // A template that needs an arbiter (arbiter_escrow, milestones, performance_bond, confirmed_with_cooling, two_of_three) refuses without one. Demo only: conditions [{ type: "attest", by: payerWallet }] lets the PAYER alone decide;
//   // for an untrusted seller use arbiter_escrow with a third-wallet arbiter.
//   //
//   // UNITS: every amount is a string in WHOLE units ("5" = 5 USDC, "0.01" = 0.01 ETH). Only exceptions: x402 amounts (atomic, 6 decimals) and streams amountRaw (integer string).
//   // FEES: agreements, templates, streams and vesting charge 0.5% of the value (min $0.25, max $250) in NATIVE ETH, paid by the payer on top. RFQ/swap (delivery_vs_payment) fees are 2.5% / 2.0% / 1.5% of the payment (see llms.txt).
//   // So a wallet that holds only USDC on Base still needs a little ETH on Base for the fee and gas. agree()/deal()/stream.create() check this BEFORE sending and say "Need at least X ETH on <chain> ...".
//   // WALLET ADDRESS NAMES: the receiving party is `payee` in agree()/deal()/stream.create()/settleCrossChain (also `sellerAddress`), `seller` in open()/quote()/consent() (the swap), `to` in settle(), `user` in bridge.quote() (the buyer's own wallet).
//   // OBTAINING FUNDS: Robinhood Chain gas is ETH and the stable is USDG (0x5fc5...d168); get both there by bridging from Base with bull.bridge.quote (ETH or USDC -> ETH or USDG; third-party Relay, experimental) or from a Robinhood-supported exchange or on-ramp.
//   // Base: ETH and USDC come from any exchange or on-ramp that supports Base.
//   //
//   // 1b. Streaming payments (pay per second), same verification as agree(): tx decoded, chainId, target = this chain's Streams contract, payee, arbiter, asset, amount, start, duration, fee.
//   //     const sid = await bull.stream.create({ payee, amount: "100", token: "usdc" /* omit = native ETH on both chains */, durationDays: 30 });   // id from the StreamCreated event; the fee quote is valid 1 hour
//   //     await bull.stream.status(sid);            // vested, withdrawn, withdrawable (public read)
//
//   // 2. Your own conditions:  bull.agree({ payee, asset: "usdc", amount: "5", conditions: [{ type: "attest", by }, { type: "veto", by, afterHours: 24, attestIndex: 0 }] })
//
//   // 3. Atomic token swap (delivery vs payment). Robinhood Chain: pay in ETH or USDG. Base (chain: "base"): pay in USDC. On Base the swap (delivery_vs_payment) is not tested with a live deal yet; agreements and streams are live there. Contracts unaudited.
//   //    seller:  const c = await bullSeller.consent({ buyer, sellToken, sellAmount: "1000", payAsset: "usdc", payAmount: "250" });   // EIP-712, bound to this chain's escrow
//   //    buyer:   const dealId = await bull.open({ seller, sellToken, sellAmount: "1000", payAsset: "usdc", payAmount: "250", ...c });  await bull.fund(dealId);   // Robinhood: payAsset "eth" or "usdg"
//   //    await bull.fund(dealId); await bull.waitSettled(dealId);
//
//   // Only OPEN + FUND: bull.settle() / bull.settleCrossChain() open and fund the agreement. They never attest or release: the arbiter then calls bull.attest(id), after which anyone calls bull.release(id).
//   //
//   // 4. Cross-chain (Base agent <-> Robinhood agent), no contract change. The agreement lives on ONE chain (the settlement chain, default the seller's).
//   //    The agent on the other chain first bridges its stablecoin to your own address with Relay (third party, experimental, untested end to end):
//   //    USDC on Base arrives as USDG on Robinhood Chain, USDG arrives as USDC on Base. Bull never touches bridge funds; the recipient is always you.
//   //    const b = new Bull({ walletClient, publicClient, chain: "base" });          // clients on the ORIGIN chain; optional relayApiKey: "..." calls Relay directly
//   //    const q = await b.bridge.quote({ from: "base", to: "robinhood", amount: "25" });  await b.bridge.send(q);  await b.bridge.wait(q.id);   // then open the agreement on the other chain
//   //    const plan = await b.crossChainSettle({ payerChain: "base", sellerChain: "robinhood", amount: "25" });   // ordered steps: bridge -> approve + open agreement -> release (does not send anything)
//   //    Needs a little ETH on the settlement chain for gas and the protocol fee. Runnable: https://www.bull.family/examples/crosschain-base-to-robinhood.mjs
//
//   // 5. Say WHAT, not HOW (EXPERIMENTAL): bull.settle({ to, amountUsd: 25, template: "arbiter_escrow", arbiter, terms, policy: { maxUsd: 50 }, clients }) decides chain, asset and bridge (seller's signed payout prefs > the chain where you already hold enough > cheapest bridge),
//   //    returns a resumable `state`; bull.settle.resume(state) is idempotent and never sends a bridge or an agreement twice. Errors: BullSettleError { code, message, fix, retryable }. bull.payoutPrefs.get/set. Runnable: https://www.bull.family/examples/settle-natural.mjs
//   // 6. Cross-chain, automatic (Stage 2): bull.settleCrossChain({ settlementChain, sellerAddress, amount, ... }) decides for you. WHEN BRIDGED, WHEN NOT:
//   //    Every agreement lives on exactly ONE chain, the seller's (the settlement chain), and the seller never bridges. If the buyer already holds enough of that chain's
//   //    token (USDC on Base, USDG on Robinhood) plus a little ETH for gas, NOTHING is bridged and the agreement is simply opened and funded there. Only when the buyer's
//   //    money is on the OTHER chain does it bridge exactly the shortfall (+5%) to the buyer's own address with Relay, wait for it to arrive, then open the agreement.
//   //    CALL SHAPE: `bull` is an instance on the SETTLEMENT chain (clients of that chain); `clients` holds the OTHER chain. The buyer needs ETH on the settlement chain (fee + gas) and, only if a bridge is needed, ETH on the other chain too.
//   //    Settlement chain Robinhood (bull on Robinhood, clients: { base }) shown below. Settlement chain Base (seller is paid in USDC): new Bull({ walletClient: wBase, publicClient: pBase, chain: "base" }) and
//   //    clients: { robinhood: { walletClient: wRh, publicClient: pRh } }. Runnable: https://www.bull.family/examples/crosschain-robinhood-to-base.mjs
//   //    No `arbiter` (and no `conditions`) with the default template arbiter_escrow = an error BEFORE any bridging, also with dryRun. The ETH reserve on the settlement chain is max(minGasEth, protocol fee estimate x 1.1 + gas).
//   //    const plan = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress, amount: "25", dryRun: true, clients: { base: { publicClient: pBase } } });   // sends nothing: "bridge: not needed" or "bridge 21 USDC -> USDG"
//   //    const out  = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress, amount: "25", template: "arbiter_escrow", arbiter, terms, clients: { base: { walletClient: wBase, publicClient: pBase } } });
//   //    Any failed step stops it with an error that says what is missing; funds then stay with the buyer. Server twin: GET/POST /api/v1/bridge/plan. Runnable: https://www.bull.family/examples/crosschain-auto.mjs
//
// Check a counterparty first: GET https://www.bull.family/api/v1/agents/{wallet}. Runnable example: https://www.bull.family/examples/quickstart-base.mjs
// `walletClient` and `publicClient` are standard viem clients on the chain you pick. Robinhood is 4663, Base is 8453.
// Status: beta, contracts not audited. Every transaction the server returns is checked here before it is sent (see below).

import { parseEventLogs, parseAbi, parseEther, parseUnits, erc20Abi, recoverMessageAddress, decodeFunctionData, encodeAbiParameters, encodeFunctionData, keccak256, toHex } from "viem";

// Safety: the API server is not trusted with your wallet. Every transaction it returns is checked before it is sent, and the
// consent message is checked against what YOU asked for before it is signed. Only these contracts can ever receive a transaction.
const DEFAULT_BASE = "https://www.bull.family";
const ESCROWS = ["0xd961ca37e339e14e0d3478383a252e218fe7aa4a"]; // the current escrow (v3, fees buy and burn BULL). Older escrows are not used by the SDK.
const FEE_SIGNER = "0x585770c10434fa6d434b6b27316354f9d1688bd0"; // signs receipts
const AGREEMENT = "0x7ab58faae65efcf0037635382caa546eac233da6"; // Agreement v4.1 (live 2026-11-21, adds the veto window); v4 0x3d8f... and v3 0x84c6... are retired
const ZERO = "0x0000000000000000000000000000000000000000";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const low = (x) => String(x || "").toLowerCase();
const bad = (m) => { throw new Error("Bull SDK safety check failed: " + m); };

const AGR_ABI = parseAbi(["event AgreementCreated(uint256 indexed id, address indexed payer, address indexed payee, address asset, uint256 amount, uint64 expiry, bytes32 termsHash)"]);
const LOCK_ABI = parseAbi(["event LockCreated(uint256 indexed id, address indexed token, address indexed beneficiary, address creator, uint256 amount, uint64 start, uint64 cliff, uint64 end, uint64 step)"]);

// The only functions the SDK ever sends to a Bull contract. Everything else is refused, and the arguments are checked against what you asked for.
const FN_ABI = parseAbi([
  "function createDeal((address seller,address sellerPayout,address buyerReceive,address sellToken,uint256 sellAmount,address payToken,uint256 payAmount,uint64 deadline) p,(uint16 feeBps,uint64 expiry,bytes sig) q,(uint64 validUntil,bytes sig) c) returns (uint256)",
  "function fundPayment(uint256 id) payable",
  "function fundTokens(uint256 id)",
  "function fundTokensWithPermit(uint256 id,uint256 permitDeadline,uint8 v,bytes32 r,bytes32 s,bytes fundSig)",
  "function cancel(uint256 id)",
  "function createAgreement((address payee,address asset,uint256 amount,uint64 expiry,bytes32 termsHash,(uint8 kind,address target,bytes data,uint256 value)[] conditions) p,(uint256 feeWei,uint64 expiry,bytes sig) q) payable returns (uint256)",
  "function attest(uint256 id,uint256 index)",
  "function object(uint256 id,uint256 index)",
  "function vote(uint256 id,uint256 index)",
  "function release(uint256 id)",
  "function refund(uint256 id)",
  "function createStream((address payee,address arbiter,address asset,uint256 amount,uint64 start,uint64 durationSecs) p,(uint256 feeWei,uint64 expiry,bytes sig) q) payable returns (uint256)",
]);
const STREAM_EVT = parseAbi(["event StreamCreated(uint256 indexed id,address indexed payer,address indexed payee,address arbiter,address asset,uint256 amount,uint64 start,uint64 end)"]);
const GAS_RESERVE_WEI = 50000000000000n; // 0.00005 ETH: what the preflight keeps for gas on top of the protocol fee (and the locked amount when the asset is ETH)
const ethStr = (v) => { const x = BigInt(v).toString().padStart(19, "0"); return (x.slice(0, -18) + "." + x.slice(-18)).replace(/0+$/, "").replace(/\.$/, ""); };
const CHAINS = {
  robinhood: { id: 4663, name: "Robinhood Chain", escrows: ESCROWS, agreement: AGREEMENT, stable: USDG, alias: "usdg", stream: "0xf02ad48d7ae63f17941e78aaf228c1450db13891" },
  // Base (live 2026-11-21): USDC is the main currency. The instant escrow (delivery_vs_payment) runs on Base too (USDC only; unaudited, not tested with a live deal).
  base: { id: 8453, name: "Base", escrows: ["0x22b6bd2b101959c970130ccf6738981925419687"], agreement: "0x81d4a3a3b4cdd43c32b14949a15521b4ce7a1391", stable: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", alias: "usdc", stream: "0x6aacee092c150bd901883167a9e2d328a476a03a" },
};

const DEALS_ABI = parseAbi(["function deals(uint256) view returns (address buyer,address seller,address sellToken,uint256 sellAmount,address payToken,uint256 payAmount,uint64 deadline,bool buyerFunded,bool sellerFunded,uint8 status,address sellerPayout,address buyerReceive,uint16 feeBps)"]);
const ABI = parseAbi(["event DealCreated(uint256 indexed id, address indexed buyer, address indexed seller, uint16 feeBps)"]);


// Cross-chain (bridge) helpers. Third-party intents bridge (Relay). Bull never touches bridge funds. Everything the server (or Relay) returns is checked here before it is sent.
const RELAY_API = "https://api.relay.link";
const BRIDGE = {
  base: { id: 8453, name: "Base", symbol: "USDC", token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", asset: "usdc" },
  robinhood: { id: 4663, name: "Robinhood Chain", symbol: "USDG", token: USDG, asset: "usdg" },
};
const bridgeChain = (v) => { const k = low(v); if (k === "arc") bad("Arc is not supported by the bridge helper."); const c = BRIDGE[k]; if (!c) bad('bridge chains are "base" and "robinhood".'); return { key: k, ...c }; };
const toRaw = (amount, asset = "usdc_usdg") => {
  if (asset === "eth") { const m = /^(\d{1,6})(?:\.(\d{1,18}))?$/.exec(String(amount ?? "").trim()); if (!m) bad('amount must be a whole-unit ETH string like "0.01" (max 18 decimals).'); return BigInt(m[1]) * 10n ** 18n + BigInt((m[2] || "").padEnd(18, "0")); }
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(String(amount ?? "").trim()); if (!m) bad('amount must be a whole-unit string like "25" or "25.5" (max 6 decimals).'); return BigInt(m[1]) * 1000000n + BigInt((m[2] || "").padEnd(6, "0"));
};
const PENDING_BRIDGES = new Map(); // buyer|route -> { id }: bridges this process started and has not seen finish (see settleCrossChain pendingBridge / onBridge)
const NATIVE = "0x0000000000000000000000000000000000000000", DEAD = "0x000000000000000000000000000000000000dead";
const bridgeAsset = (v) => { const k = low(v || "usdc_usdg"); if (k === "eth" || k === "native") return "eth"; if (k === "usdc_usdg" || k === "usdc" || k === "usdg" || k === "stable") return "usdc_usdg"; bad('asset must be "usdc_usdg" (default) or "eth".'); };
const kindOf = (v, field) => { const k = low(v || "stable"); if (k === "eth" || k === "native") return "eth"; if (k === "stable" || k === "usd" || k === "usdc" || k === "usdg" || k === "usdc_usdg") return "stable"; bad(`${field} must be "eth" or "stable".`); };
const MIX_RATIO = 0.97; // swap routes (ETH <-> stable): the quote must return at least this share of the input value in USD (same default as the server, BRIDGE_MIN_OUTPUT_RATIO)
/** Value check for a swap route in USD (ETH priced with a spot price, stable = $1). Fails closed without a price. */
function mixedValueCheck(req, out, price) {
  if (!(price > 0)) bad("could not read the ETH/USD price to check the swap quote. Try again.");
  if (out === null || out === undefined) bad("the swap quote states no output amount.");
  const inUsd = req.inKind === "eth" ? Number(req.raw) / 1e18 * price : Number(req.raw) / 1e6;
  const outUsd = req.outKind === "eth" ? Number(out) * price : Number(out);
  if (!(outUsd + 1e-9 >= inUsd * MIX_RATIO)) bad(`the swap quote returns about $${outUsd.toFixed(2)} for about $${inUsd.toFixed(2)} sent, less than ${Math.round(MIX_RATIO * 100)}% (slippage and fees too high).`);
}
// ETH/USD: Coinbase and Kraken must both answer and agree within 2%, the result is their mean (same rule as the server). One source down or >2% apart = null, callers refuse.
const spotFrom = async (url, pick) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(4000) }); if (r.ok === false) return null; const n = Number(pick(await r.json())); return Number.isFinite(n) && n > 0 ? n : null; } catch { return null; } };
const ethSpot = async () => {
  const [a, b] = await Promise.all([spotFrom("https://api.coinbase.com/v2/prices/ETH-USD/spot", (j) => j?.data?.amount), spotFrom("https://api.kraken.com/0/public/Ticker?pair=ETHUSD", (j) => { const t = j?.result ? Object.values(j.result)[0] : null; return t?.c?.[0]; })]);
  if (a === null || b === null) return null;
  return Math.abs(a - b) / Math.min(a, b) > 0.02 ? null : (a + b) / 2;
};
const envList = (name) => (typeof process !== "undefined" && process.env?.[name] ? String(process.env[name]).toLowerCase().split(",").map((x) => x.trim()).filter(Boolean) : []);
/** Same rules the server applies: plain transactions on the origin chain, from you, no native value, approvals only on the input token for at most the amount, recipient = you. */
function checkBridge(q, req) {
  const eth = req.inKind ? req.inKind === "eth" : req.asset === "eth";
  const spenders = [], targets = [];
  if (req.outCur && q?.to?.token && low(q.to.token) !== low(req.outCur)) bad("the bridge pays out another currency than you asked for.");
  if (!q || !Array.isArray(q.steps) || !q.steps.length || q.steps.length > 4) bad("the bridge quote has no usable steps.");
  if (q.recipient && low(q.recipient) !== low(req.user)) bad("the bridge recipient is not your own address.");
  if (q.to?.chainId !== undefined && Number(q.to.chainId) !== req.to.id) bad("the bridge pays out on another chain than you asked for.");
  for (const s of q.steps) {
    const t = s?.transaction;
    if (!t || Number(t.chainId) !== req.from.id) bad(`a bridge step is not for ${req.from.name} (${req.from.id}).`);
    if (t.from && low(t.from) !== low(req.user)) bad("a bridge step is sent from another address than yours.");
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(t.to || ""))) bad("a bridge step has no valid target.");
    const data = String(t.data || "0x");
    if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) bad("a bridge step has invalid calldata.");
    if (!/^\d+$/.test(String(t.value || "0"))) bad("a bridge step has an invalid value.");
    if (eth) {
      // Native ETH: exactly one transaction, it carries the value, never more than the exact amount, no approval, target is not a Bull / burn / token address or you.
      const v = BigInt(t.value || "0");
      if (v <= 0n) bad("an ETH bridge step carries no value.");
      if (v > req.raw) bad("a bridge step sends more ETH than the amount you bridge.");
      if (data.startsWith("0x095ea7b3")) bad("an ETH bridge needs no token approval.");
      if (req.forbid?.has(low(t.to)) || low(t.to) === low(req.user)) bad("a bridge step sends ETH to a Bull contract, a burn address, a token contract or yourself instead of a bridge router.");
      if (req.allowedTo?.length && !req.allowedTo.includes(low(t.to))) bad("the ETH bridge target is not in your pinned router list (BRIDGE_ETH_ALLOWED_TO).");
      continue;
    }
    if (BigInt(t.value || "0") !== 0n) bad("a bridge step sends native coin. A stablecoin bridge never needs that.");
    if (data.startsWith("0x095ea7b3")) {
      if (low(t.to) !== req.from.token) bad("a bridge approval is on another token than the one you bridge.");
      if (!/^0x[0-9a-fA-F]{136}$/.test(data) || BigInt("0x" + data.slice(74, 138)) > req.raw) bad("a bridge approval is malformed or for more than the amount you bridge.");
      spenders.push("0x" + data.slice(34, 74).toLowerCase());
    } else targets.push(low(t.to));
    if (low(t.to) === req.from.token && !data.startsWith("0x095ea7b3")) bad("a bridge step calls the token contract with something other than an approval.");
    if (!data.startsWith("0x095ea7b3") && req.forbid?.has(low(t.to))) bad("a bridge step calls a Bull contract, a burn address or yourself instead of a bridge router.");
  }
  // Every route from a stable token: an approval may only name a spender the quote itself uses as a transaction target, or one you pinned (req.allowedSpenders / env BRIDGE_ALLOWED_SPENDERS, which then decides alone). Never a Bull / burn address.
  if (!eth) for (const sp of spenders) {
    if (req.forbid?.has(sp)) bad("a bridge approval names a Bull contract, a burn address or yourself as spender.");
    if (!(req.allowedSpenders?.length ? req.allowedSpenders.includes(sp) : targets.includes(sp))) bad("a bridge approval names a spender that is not the target of the quoted transaction (pin a verified one with BRIDGE_ALLOWED_SPENDERS).");
  }
  if (eth && q.steps.length !== 1) bad("an ETH bridge must be exactly one transaction that carries the value.");
  return q;
}
/** Relay /quote/v2 response -> Bull's transaction-step shape (same as POST /api/v1/bridge/quote). */
function relayToBull(req, j, price = null) {
  const d = j?.details || {};
  if (!d.recipient || low(d.recipient) !== low(req.user)) bad("Relay's recipient is missing or is not your address.");
  const eth = req.inKind === "eth", outEth = req.outKind === "eth";
  if (outEth && low(d.currencyOut?.currency?.address) !== NATIVE) bad("Relay's output currency is not native ETH.");
  if (req.mixed && !d.currencyOut?.currency?.address) bad("Relay did not state the output currency.");
  if (req.mixed && low(d.currencyOut.currency.address) !== low(req.outCur)) bad("Relay's output currency is not the one you asked for (swap route).");
  if (eth && low(d.currencyIn?.currency?.address) !== NATIVE) bad("Relay's input currency is not native ETH.");
  if ((eth || outEth) && d.currencyOut?.currency?.chainId !== undefined && Number(d.currencyOut.currency.chainId) !== req.to.id) bad("Relay's output chain is not the expected one.");
  if (!outEth && d.currencyOut?.currency?.address && low(d.currencyOut.currency.address) !== req.to.token) bad("Relay's output token is not the expected one.");
  let out = null; try { if (d.currencyOut?.amount !== undefined) out = BigInt(String(d.currencyOut.amount)); } catch { bad("Relay's output amount is not a number."); }
  if ((eth || outEth) && out === null) bad("Relay stated no output amount.");
  if (eth && d.currencyIn?.amount !== undefined && BigInt(String(d.currencyIn.amount)) > req.raw) bad("Relay charges more than the amount you bridge.");
  if (req.mixed) mixedValueCheck(req, out === null ? null : Number(out) / (outEth ? 1e18 : 1e6), price);
  else if (out !== null && out * 100n < req.raw * 95n) bad("the quote returns less than 95% of the amount sent.");
  const steps = []; let id = null;
  for (const s of j?.steps || []) {
    if (s?.kind && s.kind !== "transaction") bad(`step "${s?.id}" is a ${s.kind} step; the SDK only sends plain transactions.`);
    for (const it of s?.items || []) {
      const t = it?.data; if (!t) continue;
      const rid = String(s?.requestId || /requestId=(0x[0-9a-fA-F]{64})/.exec(String(it?.check?.endpoint || ""))?.[1] || "");
      if (!id && /^0x[0-9a-fA-F]{64}$/.test(rid)) id = rid;
      steps.push({ name: s.id === "approve" || String(t.data || "").startsWith("0x095ea7b3") ? "approve" : String(s.id || "bridge"), transaction: { chainId: Number(t.chainId), from: t.from || req.user, to: t.to, value: String(t.value || "0"), data: t.data || "0x" } });
    }
  }
  const fmtOut = (v) => { const dd = outEth ? 18 : 6; const x = v.toString().padStart(dd + 1, "0"); const f = x.slice(-dd).replace(/0+$/, ""); return x.slice(0, -dd) + (f ? "." + f : ""); };
  return { id, provider: "relay", asset: req.asset, fromAsset: req.inKind, toAsset: req.outKind, mixed: !!req.mixed, from: { chain: req.from.key, chainId: req.from.id, asset: eth ? "ETH" : req.from.symbol, token: eth ? NATIVE : req.from.token }, to: { chain: req.to.key, chainId: req.to.id, asset: outEth ? "ETH" : req.to.symbol, token: outEth ? NATIVE : req.to.token }, amount: req.amount, recipient: req.user, expectedOut: out === null ? null : fmtOut(out), steps };
}

// Stage 2 decision (same rule as GET/POST /api/v1/bridge/plan). Raw units: 6 decimals for the stablecoins, wei for ETH. Pure, sends nothing.
// Rule: the agreement lives on the seller's chain. Enough token + gas there -> NO bridge. Otherwise bridge exactly the shortfall (+ buffer) from the buyer's own funds on the other chain.
function decideCross({ amountRaw, bal, sc, oc, minSettleWei, minOriginWei, bufferBps }) {
  const fmt = (v, d = 6) => { const x = v.toString().padStart(d + 1, "0"); const f = x.slice(-d).replace(/0+$/, ""); return x.slice(0, -d) + (f ? "." + f : ""); };
  const missing = [];
  const shortfall = amountRaw > bal.sTok ? amountRaw - bal.sTok : 0n;
  if (bal.sEth < minSettleWei) missing.push({ what: "gas", chain: sc.key, asset: "ETH", need: fmt(minSettleWei, 18), have: fmt(bal.sEth, 18), message: `the buyer needs about ${fmt(minSettleWei - bal.sEth, 18)} more ETH on ${sc.name} (gas and the protocol fee). A bridge cannot supply ETH.` });
  if (shortfall === 0n) return { bridgeNeeded: false, feasible: !missing.length, shortfall, bridgeAmount: null, missing, reason: `bridge: not needed. The buyer already holds ${fmt(bal.sTok)} ${sc.symbol} on ${sc.name}, the settlement chain (needs ${fmt(amountRaw)}).` };
  let bridgeAmount = (shortfall * BigInt(10000 + bufferBps) + 9999n) / 10000n;
  if (bridgeAmount < 1000000n) bridgeAmount = 1000000n; // the bridge minimum is 1
  if (bridgeAmount > 10000n * 1000000n) missing.push({ what: "limit", chain: oc.key, asset: oc.symbol, need: fmt(bridgeAmount), message: `the bridge amount ${fmt(bridgeAmount)} ${oc.symbol} is above the Bull bridge cap of 10000. Split the deal.` });
  else if (bal.oTok < bridgeAmount) missing.push({ what: "token", chain: oc.key, asset: oc.symbol, need: fmt(bridgeAmount), have: fmt(bal.oTok), message: `the buyer needs ${fmt(bridgeAmount)} ${oc.symbol} on ${oc.name} to bridge the shortfall of ${fmt(shortfall)} ${sc.symbol} plus a buffer, and has ${fmt(bal.oTok)}. Missing ${fmt(bridgeAmount - bal.oTok)} ${oc.symbol}.` });
  if (bal.oEth < minOriginWei) missing.push({ what: "gas", chain: oc.key, asset: "ETH", need: fmt(minOriginWei, 18), have: fmt(bal.oEth, 18), message: `the buyer needs about ${fmt(minOriginWei - bal.oEth, 18)} more ETH on ${oc.name} for the bridge transactions.` });
  return { bridgeNeeded: true, feasible: !missing.length, shortfall, bridgeAmount, missing, reason: `bridge ${fmt(bridgeAmount)} ${oc.symbol} -> ${sc.symbol}: the buyer holds ${fmt(bal.sTok)} ${sc.symbol} on ${sc.name} but the agreement needs ${fmt(amountRaw)}.` };
}

// ETH variant of the decision: the agreement locks `amountWei` of native ETH on the settlement chain and the buyer must also keep a gas/fee reserve there; the origin chain keeps its own reserve after the bridge.
function decideCrossEth({ amountWei, sEth, oEth, sc, oc, minSettleWei, minOriginWei, bufferBps, minBridgeWei, maxBridgeWei }) {
  const fmt = (v, d = 18) => { const x = v.toString().padStart(d + 1, "0"); const f = x.slice(-d).replace(/0+$/, ""); return x.slice(0, -d) + (f ? "." + f : ""); };
  const missing = [];
  const target = amountWei + minSettleWei;
  const shortfall = target > sEth ? target - sEth : 0n;
  if (shortfall === 0n) return { bridgeNeeded: false, feasible: true, shortfall, bridgeAmount: null, missing, reason: `bridge: not needed. The buyer already holds ${fmt(sEth)} ETH on ${sc.name}, the settlement chain (needs ${fmt(amountWei)} ETH plus a ${fmt(minSettleWei)} ETH reserve for gas and the protocol fee).` };
  let bridgeAmount = (shortfall * BigInt(10000 + bufferBps) + 9999n) / 10000n;
  if (bridgeAmount < minBridgeWei) bridgeAmount = minBridgeWei;
  if (bridgeAmount > maxBridgeWei) missing.push({ what: "limit", chain: oc.key, asset: "ETH", need: fmt(bridgeAmount), message: `the bridge amount ${fmt(bridgeAmount)} ETH is above the Bull bridge cap (${fmt(maxBridgeWei)} ETH). Split the deal.` });
  const needOrigin = bridgeAmount + minOriginWei;
  if (oEth < needOrigin) missing.push({ what: "token", chain: oc.key, asset: "ETH", need: fmt(needOrigin), have: fmt(oEth), message: `the buyer needs ${fmt(needOrigin)} ETH on ${oc.name} (bridge ${fmt(bridgeAmount)} plus a ${fmt(minOriginWei)} ETH gas reserve that stays) and has ${fmt(oEth)}. Missing ${fmt(needOrigin - oEth)} ETH.` });
  return { bridgeNeeded: true, feasible: !missing.length, shortfall, bridgeAmount, missing, reason: `bridge ${fmt(bridgeAmount)} ETH -> ETH on ${sc.name}: the buyer holds ${fmt(sEth)} ETH there but needs ${fmt(target)} (${fmt(amountWei)} + reserve).` };
}

// Swap route (ETH <-> stable, Relay swap): pay with the OTHER asset than the agreement is denominated in. Values in USD (ETH at `price`, stable = $1). bridgeAmount is in the ORIGIN asset's raw units (6 decimals or wei).
function decideCrossMixed({ amountRaw, settleEth, s, o, sc, oc, price, minSettleWei, minOriginWei, mixedBufferBps = 800, minUsd = 1, maxUsd = 10000 }) {
  const fmt = (v, d) => { const x = BigInt(v).toString().padStart(d + 1, "0"); const f = x.slice(-d).replace(/0+$/, ""); return x.slice(0, -d) + (f ? "." + f : ""); };
  const missing = [], sd = settleEth ? 18 : 6, od = settleEth ? 6 : 18, osym = settleEth ? oc.symbol : "ETH", ssym = settleEth ? "ETH" : sc.symbol;
  const target = settleEth ? amountRaw + minSettleWei : amountRaw, have = settleEth ? s.eth : s.tok;
  const shortfall = target > have ? target - have : 0n;
  if (!settleEth && s.eth < minSettleWei) missing.push({ what: "gas", chain: sc.key, asset: "ETH", need: fmt(minSettleWei, 18), have: fmt(s.eth, 18), message: `the buyer needs about ${fmt(minSettleWei - s.eth, 18)} more ETH on ${sc.name} (gas and the protocol fee).` });
  const shortMicro = settleEth ? BigInt(Math.ceil(Number(fmt(shortfall, 18)) * price * 1e6)) : shortfall;
  const buf = BigInt(10000 + mixedBufferBps);
  let bridgeAmount, minRaw, maxRaw, have0;
  if (settleEth) { bridgeAmount = (shortMicro * buf + 9999n) / 10000n; minRaw = BigInt(Math.ceil(minUsd * 1e6)); maxRaw = BigInt(Math.floor(maxUsd * 1e6)); have0 = o.tok; }
  else { const wei = BigInt(Math.ceil(Number(shortMicro) / 1e6 / price * 1e18)); bridgeAmount = (((wei * buf + 9999n) / 10000n) / 10n ** 10n + 1n) * 10n ** 10n; minRaw = BigInt(Math.ceil(minUsd / price * 1e18 * 1.001)); maxRaw = BigInt(Math.floor(maxUsd / price * 1e18 * 0.999)); have0 = o.eth; }
  if (bridgeAmount < minRaw) bridgeAmount = minRaw;
  if (bridgeAmount > maxRaw) missing.push({ what: "limit", chain: oc.key, asset: osym, need: fmt(bridgeAmount, od), message: `the swap amount ${fmt(bridgeAmount, od)} ${osym} is above the Bull bridge cap. Split the deal.` });
  const needOrigin = settleEth ? bridgeAmount : bridgeAmount + minOriginWei;
  if (have0 < needOrigin) missing.push({ what: "token", chain: oc.key, asset: osym, need: fmt(needOrigin, od), have: fmt(have0, od), message: `the buyer needs ${fmt(needOrigin, od)} ${osym} on ${oc.name} to swap-bridge the shortfall of ${fmt(shortfall, sd)} ${ssym} plus an ${mixedBufferBps / 100}% swap buffer${settleEth ? "" : " and a gas reserve that stays"}, and has ${fmt(have0, od)}. Missing ${fmt(needOrigin - have0, od)} ${osym}.` });
  if (settleEth && o.eth < minOriginWei) missing.push({ what: "gas", chain: oc.key, asset: "ETH", need: fmt(minOriginWei, 18), have: fmt(o.eth, 18), message: `the buyer needs about ${fmt(minOriginWei - o.eth, 18)} more ETH on ${oc.name} for the bridge transactions.` });
  return { bridgeNeeded: true, feasible: !missing.length, shortfall, bridgeAmount, missing, route: "mixed", originDec: od, settleDec: sd, reason: `swap-bridge ${fmt(bridgeAmount, od)} ${osym} (${oc.name}) -> about ${fmt(shortfall, sd)}+ ${ssym} (${sc.name}): the buyer holds ${fmt(have, sd)} ${ssym} there but the agreement needs ${fmt(target, sd)}.` };
}

// ---- bull.settle: state WHAT you want, not HOW (chain, asset, bridge, approvals). EXPERIMENTAL, unaudited, third-party bridge, not tested live. ----
/** Machine-readable error of bull.settle: { code, message, fix, retryable }. `state` (when present) is the resumable state: persist it, then call bull.settle.resume(state). */
export class BullSettleError extends Error {
  constructor(code, message, fix, retryable = false, extra = {}) { super(message); this.name = "BullSettleError"; this.code = code; this.fix = fix; this.retryable = !!retryable; Object.assign(this, extra); }
  toJSON() { return { code: this.code, message: this.message, fix: this.fix, retryable: this.retryable }; }
}
const serr = (code, message, fix, retryable = false, extra) => new BullSettleError(code, message, fix, retryable, extra);
/** Turns any thrown value into a BullSettleError (the SDK safety checks and Bull API errors included). */
export function toSettleError(e, code = "settle_failed", fix = "Read the message. Nothing is retried automatically.", retryable = false) {
  if (e instanceof BullSettleError) return e;
  const m = String(e?.shortMessage || e?.message || e);
  if (m.startsWith("Bull SDK safety check failed")) return serr("safety_check_failed", m, "The server or bridge returned something that does not match your request. Nothing unsafe was sent. Do not retry blindly: check the message.", false, { cause: e });
  return serr(code, m, fix, retryable, { cause: e });
}

/** The host a payout-preferences signature is bound to (same as the server's PREFS_HOST): a signature made for another service cannot be replayed here. */
export const PREFS_HOST = "www.bull.family";
const PREFS_LEGACY_UNTIL_MS = Date.UTC(2026, 11, 31); // the legacy text (no host line) is accepted until 2026-12-31 00:00 UTC
const PREFS_RECORD_MAX_AGE_MS = 180 * 86400_000, PREFS_FUTURE_SLACK_MS = 600_000;
/** The exact text a seller signs to register payout preferences (same as the server's lib/payoutprefs.ts). chains: [{chain:"base"|"robinhood", assets:["stable","eth"], priority:1}]
 *  version 2 (default) has a host: line; version 1 is the legacy text, only for verifying old signatures inside the compatibility window. */
export function payoutPrefsMessage(address, chains, nonce, issuedAt, version = 2, host = PREFS_HOST) {
  const list = [...chains].sort((a, b) => a.priority - b.priority).map((c) => `${c.chain}=${c.assets.join(",")}@${c.priority}${c.address ? ">" + low(c.address) : ""}`).join(";");
  if (version === 1) return ["Bull payout preferences v1", "This signs no transaction and moves no funds.", `address: ${low(address)}`, `chains: ${list}`, `nonce: ${nonce}`, `issuedAt: ${issuedAt}`].join("\n");
  return ["Bull payout preferences v2", "This signs no transaction and moves no funds.", `host: ${low(host)}`, `address: ${low(address)}`, `chains: ${list}`, `nonce: ${nonce}`, `issuedAt: ${issuedAt}`].join("\n");
}
/** Re-verifies a GET /api/v1/agents/{wallet}/payout-prefs answer yourself (never trust the server for this). Returns the chains, or null when there is none, the signature is not the wallet's,
 *  the record is stale (issuedAt older than 180 days or in the future) or it is a legacy-text signature after 2026-12-31. */
export async function verifyPayoutPrefs(wallet, j, recover = recoverMessageAddress, { now = Date.now(), host = PREFS_HOST } = {}) {
  try {
    if (!j || j.isDefault || !j.signed || !Array.isArray(j.chains) || !j.chains.length) return null;
    if (low(j.address) !== low(wallet)) return null;
    const at = j.signed.issuedAt;
    if (!Number.isInteger(at) || at > now + PREFS_FUTURE_SLACK_MS || now - at > PREFS_RECORD_MAX_AGE_MS) return null; // freshness: an old record may name a retired key or chain
    const tryV = async (v) => { try { return low(await recover({ message: payoutPrefsMessage(wallet, j.chains, j.signed.nonce, at, v, host), signature: j.signed.sig })) === low(wallet); } catch { return false; } };
    if (await tryV(2)) return j.chains;
    if (now < PREFS_LEGACY_UNTIL_MS && (await tryV(1))) return j.chains;
    return null;
  } catch { return null; }
}

const POLICY_DEFAULTS = { maxUsd: 100, allowedChains: ["robinhood", "base"], allowedAssets: ["stable"], allowBridge: true, requireDryRun: false, maxBridgeFeeBps: 500 };
const MIXED_WORST_BPS = 300, SAME_KIND_WORST_BPS = 500; // worst-case loss Bull's own quote check allows by default (same-kind 5%, ETH<->stable swap 3%)
/** Operator-controlled guards, passed per call. Safe defaults: maxUsd 100, both chains, stablecoin only (ETH must be allowed on purpose), bridge allowed but always shown, no mandatory dry run. */
export function normalizeSettlePolicy(p) {
  if (p === undefined || p === null) p = {};
  if (typeof p !== "object" || Array.isArray(p)) throw serr("bad_policy", "policy must be an object.", "Pass { maxUsd, allowedChains, allowedAssets, allowBridge, requireDryRun, maxBridgeFeeBps }.");
  for (const k of Object.keys(p)) if (!(k in POLICY_DEFAULTS)) throw serr("bad_policy", `Unknown policy field "${k}".`, "Allowed: maxUsd, allowedChains, allowedAssets, allowBridge, requireDryRun, maxBridgeFeeBps.");
  const list = (name, v, all) => { if (v === undefined) return [...POLICY_DEFAULTS[name]]; if (!Array.isArray(v) || !v.length || v.some((x) => !all.includes(x))) throw serr("bad_policy", `${name} must be a non-empty list of: ${all.join(", ")}.`, `Example: ${JSON.stringify(all)}.`); return [...new Set(v)]; };
  const maxUsd = p.maxUsd === undefined ? POLICY_DEFAULTS.maxUsd : Number(p.maxUsd);
  if (!(Number.isFinite(maxUsd) && maxUsd > 0 && maxUsd <= 1e6)) throw serr("bad_policy", "maxUsd must be a number above 0 and at most 1000000.", "Example: maxUsd: 100.");
  for (const k of ["allowBridge", "requireDryRun"]) if (p[k] !== undefined && typeof p[k] !== "boolean") throw serr("bad_policy", `${k} must be true or false.`, `Set ${k}: true or false.`);
  const maxBridgeFeeBps = p.maxBridgeFeeBps === undefined ? POLICY_DEFAULTS.maxBridgeFeeBps : Number(p.maxBridgeFeeBps);
  if (!(Number.isInteger(maxBridgeFeeBps) && maxBridgeFeeBps >= 0 && maxBridgeFeeBps <= 2000)) throw serr("bad_policy", "maxBridgeFeeBps must be an integer from 0 to 2000 (basis points of the bridged amount).", "Example: maxBridgeFeeBps: 500 (5%); a bridge whose worst-case loss is higher is refused.");
  return { maxUsd, allowedChains: list("allowedChains", p.allowedChains, ["robinhood", "base"]), allowedAssets: list("allowedAssets", p.allowedAssets, ["stable", "eth"]), allowBridge: p.allowBridge ?? true, requireDryRun: p.requireDryRun ?? false, maxBridgeFeeBps };
}

/** Checks a plan from GET/POST /api/v1/settle-plan against what YOU asked and YOUR policy. The server is an adviser, never an authority. Pure; throws BullSettleError.
 *  ctx: { buyer, seller, amountUsd?, amount?, asset?, policy (normalized), price (ETH/USD or null) } */
export function verifySettlePlan(plan, ctx) {
  const { policy } = ctx;
  if (!plan || plan.ok !== true) throw serr("bad_plan", "The plan is not a valid Bull settle plan.", "Retry; if it persists the server is misbehaving.", true);
  if (low(plan.buyer) !== low(ctx.buyer) || low(plan.seller) !== low(ctx.seller)) throw serr("plan_mismatch", "The plan names another buyer or seller than you asked for.", "Do not use this plan.");
  const chain = plan.settlementChain, kind = plan.settlementAsset;
  if (chain !== "base" && chain !== "robinhood") throw serr("plan_mismatch", "The plan names an unknown settlement chain.", "Do not use this plan.");
  if (kind !== "eth" && kind !== "stable") throw serr("plan_mismatch", "The plan names an unknown settlement asset.", "Do not use this plan.");
  if (!policy.allowedChains.includes(chain)) throw serr("policy_chain_not_allowed", `The plan settles on ${chain}, which policy.allowedChains does not allow.`, "Widen policy.allowedChains on purpose or set constraints.chain.");
  if (!policy.allowedAssets.includes(kind)) throw serr("policy_asset_not_allowed", `The plan settles in ${kind}, which policy.allowedAssets does not allow.`, `Add "${kind}" to policy.allowedAssets on purpose.`);
  if (typeof plan.amount !== "string" || !/^\d{1,9}(\.\d{1,18})?$/.test(plan.amount) || !(Number(plan.amount) > 0)) throw serr("plan_mismatch", "The plan has an invalid amount.", "Do not use this plan.");
  if (kind === "eth" && !(ctx.price > 0)) throw serr("price_unavailable", "Could not read the ETH/USD price needed to check an ETH plan.", "Try again, or use stablecoin only.", true);
  const usd = kind === "eth" ? Number(plan.amount) * ctx.price : Number(plan.amount);
  if (usd > policy.maxUsd + 1e-6) throw serr("policy_max_usd", `The plan is about $${usd.toFixed(2)}, above policy.maxUsd of $${policy.maxUsd}.`, "Lower the amount or raise policy.maxUsd on purpose.");
  const tol = (a, b, rel) => Math.abs(a - b) <= Math.max(1e-6, b * rel);
  if (ctx.amountUsd !== undefined) { if (!tol(usd, Number(ctx.amountUsd), kind === "eth" ? 0.03 : 0)) throw serr("plan_mismatch", `You asked for $${ctx.amountUsd} but the plan settles about $${usd.toFixed(2)}.`, "Do not use this plan."); }
  else if (ctx.asset === kind) { if (Number(plan.amount) !== Number(ctx.amount)) throw serr("plan_mismatch", `You asked for ${ctx.amount} ${ctx.asset} but the plan settles ${plan.amount}.`, "Do not use this plan."); }
  else if (!tol(usd, ctx.asset === "eth" ? Number(ctx.amount) * ctx.price : Number(ctx.amount), 0.03)) throw serr("plan_mismatch", "The plan's value differs from the amount you asked for by more than 3%.", "Do not use this plan.");
  if (plan.bridge && plan.bridge !== "none") {
    if (!policy.allowBridge) throw serr("policy_bridge_not_allowed", "The plan needs a bridge but policy.allowBridge is false.", "Fund the buyer on the settlement chain, or set policy.allowBridge true on purpose.");
    if (plan.bridge.recipient && low(plan.bridge.recipient) !== low(ctx.buyer)) throw serr("plan_mismatch", "The plan's bridge recipient is not your own address.", "Do not use this plan.");
    if (plan.bridge.fromChain === chain) throw serr("plan_mismatch", "The plan bridges from the settlement chain to itself.", "Do not use this plan.");
    if (plan.bridge.toChain !== chain || (plan.bridge.fromChain !== "base" && plan.bridge.fromChain !== "robinhood")) throw serr("plan_mismatch", "The plan's bridge does not end on its own settlement chain (or starts on an unknown chain).", "Do not use this plan.");
    const originKind = plan.bridge.fromAsset; // what the bridge spends on the origin chain: allowedAssets gates it too (a swap from ETH is price exposure)
    if (originKind !== "eth" && originKind !== "stable") throw serr("plan_mismatch", "The plan's bridge does not say which asset it spends.", "Do not use this plan.");
    if (!policy.allowedAssets.includes(originKind)) throw serr("policy_asset_not_allowed", `The plan's bridge would spend ${originKind}, which policy.allowedAssets does not allow.`, `Add "${originKind}" to policy.allowedAssets on purpose.`);
    if (plan.bridge.amountUsd !== undefined && !(Number(plan.bridge.amountUsd) <= policy.maxUsd + 1e-6)) throw serr("policy_max_usd", "The plan's bridge amount is above policy.maxUsd (or not a number).", "Raise policy.maxUsd on purpose: a bridge needs the amount plus a buffer.");
    const worst = Math.max(plan.bridge.route === "mixed" ? MIXED_WORST_BPS : 0, Number(plan.bridge.worstLossBps) || 0); // the server's own figure can only raise the bar, never lower it
    if (worst > policy.maxBridgeFeeBps) throw serr("policy_bridge_fee_too_high", `The plan's bridge may lose up to ${worst / 100}% of the amount; policy.maxBridgeFeeBps is ${policy.maxBridgeFeeBps}.`, "Raise policy.maxBridgeFeeBps on purpose or fund the buyer on the settlement chain.");
  }
  if (ctx.constraints?.payWith && !policy.allowedAssets.includes(kindOf(ctx.constraints.payWith, "constraints.payWith"))) throw serr("policy_asset_not_allowed", `constraints.payWith "${ctx.constraints.payWith}" is not in policy.allowedAssets.`, "Add it to policy.allowedAssets on purpose, or drop the constraint.");
  const seller = low(ctx.seller), payee = plan.payee ? low(plan.payee) : seller;
  if (!/^0x[0-9a-f]{40}$/.test(payee) || payee === low(ctx.buyer) || /^0x0{40}$/.test(payee)) throw serr("plan_mismatch", "The plan names an invalid payee address.", "Do not use this plan.");
  if (payee !== seller) { // another payee than the seller's own address is only acceptable when the seller SIGNED it for this chain (ctx.signedPayees comes from verified payout prefs)
    if (!ctx.signedPayees || low(ctx.signedPayees[chain] || "") !== payee) throw serr("payee_not_signed", `The plan pays ${payee} on ${chain}, which the seller did not sign.`, "Do not use this plan.");
  }
  if (ctx.constraints?.chain && ctx.constraints.chain !== chain) throw serr("plan_mismatch", `You constrained the chain to ${ctx.constraints.chain} but the plan settles on ${chain}.`, "Do not use this plan.");
  return { chain, kind, amount: plan.amount, usd, payee, payeeMode: payee === seller ? "same_address" : "signed_chain_address" };
}

const codeKind = (c) => { if (!c || c === "0x") return "empty"; const l = String(c).toLowerCase(); return l.startsWith("0xef0100") && l.length === 48 ? "eip7702" : "contract"; };
/** Same-address payee check: the seller's address must have empty code or an EIP-7702 delegation on EVERY supported chain, otherwise the same address may belong to someone else (or nobody) on the settlement chain.
 *  getCode(chainKey, address) -> bytecode. Pure apart from that call. Throws payee_contract_wallet / payee_check_unavailable. Not needed (and not called) for a payee the seller signed for that chain. */
export async function verifyPayeePortable(seller, getCode, chains = ["base", "robinhood"]) {
  const got = {};
  for (const ch of chains) { try { got[ch] = codeKind(await getCode(ch, seller)); } catch { throw serr("payee_check_unavailable", `Could not read the payee's code on ${ch}.`, "Try again; pass publicClients for both chains in clients.", true); } }
  if (Object.values(got).some((k) => k === "contract")) throw serr("payee_contract_wallet", "The seller address has contract code on a chain: the same address cannot be assumed to be the seller's on the settlement chain.", "Ask the seller to sign a payout address for that chain (payout prefs, chains[].address).", false, { field: "seller", got, expected: "empty code or EIP-7702 delegation (0xef0100...) on every supported chain, or a seller-signed per-chain payout address" });
  return got;
}

/** Re-runs the resolver's ORDER locally, from the buyer's own on-chain facts, to learn what the best plan is: the seller's verified preferences first (a route payable WITHOUT a bridge beats one that needs a bridge),
 *  then the buyer's own funds without a bridge, then any bridge. `local` maps "chain/kind" -> { eligible (payee address usable there), feasible, bridgeNeeded, bridgeUsd, originKind } from the SDK's own balance decision.
 *  Pure. Returns { chain, kind, bridgeNeeded } or null when nothing is feasible within the policy. */
export function expectedSettlePick({ prefs, policy, constraints, preferredAsset, local }) {
  const CH = ["robinhood", "base"], KINDS = ["stable", "eth"];
  const allowed = (chain, kind) => (!constraints?.chain || constraints.chain === chain) && policy.allowedChains.includes(chain) && policy.allowedAssets.includes(kind);
  const usable = (chain, kind) => {
    const e = local[`${chain}/${kind}`];
    if (!e || !e.eligible || !e.feasible) return null;
    if (e.bridgeNeeded && !(policy.allowBridge && policy.allowedAssets.includes(e.originKind) && Number(e.bridgeUsd) <= policy.maxUsd + 1e-6)) return null;
    return { chain, kind, bridgeNeeded: !!e.bridgeNeeded };
  };
  let bridgePref = null;
  for (const c of [...(prefs || [])].sort((a, b) => a.priority - b.priority)) {
    const assets = preferredAsset && c.assets.includes(preferredAsset) ? [preferredAsset, ...c.assets.filter((x) => x !== preferredAsset)] : c.assets;
    for (const kind of assets) { if (!allowed(c.chain, kind)) continue; const u = usable(c.chain, kind); if (!u) continue; if (!u.bridgeNeeded) return u; bridgePref ||= u; }
  }
  if (bridgePref) return bridgePref;
  const kinds = preferredAsset ? [preferredAsset, ...KINDS.filter((k) => k !== preferredAsset)] : KINDS;
  let anyBridge = null;
  for (const kind of kinds) for (const chain of CH) { if (!allowed(chain, kind)) continue; const u = usable(chain, kind); if (!u) continue; if (!u.bridgeNeeded) return u; anyBridge ||= u; }
  return anyBridge;
}
/** Rejects a plan (or local decision) that bridges although the best allowed route needs no bridge. `expected` comes from expectedSettlePick. Throws BullSettleError needless_bridge. */
export function rejectNeedlessBridge({ planBridges, expected }) {
  if (planBridges && expected && !expected.bridgeNeeded) throw serr("needless_bridge", `The plan bridges funds, but the buyer can pay on ${expected.chain} (${expected.kind}) without a bridge, which the policy allows.`, "Do not use this plan: a bridge adds a third party, fees and delay. Retry, or set constraints.chain.");
}

/** The terms text committed (as a hash) in every agreement bull.settle opens: a unique settle:<id> tag, then the caller's own terms. The tag is how a resume recognises ITS agreement. */
export function settleTermsText(st) { return `settle:${st.id}` + (st.request?.terms ? "\n" + st.request.terms : ""); }
export function settleTermsHash(st) { return keccak256(toHex(settleTermsText(st))); }

const STATE_TTL_MS = 24 * 3600_000;
/** The immutable core of a settle state: what the buyer's wallet signs (stateMac) so a tampered or foreign state is refused on resume. */
export function settleStateMessage(st) {
  const core = { v: 1, id: st.id, buyer: low(st.buyer), seller: low(st.seller), sellerIdentity: st.sellerIdentity ? low(st.sellerIdentity) : null, payeeMode: st.payeeMode, chain: st.chain, settleKind: st.settleKind, assetName: st.assetName, amount: st.amount, needRaw: st.needRaw, planDigest: st.planDigest, policy: st.policy, bridge: st.bridge?.needed ? { route: st.bridge.route, originChain: st.bridge.originChain, amount: st.bridge.amount, fromAsset: st.bridge.fromAsset, toAsset: st.bridge.toAsset, amountUsd: st.bridge.amountUsd } : null, createdAt: st.createdAt, expiresAt: st.expiresAt };
  return "Bull settle state v1\nThis signs no transaction and moves no funds.\n" + JSON.stringify(core);
}
/** Checks a state before bull.settle.resume runs it: buyer MAC, policy re-normalized and applied again (also to the bridge amount), dry-run gate, expiry (only while nothing irreversible was sent). Throws BullSettleError. */
export async function verifySettleState(st, { recover = recoverMessageAddress, now = Date.now(), approvedPlan } = {}) {
  if (!st || st.v !== 1 || typeof st.phase !== "string" || !st.buyer) throw serr("bad_state", "That is not a bull.settle state.", "Pass the state object that bull.settle returned (or err.state).");
  let who = null; try { if (typeof st.stateMac === "string") who = await recover({ message: settleStateMessage(st), signature: st.stateMac }); } catch { who = null; }
  if (!who || low(who) !== low(st.buyer)) throw serr("state_tampered", "The state's signature is missing or is not the buyer's: it was changed or did not come from this wallet.", "Use the state exactly as bull.settle returned it.");
  const pol = normalizeSettlePolicy(st.policy); // the policy is re-applied, never trusted from the JSON
  if (JSON.stringify(pol) !== JSON.stringify(st.policy)) throw serr("state_tampered", "The state's policy is not a normalized policy.", "Use the state exactly as bull.settle returned it.");
  if (Number(st.amountUsd) > pol.maxUsd + 1e-6) throw serr("policy_max_usd", "The state's amount is above policy.maxUsd.", "Raise policy.maxUsd on purpose or start again.");
  if (st.bridge?.needed) {
    if (!pol.allowBridge) throw serr("policy_bridge_not_allowed", "The state needs a bridge but policy.allowBridge is false.", "Set policy.allowBridge true on purpose or start again.");
    if (!(Number(st.bridge.amountUsd) <= pol.maxUsd + 1e-6)) throw serr("policy_max_usd", "The state's bridge amount is above policy.maxUsd (or unknown).", "Raise policy.maxUsd on purpose or start again.");
  }
  if (!pol.allowedChains.includes(st.chain)) throw serr("policy_chain_not_allowed", "The state settles on a chain the policy does not allow.", "Widen policy.allowedChains on purpose or start again.");
  if (st.executable === false && approvedPlan !== st.planDigest) throw serr("dry_run_state", "This state came from a dry run and is not executable.", "Pass approvedPlan: state.planDigest after reviewing it, or run bull.settle again without dryRun.");
  if (["planned", "bridge_quoted"].includes(st.phase) && !st.agreement?.id && now > Number(st.expiresAt)) throw serr("state_expired", "The state expired before anything was sent.", "Plan again with bull.settle.");
  return pol;
}

const PHASES_BEFORE_OPEN = new Set(["planned", "bridge_quoted", "bridge_sending", "bridge_sent", "bridge_arrived"]);
/** The resumable settlement machine. It is idempotent: every call first re-reads the chain / bridge / agreement feed and only then does the NEXT step. It never sends a bridge or an agreement transaction twice.
 *  state is plain JSON (no BigInt), persisted through io.save after every transition and BEFORE every irreversible send. io is injected (the SDK wires the real chain; tests wire mocks).
 *  phases: planned -> bridge_quoted -> bridge_sending -> bridge_sent -> bridge_arrived -> opening -> done   (halted = needs a human; terminal halts cannot be resumed). */
export async function runSettleMachine(state, io, o = {}) {
  const { bridgeTimeoutMs = 900000, arrivalTimeoutMs = 300000, pollMs = 4000 } = o;
  if (!state || state.v !== 1 || typeof state.phase !== "string") throw serr("bad_state", "That is not a bull.settle state.", "Pass the state object that bull.settle returned (or the one on a BullSettleError).");
  const snap = () => JSON.parse(JSON.stringify(state));
  const save = async (phase, note) => { if (phase) state.phase = phase; state.updatedAt = io.now(); if (note) state.history.push({ at: state.updatedAt, phase: state.phase, note }); if (io.save) await io.save(snap()); };
  const fail = (code, message, fix, retryable) => serr(code, message, fix, retryable, { state: snap() });
  const halt = async (code, message, fix, terminal = false) => { state.halt = { code, message, fix, terminal, from: state.phase }; await save("halted", `${code}: ${message}`); throw fail(code, message, fix, false); };
  const wrap = (e, code, fix, retryable = false) => { const x = toSettleError(e, code, fix, retryable); x.state = snap(); return x; };
  if (state.phase === "done") return state;
  if (state.phase === "halted") {
    if (state.halt?.terminal) throw fail(state.halt.code, state.halt.message, state.halt.fix, false);
    const from = state.halt?.from; delete state.halt;
    await save(PHASES_BEFORE_OPEN.has(from) || from === "opening" ? from : "planned", "resumed after a halt");
  }
  // explicit human overrides for the two ambiguous situations (see the errors below)
  if (state.phase === "bridge_sending" && o.bridgeTxHashes) { state.bridge.txHashes = o.bridgeTxHashes.map(String); await save("bridge_sent", "operator supplied the bridge transaction hashes"); }
  if (state.phase === "bridge_sending" && o.confirmBridgeNotSent) { state.bridge.quoteId = null; await save("planned", "operator confirmed the bridge transaction was NOT sent"); }
  if (state.phase === "opening" && o.confirmNotOpened) { state.agreement.confirmNotOpened = true; await save(null, "operator confirmed no agreement was created"); }

  const need = BigInt(state.needRaw), minGas = BigInt(state.minGasWei), isEth = state.settleKind === "eth";
  const held = (b) => (isEth ? b.eth : b.tok);
  // Reads the agreement from the chain (through io.getAgreement) and checks EVERYTHING that matters: payee, payer, amount, asset, status, the settle:<id> terms hash and the conditions. Any mismatch halts for good.
  const verifyOpen = async (id) => {
    let a; try { a = await io.getAgreement(id, state); } catch (e) { throw wrap(e, "agreement_unreadable", "Could not read the agreement. Try again.", true); }
    if (!a) throw fail("agreement_unreadable", `Agreement ${id} could not be found on ${state.chain}.`, "Try again in a moment.", true);
    const wrong = [];
    if (low(a.payee) !== low(state.seller)) wrong.push("payee");
    if (!a.payer || low(a.payer) !== low(state.buyer)) wrong.push("payer");
    if (!(Number(a.amount) === Number(state.amount))) wrong.push("amount");
    if (a.assetOk !== true) wrong.push("asset");
    if (a.status !== "open" && a.status !== "released") wrong.push(`status ${a.status}`);
    if (!a.termsHash || low(a.termsHash) !== low(settleTermsHash(state))) wrong.push("terms (settle tag)");
    if (a.conditionsOk !== true) wrong.push("conditions");
    if (wrong.length) await halt("agreement_mismatch", `Agreement ${id} does not match this settlement: ${wrong.join(", ")}.`, "Check the agreement manually. Nothing more was sent.", true);
  };
  if (state.agreement?.id) { // the agreement is already open: just verify it and finish. No transaction is sent.
    await verifyOpen(state.agreement.id);
    await save("done", `agreement ${state.agreement.id} is open on ${state.chain}`); return state;
  }
  // Payee guard (same-address routing only): re-check the code on every chain BEFORE any bridge or agreement is sent, and again right before opening. Fail closed when the io cannot read code.
  const payeeGuard = async () => {
    if (state.payeeMode === "signed_chain_address") return;
    if (state.payeeMode !== "same_address" || !io.payeeCodes) await halt("payee_check_unavailable", "The payee address cannot be re-checked (no payeeMode or no code reader).", "Resume through bull.settle.resume with public clients for both chains.");
    let codes; try { codes = await io.payeeCodes(state); } catch (e) { throw wrap(e, "payee_check_unavailable", "Could not read the payee's code. Nothing was sent. Try again.", true); }
    if (Object.values(codes).some((k) => k !== "empty" && k !== "eip7702")) await halt("payee_contract_wallet", "The payee address now has contract code on a chain; the same-address assumption no longer holds.", "Nothing more was sent. Ask the seller for a signed per-chain payout address and plan again.", true);
  };
  if (PHASES_BEFORE_OPEN.has(state.phase)) await payeeGuard();
  for (let guard = 0; guard < 12; guard++) {
    switch (state.phase) {
      case "planned": case "bridge_quoted": { // bridge_quoted: nothing was sent yet, so a fresh quote is safe
        if (state.baselineId === undefined) { try { state.baselineId = await io.maxAgreementId(); } catch { /* recorded later, at the open step */ } }
        const bal = await io.readSettle().catch((e) => { throw wrap(e, "rpc_unavailable", "Could not read balances. Try again.", true); });
        if (held(bal) >= need) { await save("bridge_arrived", "the buyer already holds enough on the settlement chain: no bridge"); break; }
        if (!state.bridge?.needed) await halt("balance_changed", `The buyer holds ${held(bal)} (raw) on ${state.chain}, the plan needed no bridge but ${need} is required.`, "Plan again with bull.settle({ ..., dryRun: true }) or fund the buyer, then resume.");
        const n0 = await io.nonces(state.bridge.originChain);
        if (n0.pending > n0.latest) throw fail("pending_transactions", `A transaction from this wallet is still pending on ${state.bridge.originChain}.`, "Wait until it is mined, then resume.", true);
        let q; try { q = await io.quoteBridge(state); } catch (e) { throw wrap(e, "bridge_quote_failed", "No bridge was started and nothing was sent. Try again later.", true); }
        state.bridge.quoteId = q?.id || null; state.bridge.nonce0 = n0.latest;
        await save("bridge_quoted", `bridge quoted (id ${state.bridge.quoteId})`);
        await save("bridge_sending", "about to send the bridge transactions"); // persisted BEFORE the irreversible send
        let hashes; try { hashes = await io.sendBridge(q); } catch (e) { throw wrap(e, "bridge_send_failed", "A bridge transaction may or may not have gone out. resume(state) checks the bridge id and the wallet nonce before it ever sends again.", false); }
        state.bridge.txHashes = hashes || []; await save("bridge_sent", "bridge transactions sent"); break;
      }
      case "bridge_sending": { // crashed (or failed) while sending: find out whether the bridge transaction went out. Never send again on a guess.
        const st = state.bridge.quoteId ? await io.bridgeStatus(state.bridge.quoteId) : { status: "unknown" };
        if (st.status === "pending" || st.status === "confirmed" || (st.status !== "unknown" && state.bridge.txHashes?.length)) { await save("bridge_sent", `the bridge knows id ${state.bridge.quoteId} (${st.status}): it was sent`); break; }
        const n = await io.nonces(state.bridge.originChain);
        if (n.pending > n.latest) throw fail("pending_transactions", `A transaction from this wallet is still pending on ${state.bridge.originChain}.`, "Wait until it is mined, then resume.", true);
        throw fail("ambiguous_bridge_send", `The bridge transaction may or may not have been sent (the bridge does not know id ${state.bridge.quoteId}${n.latest > (state.bridge.nonce0 ?? n.latest) ? ", but the wallet nonce advanced" : ", and the wallet nonce did not advance"}).`, "Check the wallet history on the origin chain. If it was sent: resume(state, { bridgeTxHashes: [hash] }). If it was NOT sent: resume(state, { confirmBridgeNotSent: true }).", false);
      }
      case "bridge_sent": {
        const end = io.now() + bridgeTimeoutMs;
        if (state.bridge.quoteId) for (;;) {
          const s = await io.bridgeStatus(state.bridge.quoteId);
          if (s.status === "confirmed") break;
          if (s.status === "failed" || s.status === "refunded") await halt(`bridge_${s.status}`, `The bridge ${s.status}. No agreement was opened.`, "Check both chains: a refund goes to your own address. Start a new settle when ready.", true);
          if (io.now() >= end) throw fail("bridge_pending", "The bridge is not confirmed yet.", "Resume later: bull.settle.resume(state). Do NOT start a new settle meanwhile.", true);
          await io.sleep(pollMs);
        }
        const aend = io.now() + arrivalTimeoutMs; let bal = await io.readSettle();
        while (held(bal) < need && io.now() < aend) { await io.sleep(pollMs); bal = await io.readSettle(); }
        if (held(bal) < need) throw fail("arrival_pending", `The bridge is confirmed but only ${held(bal)} (raw) is on ${state.chain}; ${need} is required.`, "Resume in a minute. If it never arrives, check bridge.status and both balances.", true);
        await save("bridge_arrived", "funds arrived on the settlement chain"); break;
      }
      case "bridge_arrived": {
        await payeeGuard();
        const bal = await io.readSettle();
        if (bal.eth < minGas) await halt("gas_missing", `The buyer has too little ETH for gas and the protocol fee on ${state.chain}.`, `Send a little ETH to the buyer on ${state.chain}, then resume. The funds are with the buyer; nothing is locked.`);
        const n = await io.nonces(state.chain);
        if (n.pending > n.latest) throw fail("pending_transactions", `A transaction from this wallet is still pending on ${state.chain}.`, "Wait until it is mined, then resume.", true);
        let base = state.baselineId; if (base === undefined) { try { base = await io.maxAgreementId(); } catch (e) { throw wrap(e, "baseline_unreadable", "Could not read the agreements feed to record a baseline, so nothing was opened. Try again.", true); } }
        if (!Number.isFinite(Number(base))) throw fail("baseline_unreadable", "The agreement baseline is not a number, so nothing was opened.", "Try again; if it persists the feed is misbehaving.", true);
        state.agreement = { baselineId: Number(base), nonce0: n.latest }; // baselineId was recorded at plan time when possible: an old copy of the state still recognises an agreement opened later
        await save("opening", "about to open the agreement"); break; // persisted BEFORE the irreversible send
      }
      case "opening": {
        if (!Number.isFinite(Number(state.agreement?.baselineId))) throw fail("baseline_unreadable", "The state has no usable agreement baseline, so an existing agreement cannot be told apart.", "Nothing was sent. Plan again.", false);
        let found; try { found = await io.findAgreement(state); } catch (e) { throw wrap(e, "agreement_feed_unreadable", "Could not read the agreements feed, so it is unknown whether the agreement exists. Nothing was sent. Try again.", true); }
        if (found) { state.agreement.id = String(found.id); await verifyOpen(found.id); await save("done", `agreement ${found.id} already exists on ${state.chain}: adopted, nothing sent`); return state; }
        const n = await io.nonces(state.chain);
        if (n.pending > n.latest) throw fail("pending_transactions", `A transaction from this wallet is still pending on ${state.chain}.`, "Wait until it is mined, then resume.", true);
        if (n.latest > state.agreement.nonce0 && !state.agreement.confirmNotOpened) throw fail("agreement_unconfirmed", `This wallet sent a transaction on ${state.chain} since the open step began, but no matching agreement is visible yet.`, "Wait a minute and resume again. If still nothing, and you are sure no agreement was created (an approval alone is harmless), resume(state, { confirmNotOpened: true }).", true);
        let id; try { id = await io.openAgreement(state); } catch (e) { throw wrap(e, "open_agreement_failed", "The agreement may or may not exist. resume(state) checks the chain before it sends again.", false); }
        state.agreement.id = String(id); await save("done", `agreement ${id} opened on ${state.chain}`); return state;
      }
      case "done": return state;
      default: throw fail("bad_state", `Unknown phase ${state.phase}.`, "Pass the state exactly as returned.", false);
    }
  }
  throw fail("loop_guard", "The settle machine did not converge.", "Resume again; if it repeats, report the state.", false);
}

export class Bull {
  /** @param {{ walletClient: any, publicClient: any, baseUrl?: string }} o */
  constructor({ walletClient, publicClient, baseUrl = "https://www.bull.family", chain = "robinhood", relayApiKey }) {
    this.relayKey = relayApiKey || undefined; // optional: bridge quotes then go to Relay directly instead of through Bull
    this.chainName = String(chain).toLowerCase();
    this.cfg = CHAINS[this.chainName];
    if (!this.cfg) bad(`chain must be ${Object.keys(CHAINS).join(" or ")}.`);
    this.w = walletClient;
    this.p = publicClient;
    this.base = baseUrl.replace(/\/$/, "");
    this.tokens = new Set([this.cfg.stable]); // token contracts you named yourself (approvals are only allowed on these)
    if (this.base !== DEFAULT_BASE) console.warn(`Bull SDK WARNING: using ${this.base} instead of ${DEFAULT_BASE}. Only continue if you run this server yourself.`);
  }

  #note(...tokens) {
    for (const t of tokens) if (/^0x[0-9a-fA-F]{40}$/.test(String(t || ""))) this.tokens.add(low(t));
  }

  get address() {
    return this.w.account.address;
  }

  async #call(path, body) {
    if (this.chainName !== "robinhood") { if (body) body = { ...body, chain: this.chainName }; else path += (path.includes("?") ? "&" : "?") + "chain=" + this.chainName; }
    const r = await fetch(this.base + path, { ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || j?.error || `Bull API ${r.status}`);
    return j;
  }

  /** Refuses anything that is not (1) a call to a Bull contract, (2) an approval of a token you named, to a Bull contract (or the locker you pinned),
   *  for at most `o.maxApprove`, or (3) a call to the `o.locker` you pinned. ETH value is capped at maxWei. Nothing here is derived from the server's reply. */
  #guard(tx, maxWei = 0n, o = {}) {
    const to = low(tx?.to), data = String(tx?.data || "0x"), value = BigInt(tx?.value || "0");
    if (value > maxWei) bad(`transaction sends ${value} wei, more than the ${maxWei} you agreed to.`);
    if (data.startsWith("0x095ea7b3")) {
      if (!/^0x[0-9a-fA-F]{136}$/.test(data)) bad("the approval calldata has the wrong length.");
      const spender = "0x" + data.slice(34, 74).toLowerCase();
      const amt = BigInt("0x" + data.slice(74, 138));
      if (!this.tokens.has(to)) bad(`approval on ${to}, a token you did not name.`);
      if (o.token !== undefined && to !== low(o.token)) bad(`approval on ${to}, which is not the token of this step (${low(o.token)}).`);
      if (!(spender === this.cfg.agreement || this.cfg.escrows.includes(spender) || (o.stream && spender === this.cfg.stream) || (o.locker && spender === low(o.locker)))) bad(`approval to ${spender}, which is not a Bull contract.`);
      if (o.maxApprove === undefined || amt > o.maxApprove) bad(`approval of ${amt}, more than the ${o.maxApprove ?? 0n} this step needs.`);
      return;
    }
    if (to === this.cfg.agreement || this.cfg.escrows.includes(to) || (o.stream && to === this.cfg.stream)) {
      // Decode the call: it must be a function this step is allowed to call, and (if the step is about one deal or agreement) for exactly that id.
      let fn;
      try { fn = decodeFunctionData({ abi: FN_ABI, data }); } catch { bad("the transaction calls a function the SDK does not know."); }
      if (o.fn && !o.fn.includes(fn.functionName)) bad(`the transaction calls ${fn.functionName}, expected ${o.fn.join(" or ")}.`);
      if (o.id !== undefined && fn.args[0] !== BigInt(o.id)) bad(`the transaction is for id ${fn.args[0]}, not the ${o.id} you asked for.`);
      return fn;
    }
    if (o.locker && to === low(o.locker) && !/^0x(a9059cbb|23b872dd|095ea7b3)/.test(data)) return;
    bad(`the server asked to send a transaction to ${to}, which is not a Bull contract.`);
  }

  /** Reads a deal straight from the escrow (the chain, not the server). */
  async #deal(dealId, escrow = this.cfg.escrows[0]) {
    const r = await this.p.readContract({ address: escrow, abi: DEALS_ABI, functionName: "deals", args: [BigInt(dealId)] });
    return { buyer: r[0], seller: r[1], sellToken: r[2], sellAmount: r[3], payToken: r[4], payAmount: r[5], deadline: r[6], buyerFunded: r[7], sellerFunded: r[8], status: Number(r[9]), sellerPayout: r[10], buyerReceive: r[11], feeBps: Number(r[12]) };
  }

  /** The wallet must be connected to Robinhood Chain, otherwise value would go to Bull's addresses on a chain where nothing lives there. */
  async #chainOk() {
    let id;
    let live;
    try { live = Number(await this.w.getChainId()); } catch { live = undefined; }
    try { id = Number(this.w.chain?.id ?? live); } catch { bad("could not read the wallet's chain id."); }
    if (live !== undefined && live !== id) bad(`the wallet's configured chain (${id}) and its live chain (${live}) differ.`);
    if (!Number.isFinite(id) || id !== this.cfg.id) bad(`the wallet is on chain ${id}, not ${this.cfg.name} (${this.cfg.id}).`);
  }

  /** Before anything is sent: the wallet must hold the ETH the transactions carry (protocol fee, plus the amount when it is paid in ETH) and a little gas. Plain message, nothing sent. */
  async #preflight(steps, ethAsset = false) {
    let need = GAS_RESERVE_WEI;
    for (const st of steps || []) need += BigInt(st?.transaction?.value || "0");
    let have;
    try { have = await this.p.getBalance({ address: this.address }); } catch { return; } // cannot read it: do not block, the chain will refuse if it is really short
    if (typeof have !== "bigint" || have >= need) return;
    throw new Error(`Need at least ${ethStr(need)} ETH on ${this.cfg.name} for ${ethAsset ? "the locked amount, " : ""}the protocol fee and gas (this wallet has ${ethStr(have)} ETH). Nothing was sent. ${this.chainName === "base" ? "Agents that hold only USDC on Base still need a little ETH there for the fee and gas." : "On Robinhood Chain the fee and gas are paid in ETH."}`);
  }

  async #decimals(token) {
    if (!token || low(token) === "eth" || low(token) === ZERO) return 18;
    if (low(token) === this.cfg.alias) return 6;
    try { return Number(await this.p.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })); } catch { bad("could not read the token's decimals."); }
  }

  async #send(tx, maxWei = 0n, o = {}) {
    await this.#chainOk();
    const fn = this.#guard(tx, maxWei, o);
    if (o.check && fn) o.check(fn);
    const hash = await this.w.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value || "0"), chain: this.w.chain });
    let rc;
    try { rc = await this.p.waitForTransactionReceipt({ hash, timeout: 180000 }); }
    catch (e) { throw new Error(`Transaction ${hash} was sent but no receipt arrived (${e?.shortMessage || e?.message || e}). Check the chain for this hash before you retry.`); }
    if (rc.status !== "success") throw new Error("Transaction failed: " + hash);
    return rc;
  }

  /** Signed fee quote and the createDeal transaction for an agreed trade. The connected wallet is the buyer. */
  quote({ seller, sellToken, sellAmount, payAsset = this.cfg.alias === "usdc" ? "usdc" : "eth", payAmount, sellerPayout, buyerReceive, deadlineHours, sellerSig, validUntil, deadline }) {
    return this.#call("/api/v1/settle", { buyer: this.address, seller, sellToken, sellAmount, payAsset, payAmount, sellerPayout, buyerReceive, deadlineHours, sellerSig, validUntil, deadline });
  }

  /** Seller side, step 1: the connected wallet (the seller) signs the exact deal terms. Give the result to the buyer, who passes it to open().
   *  `buyer` is the buyer's wallet. Returns { sellerSig, validUntil, deadline }: pass all three to the buyer's open(). The signature is EIP-712 and the escrow contract checks it. */
  async consent({ buyer, sellToken, sellAmount, payAsset = this.cfg.alias === "usdc" ? "usdc" : "eth", payAmount, sellerPayout, buyerReceive, deadlineHours }) {
    const m = await this.#call("/api/v1/settle", { buyer, seller: this.address, sellToken, sellAmount, payAsset, payAmount, sellerPayout, buyerReceive, deadlineHours, consentOnly: true });
    await this.#checkConsent(m.typedData, { buyer, sellToken, sellAmount, payAsset, payAmount, sellerPayout, buyerReceive, deadlineHours });
    const t = m.typedData;
    const message = Object.fromEntries(Object.entries(t.message).map(([k, v]) => [k, /^\d+$/.test(String(v)) ? BigInt(v) : v]));
    const sellerSig = await this.w.signTypedData({ account: this.w.account, domain: t.domain, types: t.types, primaryType: t.primaryType, message });
    return { sellerSig, validUntil: String(t.message.validUntil), deadline: String(t.message.deadline) }; // the values that were signed, not the server's separate fields
  }

  /** What the buyer pays in. Robinhood: eth or usdg. Base: usdc only. The token comes from this table, never from the server. */
  #payAsset(a) {
    const k = low(a || (this.cfg.alias === "usdc" ? "usdc" : "eth"));
    if (this.chainName === "base") { if (k !== "usdc") bad('on Base payAsset must be "usdc" (no ETH, no USDG).'); return { token: this.cfg.stable, dec: 6 }; }
    if (!["eth", "usdg"].includes(k)) bad("payAsset must be eth or usdg.");
    return k === "usdg" ? { token: USDG, dec: 6 } : { token: ZERO, dec: 18 };
  }

  /** Compares the typed data the server wants signed with the terms you passed. Refuses to sign if anything differs. */
  async #checkConsent(typed, t) {
    if (!typed || typed.primaryType !== "Consent" || !typed.message || !typed.domain) bad("unexpected consent data.");
    const f = Object.fromEntries(Object.entries(typed.message).map(([k, v]) => [k, String(v).toLowerCase()]));
    const me = low(this.address);
    const dec = await this.#decimals(t.sellToken); // refuses when the decimals cannot be read: never guess 18
    const { token: payToken, dec: payDec } = this.#payAsset(t.payAsset);
    if (low(t.sellToken) === payToken) bad("sellToken and the payment asset must differ.");
    const want = {
      seller: me, buyer: low(t.buyer), sellToken: low(t.sellToken), sellAmount: parseUnits(String(t.sellAmount), dec).toString(),
      payToken, payAmount: parseUnits(String(t.payAmount), payDec).toString(), sellerPayout: low(t.sellerPayout || ZERO) /* zero = pay the seller */, buyerReceive: low(t.buyerReceive || ZERO),
    };
    for (const k of Object.keys(want)) if (f[k] !== want[k]) bad(`consent has ${k}=${f[k]}, you asked for ${want[k]}.`);
    const d = typed.domain;
    if (d.name !== "BullEscrow" || String(d.version) !== "3" || Number(d.chainId) !== this.cfg.id || !this.cfg.escrows.includes(low(d.verifyingContract))) bad(`consent names an unknown escrow contract or another chain than ${this.cfg.name} (${this.cfg.id}).`);
    const shape = (typed.types?.Consent || []).map((x) => x.name + ":" + x.type).join(",");
    if (shape !== "buyer:address,seller:address,sellerPayout:address,buyerReceive:address,sellToken:address,sellAmount:uint256,payToken:address,payAmount:uint256,deadline:uint64,validUntil:uint64") bad("consent has an unexpected layout.");
    if (!/^\d+$/.test(String(f.validUntil)) || Number(f.validUntil) < Math.floor(Date.now() / 1000) + 60) bad("consent is already expired or has no validity time.");
    const left = Number(f.deadline) - Math.floor(Date.now() / 1000);
    if (!(left > 600 && left <= 60 * 86400)) bad("consent has an unreasonable deadline.");
    if (Number(f.validUntil) > Number(f.deadline)) bad("consent stays valid longer than the deal deadline.");
    if (t.deadlineHours !== undefined && Math.abs(left - Number(t.deadlineHours) * 3600) > 600) bad("consent has a different deadline than you asked for.");
  }

  /** Buyer: opens the escrow deal. Returns the dealId. The createDeal transaction is decoded and checked BEFORE it is sent. */
  async open(params) {
    this.#note(params.sellToken);
    const { token: payToken, dec: pd } = this.#payAsset(params.payAsset);
    if (low(params.sellToken) === payToken) bad("sellToken and the payment asset must differ.");
    const sd = await this.#decimals(params.sellToken);
    const wantSell = parseUnits(String(params.sellAmount), sd), wantPay = parseUnits(String(params.payAmount), pd);
    const me = low(this.address);
    const q = await this.quote({ ...params, payAsset: params.payAsset || (this.cfg.alias === "usdc" ? "usdc" : "eth") });
    // The quote must be for THIS chain and THIS chain's escrow (the transaction is also checked against the pinned escrow list when it is sent).
    if (q.chainId !== undefined && Number(q.chainId) !== this.cfg.id) bad(`the server quoted chain ${q.chainId}, not ${this.cfg.name} (${this.cfg.id}).`);
    if (q.escrow !== undefined && !this.cfg.escrows.includes(low(q.escrow))) bad("the quote names an escrow that is not the pinned Bull escrow of this chain.");
    const pre = (fn) => {
      if (fn.functionName !== "createDeal") return;
      const [p, qt, c] = fn.args, now = Math.floor(Date.now() / 1000);
      if (low(p.seller) !== low(params.seller) || low(p.sellToken) !== low(params.sellToken) || p.sellAmount !== wantSell || low(p.payToken) !== payToken || p.payAmount !== wantPay)
        bad("the createDeal transaction has other terms (seller, token, amounts) than you asked for.");
      const wantPayout = low(params.sellerPayout || ZERO);
      if (low(p.sellerPayout) !== wantPayout && !(wantPayout === ZERO && low(p.sellerPayout) === low(params.seller))) bad("the createDeal transaction pays the seller's proceeds to another wallet than you asked for.");
      if (low(p.buyerReceive) !== low(params.buyerReceive || ZERO) && !(!params.buyerReceive && low(p.buyerReceive) === me)) bad("the createDeal transaction sends the tokens to a wallet other than yours.");
      if (Number(qt.feeBps) > 250) bad("the createDeal transaction has a fee above 2.5%.");
      const left = Number(p.deadline) - now;
      if (!(left > 600 && left <= 60 * 86400)) bad("the createDeal transaction has an unreasonable deadline.");
      if (Number(c.validUntil) < now) bad("the seller's consent in the transaction has expired.");
    };
    const rc = await this.#send(q.transaction, 0n, { fn: ["createDeal"], check: pre });
    const logs = parseEventLogs({ abi: ABI, logs: rc.logs, eventName: "DealCreated" });
    if (!logs.length) throw new Error("DealCreated event not found.");
    const L = logs[0].args;
    if (low(L.buyer) !== me || low(L.seller) !== low(params.seller)) bad("the deal that was opened has a different buyer or seller than you asked for.");
    if (L.feeBps > 250) bad("the deal has a fee above 2.5%.");
    if (q.feeBps !== undefined && Number(L.feeBps) !== Number(q.feeBps)) bad("the deal has a different fee than the quote you were shown.");
    const d = await this.#deal(L.id);
    if (low(d.buyer) !== me || low(d.seller) !== low(params.seller) || low(d.sellToken) !== low(params.sellToken) || d.sellAmount !== wantSell || low(d.payToken) !== payToken || d.payAmount !== wantPay)
      bad("the deal that was created on chain does not match the terms you asked for. Do NOT fund it; cancel it.");
    if (low(d.buyerReceive) !== low(params.buyerReceive || ZERO) && !(!params.buyerReceive && low(d.buyerReceive) === me)) bad("the deal that was created on chain sends the tokens to another wallet than yours. Do NOT fund it; cancel it.");
    const wp = low(params.sellerPayout || ZERO);
    if (low(d.sellerPayout) !== wp && !(wp === ZERO && low(d.sellerPayout) === low(params.seller))) bad("the deal that was created on chain pays the seller's proceeds elsewhere than you asked for. Do NOT fund it; cancel it.");
    return String(L.id);
  }

  /** Current state of a deal and the next transactions of each side. */
  status(dealId) {
    return this.#call("/api/v1/settle/" + dealId);
  }

  /** Sends every pending step of the connected wallet (buyer: pay, seller: deliver tokens). The swap settles when the second side funds.
   *  What each step may do is limited by the deal read from the chain (never by the server). */
  async fund(dealId) {
    const d = await this.#deal(dealId);
    if (d.status !== 1) bad("the deal is not open.");
    const me = low(this.address), buyer = me === low(d.buyer), seller = me === low(d.seller);
    if (!buyer && !seller) bad("this wallet is neither the buyer nor the seller of the deal.");
    const s = await this.status(dealId);
    const mine = [...s.buyerSteps, ...s.sellerSteps].filter((x) => low(x.from) === me);
    if (!mine.length) bad("nothing to fund from this wallet: no pending step for it (already funded, or the server returned no step).");
    const token = buyer ? d.payToken : d.sellToken;
    if (low(token) !== ZERO) this.tokens.add(low(token));
    const maxWei = buyer && low(d.payToken) === ZERO ? d.payAmount : 0n;
    const maxApprove = buyer ? d.payAmount : d.sellAmount;
    const hashes = [];
    for (const step of mine) hashes.push((await this.#send(step.transaction, maxWei, { token, maxApprove, fn: ["fundPayment", "fundTokens", "fundTokensWithPermit"], id: dealId })).transactionHash);
    return hashes;
  }

  /** Waits until the swap is settled (or cancelled). */
  async waitSettled(dealId, { timeoutMs = 600000, everyMs = 4000 } = {}) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const s = await this.status(dealId);
      if (s.status === "settled" || s.status === "cancelled") {
        // Never believe the server about this: read the deal from the chain.
        const d = await this.#deal(dealId);
        if (d.status !== (s.status === "settled" ? 2 : 3)) bad(`the server says the deal is ${s.status}, the chain does not.`);
        return s;
      }
      if (Date.now() > end) throw new Error("Timed out waiting for settlement.");
      await new Promise((r) => setTimeout(r, everyMs));
    }
  }

  /** Signed receipt of a settled deal. Public. */
  async receipt(dealId) {
    const j = await this.#call("/api/v1/receipts/" + dealId);
    const r = j.receipt;
    const message = ["Bull receipt v1", ...Object.entries(r).map(([k, x]) => `${k}:${x}`)].join("\n");
    if (message !== j.message) bad("the receipt text does not match its fields.");
    if (low(await recoverMessageAddress({ message, signature: j.signature })) !== FEE_SIGNER) bad("the receipt is not signed by Bull.");
    if (!this.cfg.escrows.includes(low(r.escrow)) || String(r.dealId) !== String(dealId)) bad("the receipt is for a different escrow or deal.");
    if (String(r.chainId) !== String(this.cfg.id)) bad(`the receipt is for chain ${r.chainId}, not ${this.cfg.name} (${this.cfg.id}).`);
    const d = await this.#deal(dealId, r.escrow);
    if (d.status !== 2 || low(d.buyer) !== low(r.buyer) || low(d.seller) !== low(r.seller) || low(d.sellToken) !== low(r.sellToken) || String(d.sellAmount) !== r.sellAmount || low(d.payToken) !== low(r.payToken) || String(d.payAmount) !== r.payAmount)
      bad("the chain does not show this deal as settled with these terms.");
    return j;
  }

  /** Locks tokens with an unlock schedule (cliff, then linear or stepped). Returns the lockId. Days can be fractions.
   *  await bull.lock({ token, amount: "1000000", beneficiary, cliffDays: 90, durationDays: 365, stepDays: 30, locker: "0xVestingContractYouTrust" }) */
  async lock({ token, amount, beneficiary, cliffDays = 0, durationDays, stepDays = 0, startAt, locker }) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(locker || ""))) bad("pass { locker }: the vesting contract address you trust. It is never taken from the server.");
    const q = await this.#call("/api/v1/vesting", { locker: this.address, token, amount, beneficiary, cliffDays, durationDays, stepDays, startAt });
    this.#note(token);
    const dec = await this.#decimals(token);
    let rc;
    const hex = (a) => low(a).slice(2).padStart(64, "0");
    for (const step of q.steps) {
      const tx = step.transaction, d = String(tx?.data || "").toLowerCase();
      // Only the approval and the call to the locker you pinned are allowed. A call to any Bull contract (createAgreement, fundPayment, ...) is refused, and the locker call must name the token and the beneficiary you asked for.
      if (low(tx?.to) === low(locker) && !d.startsWith("0x095ea7b3") && !(d.includes(hex(token)) && d.includes(hex(beneficiary))))
        bad("the lock transaction does not name the token and the beneficiary you asked for.");
      rc = await this.#send(tx, 0n, { locker, token, fn: [], maxApprove: parseUnits(String(amount), dec) });
    }
    const logs = parseEventLogs({ abi: LOCK_ABI, logs: rc.logs, eventName: "LockCreated" });
    if (!logs.length) throw new Error("LockCreated event not found.");
    const L = logs[0].args;
    if (low(L.token) !== low(token) || low(L.beneficiary) !== low(beneficiary) || L.amount !== parseUnits(String(amount), dec)) bad("the lock that was created does not match what you asked for.");
    const near = (got, days) => Math.abs(Number(got) - Number(days || 0) * 86400) <= 3600; // within an hour
    if (!near(L.cliff - L.start, cliffDays) || !near(L.end - L.start, durationDays) || !near(L.step, stepDays) || (Number(startAt) > 0 && Number(L.start) !== Math.floor(Number(startAt))))
      bad("the lock that was created has a different cliff, end or step than the schedule you asked for.");
    return String(L.id);
  }

  /** Schedule and unlocked/claimable amounts of a lock. Public. */
  lockStatus(lockId) {
    return this.#call("/api/v1/vesting/" + lockId);
  }

  /** Claims what has unlocked. Anyone can send it, the tokens always go to the beneficiary. */
  async claim(lockId, opts = {}) {
    const s = await this.lockStatus(lockId);
    if (!s.claimTransaction) throw new Error("Nothing to claim yet.");
    if (!opts.locker || low(opts.locker) !== low(s.claimTransaction.to)) bad("pass { locker } with the vesting contract address you trust; the server's claim goes elsewhere.");
    return (await this.#send(s.claimTransaction, 0n, { locker: opts.locker, fn: [] })).transactionHash;
  }

  /** Programmable escrow: pay `payee` when all conditions are true, refund the payer after expiry. Returns the agreementId.
   *  await bull.agree({ payee, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72,
   *    conditions: [{ type: "attest", by: "0xArbiterOrAgentB" }, { type: "time_after", afterHours: 1 }] })
   *  Condition types: time_after {at|afterHours}, attest {by}, veto {by, afterHours, attestIndex}, unless {by, afterHours}, quorum {by:[wallets], k}, deal_settled {dealId}, token_balance_gte {token, holder, min}, call_gte / call_lte {target, data, value}.
   *  expiryHours default 72: after it release() is impossible and anyone can refund the payer. DEMO ONLY: attest by the payer lets the payer alone decide; for an untrusted payee use an arbiter wallet. */
  async agree({ payee, asset = "eth", amount, terms, expiryHours, conditions }) {
    const q = await this.#call("/api/v1/agreements", { payer: this.address, payee, asset, amount, terms, expiryHours, conditions });
    await this.#preflight(q.steps, String(asset).toLowerCase() === "eth");
    this.#note(asset);
    const dec = await this.#decimals(asset);
    const want = parseUnits(String(amount), dec);
    const cap = this.#agreeCap(asset, amount);
    let rc;
    const assetAddr = String(asset).toLowerCase() === "eth" ? ZERO : (String(asset).toLowerCase() === this.cfg.alias ? this.cfg.stable : low(asset));
    const expect = Array.isArray(conditions) ? await this.#expectConditions(conditions) : null;
    const wantTerms = terms ? keccak256(toHex(String(terms))) : "0x" + "00".repeat(32);
    const creates = (q.steps || []).filter((x) => String(x?.name) === "createAgreement" || low(x?.transaction?.to) === this.cfg.agreement).length;
    if (creates !== 1) bad(`the server returned ${creates} createAgreement steps, you asked for exactly one.`);
    const check = (fn) => {
      if (fn.functionName !== "createAgreement") return;
      const p = fn.args[0], now = Math.floor(Date.now() / 1000);
      if (low(p.payee) !== low(payee) || low(p.asset) !== assetAddr || p.amount !== want) bad("the agreement transaction has a different payee, asset or amount than you asked for.");
      if (Number(p.expiry) <= now || (expiryHours !== undefined && Math.abs(Number(p.expiry) - (now + Number(expiryHours) * 3600)) > 900)) bad("the agreement transaction has a different expiry than you asked for.");
      if (low(p.termsHash) !== wantTerms) bad("the agreement transaction commits to other terms than the text you passed (termsHash).");
      if (expect) this.#matchConditions(p.conditions, expect);
    };
    for (const step of q.steps) rc = await this.#send(step.transaction, cap, { token: assetAddr, maxApprove: want, fn: ["createAgreement"], check });
    const logs = parseEventLogs({ abi: AGR_ABI, logs: rc.logs, eventName: "AgreementCreated" });
    if (!logs.length) throw new Error("AgreementCreated event not found.");
    const L = logs[0].args;
    if (low(L.payer) !== low(this.address) || low(L.payee) !== low(payee)) bad("the agreement that was created has a different payer or payee than you asked for.");
    if (L.amount !== want || low(L.asset) !== (String(asset).toLowerCase() === "eth" ? ZERO : (String(asset).toLowerCase() === this.cfg.alias ? this.cfg.stable : low(asset)))) bad("the agreement that was created has a different asset or amount than you asked for.");
    if (low(L.termsHash) !== wantTerms) bad("the agreement that was created commits to other terms than the text you passed (termsHash).");
    return String(L.id);
  }

  /** The on-chain conditions (kind, target, data, value) that the conditions you passed must turn into. */
  async #expectConditions(conditions) {
    const now = Math.floor(Date.now() / 1000), out = [];
    for (const c of conditions) {
      const at = (x) => (Number(x.at) > 0 ? { v: BigInt(Math.floor(Number(x.at))), tol: 0 } : { v: BigInt(now + Math.round(Number(x.afterHours) * 3600)), tol: 900 });
      if (c.type === "time_after") out.push({ kind: 0, target: ZERO, ...at(c) });
      else if (c.type === "unless") out.push({ kind: 5, target: low(c.by), ...at(c) });
      else if (c.type === "veto") out.push({ kind: 9, target: low(c.by), data: encodeAbiParameters([{ type: "uint256" }], [BigInt(c.attestIndex ?? conditions.slice(0, conditions.indexOf(c)).map((x) => x.type).lastIndexOf("attest"))]).toLowerCase(), v: BigInt(Math.round(Number(c.afterHours) * 3600)), tol: 0 });
      else if (c.type === "attest") out.push({ kind: 1, target: low(c.by) });
      else if (c.type === "token_balance_gte") out.push({ kind: 7, target: low(c.token), data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [c.holder] }).toLowerCase(), v: parseUnits(String(c.min), await this.#decimals(c.token)), tol: 0 });
      else if (c.type === "call_gte" || c.type === "call_lte") out.push({ kind: c.type === "call_gte" ? 7 : 8, target: low(c.target), data: low(c.data), v: BigInt(c.value), tol: 0 });
      else if (c.type === "deal_settled") out.push({ kind: 4, target: low(c.escrow || this.cfg.escrows[0]), v: BigInt(c.dealId), tol: 0 });
      else if (c.type === "quorum") out.push({ kind: 6, target: ZERO, data: encodeAbiParameters([{ type: "address[]" }], [c.by]).toLowerCase(), v: BigInt(c.k), tol: 0 });
      else bad(`unknown condition type ${c.type}.`);
    }
    return out;
  }

  /** Every on-chain condition must equal the one you asked for, in order: kind, target, data and value. */
  #matchConditions(got, expect) {
    if (got.length !== expect.length) bad("the agreement transaction has a different number of conditions than you asked for.");
    got.forEach((g, i) => {
      const e = expect[i], v = BigInt(g.value), d = e.v === undefined ? 0n : e.v, tol = BigInt(e.tol || 0);
      if (Number(g.kind) !== e.kind || low(g.target) !== e.target || (e.data !== undefined && low(g.data) !== e.data) || (e.v !== undefined && (v < d - tol || v > d + tol)) || (e.v === undefined && v !== 0n))
        bad(`condition ${i + 1} of the agreement transaction is not the one you asked for.`);
    });
  }

  // Most ETH an agreement transaction may carry: the amount (if paid in ETH) plus a fee allowance.
  #agreeCap(asset, amount, mult = 105n) {
    const fee = parseEther("0.05");
    return String(asset || "eth").toLowerCase() === "eth" ? (parseEther(String(amount)) * mult) / 100n + fee : fee;
  }

  /** Status, every condition (met true/false) and the next transactions. Public. */
  agreement(id) {
    return this.#call("/api/v1/agreements/" + id);
  }

  /** Sends every pending action of the connected wallet on an agreement: attest (confirm), vote (panel) or, with
   *  { object: true }, the objection of an "unless" window. */
  async attest(id, { object = false } = {}) {
    const a = await this.agreement(id);
    const mine = a.conditions.flatMap((c) => c.actions).filter((x) => x.from.toLowerCase() === this.address.toLowerCase() && (object ? x.name === "object" : x.name !== "object"));
    if (!mine.length) throw new Error("Nothing to " + (object ? "object to" : "confirm") + " from this wallet.");
    const hashes = [];
    for (const x of mine) hashes.push((await this.#send(x, 0n, { fn: object ? ["object"] : ["attest", "vote"], id })).transactionHash);
    return hashes;
  }

  /** Objects during an objection window (template "optimistic"): the payee is then not paid automatically. */
  object(id) {
    return this.attest(id, { object: true });
  }

  /** Deal templates and their fields. Public. */
  templates() {
    return this.#call("/api/v1/templates");
  }

  /** One call for a standard deal. Returns the agreement id (an array for "milestones").
   *  await bull.deal("arbiter_escrow", { payee, asset: "usdg", amount: "500", arbiter: "0xArbiter", terms: "Deliver the report" })
   *  Templates: delivery_vs_payment, arbiter_escrow, two_of_three, panel, optimistic, confirmed_with_cooling, milestones, scheduled_payment, recurring_payment, split_payment, after_deal, balance_trigger, price_trigger, token_price_trigger (Robinhood only), performance_bond.
   *  Fields: two_of_three { arbiter } (payer, payee, arbiter: any two release); confirmed_with_cooling { arbiter, windowHours }; token_price_trigger { token, op: "above"|"below", price, priceIn: "eth"|"usd" }. expiryHours default 72. */
  async deal(template, params) {
    if (template === "delivery_vs_payment") return this.open({ seller: params.seller, sellToken: params.sellToken, sellAmount: params.sellAmount, payAsset: params.payAsset, payAmount: params.payAmount, deadlineHours: params.deadlineHours });
    const q = await this.#call("/api/v1/templates", { ...params, template, payer: this.address });
    await this.#preflight(q.steps, String(params.asset || "eth").toLowerCase() === "eth");
    this.#note(params.asset);
    const dec = await this.#decimals(params.asset || "eth");
    const amountOne = parseUnits(String(params.amount), dec);
    const cap = this.#agreeCap(params.asset || "eth", params.amount);
    const ids = [];
    let sum = 0n;
    const assetAddr = String(params.asset || "eth").toLowerCase() === "eth" ? ZERO : (String(params.asset).toLowerCase() === this.cfg.alias ? this.cfg.stable : low(params.asset));
    const isMs = template === "milestones", isRec = template === "recurring_payment", isSplit = template === "split_payment", multi = isMs || isRec || isSplit;
    const payeesL = isSplit && Array.isArray(params.payees) ? params.payees.map(low) : [];
    const n = isMs ? Math.round(Number(params.milestones)) : isRec ? Math.round(Number(params.payments)) : isSplit ? payeesL.length : 1;
    if (isMs && !(n >= 2 && n <= 8)) bad("milestones must be 2 to 8.");
    if (isRec && !(n >= 2 && n <= 12)) bad("payments must be 2 to 12.");
    if (isSplit && !(n >= 2 && n <= 10)) bad("payees must list 2 to 10 wallets.");
    const total = isRec ? amountOne * BigInt(n) : amountOne;
    // Split: the amount of each share, computed exactly like the server does it (micro units, the first payee gets the rounding rest).
    let splitAmt = [];
    if (isSplit) {
      if (dec < 6) bad("split payments need a token with at least 6 decimals.");
      const sh = (Array.isArray(params.shares) ? params.shares : []).map(Number);
      if (sh.length !== n || sh.some((x) => !(x > 0) || !Number.isFinite(x))) bad("shares must be one positive number per payee.");
      const sumSh = sh.reduce((a, c) => a + c, 0), totalMicro = Math.round(Number(params.amount) * 1e6);
      const micro = sh.map((x) => Math.floor((totalMicro * x) / sumSh));
      micro[0] += totalMicro - micro.reduce((a, c) => a + c, 0);
      splitAmt = micro.map((m) => BigInt(m) * 10n ** BigInt(dec - 6));
    }
    const creates = (q.steps || []).filter((x) => String(x?.name) === "createAgreement" || low(x?.transaction?.to) === this.cfg.agreement).length;
    if (creates !== n) bad(`the server returned ${creates} createAgreement steps, you asked for ${n}.`);
    // Conditions each template must produce (kind and target). The arbiter / payer / token you passed must be the ones in the transaction.
    const me = low(this.address), arb = low(params.arbiter);
    const shape = {
      arbiter_escrow: [[1, arb]], performance_bond: [[1, arb]], milestones: [[1, arb]], recurring_payment: [[0, ZERO]], split_payment: [[params.arbiter ? 1 : 0, params.arbiter ? arb : ZERO]], optimistic: [[5, me]], panel: [[6, ZERO]], two_of_three: [[6, ZERO]],
      scheduled_payment: [[0, ZERO]], confirmed_with_cooling: [[1, arb], [9, me]], after_deal: [[4, null]], balance_trigger: [[7, low(params.token)]],
      price_trigger: [[params.op === "lte" ? 8 : 7, low(params.target)]],
    }[template];
    if (!shape && template !== "token_price_trigger") bad(`unknown template ${template}.`);
    const wantTerms = params.terms ? keccak256(toHex(String(params.terms))) : "0x" + "00".repeat(32);
    const hoursMax = Math.max(Number(params.expiryHours) || 72, Number(params.windowHours || 0) + 24, Number(params.afterHours || 0) + 24, isMs ? (Number(params.stepHours) || 168) * n : 0, isRec ? (Number(params.everyHours) || 168) * n + 24 : 0);
    const balMin = template === "balance_trigger" ? parseUnits(String(params.min), await this.#decimals(params.token)) : 0n;
    const balData = template === "balance_trigger" ? encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [params.holder] }).toLowerCase() : "";
    let seen = 0;
    const check = (fn) => {
      if (fn.functionName !== "createAgreement") return;
      const p = fn.args[0], now = Math.floor(Date.now() / 1000);
      seen++;
      if (low(p.asset) !== assetAddr || (params.payee && low(p.payee) !== low(params.payee))) bad("the agreement transaction has a different payee or asset than you asked for.");
      if (isSplit && low(p.payee) !== payeesL[seen - 1]) bad("the agreement transaction pays another wallet than the payee you listed for this share.");
      const amountOk = isMs ? (p.amount <= total && p.amount >= total / BigInt(n) - BigInt(n) * 10n ** BigInt(Math.max(0, dec - 6))) : isRec ? p.amount === amountOne : isSplit ? p.amount === splitAmt[seen - 1] : p.amount === total;
      if (!amountOk) bad("the agreement transaction has a different amount than you asked for.");
      if (Number(p.expiry) <= now || Number(p.expiry) > now + hoursMax * 3600 + 900) bad("the agreement transaction has an expiry that does not fit the expiryHours you asked for.");
      if (template === "milestones") {
        const want = Math.max(Number(params.expiryHours) || 0, (Number(params.stepHours) || 168) * seen);
        if (Math.abs(Number(p.expiry) - (now + want * 3600)) > 1800) bad(`milestone ${seen} has an expiry that is not the ${want} hours the schedule defines.`);
      }
      if (low(p.termsHash) !== wantTerms && !multi) bad("the agreement transaction commits to other terms than the text you passed (termsHash).");
      if (shape) {
        if (p.conditions.length !== shape.length) bad("the agreement transaction has a different number of conditions than the template defines.");
        shape.forEach(([kind, target], i) => { const g = p.conditions[i]; if (Number(g.kind) !== kind || (target !== null && low(g.target) !== target)) bad(`condition ${i + 1} of the agreement transaction is not the one the template defines for the parameters you passed.`); });
        if (template === "price_trigger" && (low(p.conditions[0].data) !== low(params.data) || BigInt(p.conditions[0].value) !== BigInt(params.value))) bad("the price condition has another data or threshold than you asked for.");
        if (template === "after_deal" && p.conditions[0].value !== BigInt(params.dealId)) bad("the deal_settled condition names another deal than you asked for.");
        if (template === "balance_trigger" && (BigInt(p.conditions[0].value) !== balMin || low(p.conditions[0].data) !== balData)) bad("the balance condition watches another wallet or minimum than you asked for.");
        const near = (v, hours) => Number.isFinite(hours) && Math.abs(Number(v) - (now + hours * 3600)) <= 900;
        if (template === "scheduled_payment" && !near(p.conditions[0].value, Number(params.afterHours))) bad("the time condition unlocks at another time than the afterHours you asked for.");
        if (isRec) { const ev = Number(params.everyHours) || 168; if (Math.abs(Number(p.conditions[0].value) - (now + seen * ev * 3600)) > 1800) bad(`payment ${seen} unlocks at another time than every ${ev} hours.`); }
        if (isSplit && !params.arbiter && !near(p.conditions[0].value, Number(params.afterHours))) bad("the share unlocks at another time than the afterHours you asked for.");
        if (template === "optimistic" && !near(p.conditions[0].value, Number(params.windowHours) || 24)) bad("the objection window is another length than the windowHours you asked for.");
      }
      if (sum + p.amount > total) bad("the agreement transactions would lock more than the amount you asked for.");
      sum += p.amount; // counted BEFORE it is sent
    };
    for (const step of q.steps) {
      const rc = await this.#send(step.transaction, cap, { token: assetAddr, maxApprove: total, fn: ["createAgreement"], check });
      for (const l of parseEventLogs({ abi: AGR_ABI, logs: rc.logs, eventName: "AgreementCreated" })) ids.push(String(l.args.id));
    }
    if (seen !== n || ids.length !== n) bad(`${ids.length} agreements were created, you asked for ${n}.`);
    if (sum > total || (isMs ? total - sum > BigInt(n) * 10n ** BigInt(Math.max(0, dec - 6)) : sum !== total)) bad("the agreements that were created do not add up to the amount you asked for.");
    return n > 1 ? ids : ids[0];
  }

  /** Streaming payments (pay per second). bull.stream.create({ payee, amount, token?, durationDays | durationSeconds, startAt?, arbiter? }) returns the stream id.
   *  token: leave out for native ETH on both chains (the server default), "usdg" (Robinhood), "usdc" (Base) or a token address. amount is in WHOLE units ("100"); amountRaw (integer string) overrides it.
   *  Like agree(), the transaction is decoded and checked before it is sent: chain id, target = the Streams contract of this chain, payee, arbiter, asset, amount, start, duration, fee, and an approval only on your token for at most the amount to that contract.
   *  The stream id is read from the StreamCreated event. bull.stream.status(id) is a public read (vested, withdrawn, withdrawable, ready withdraw/cancel/pause/resume transactions; the SDK does not send those, decode them before you do). */
  get stream() {
    const self = this;
    return {
      create: (o) => self.#streamCreate(o),
      status: (id) => self.#call("/api/v1/streams/" + encodeURIComponent(String(id))),
    };
  }

  async #streamCreate({ payee, amount, amountRaw, token, durationDays, durationSeconds, startAt, arbiter } = {}) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(payee || ""))) bad("pass { payee }: the wallet that receives the stream.");
    const tk = token === undefined || token === null || token === "" ? "eth" : String(token);
    const isEth = low(tk) === "eth" || low(tk) === ZERO;
    if (!isEth && low(tk) !== this.cfg.alias && !/^0x[0-9a-fA-F]{40}$/.test(tk)) bad(`token must be left out (ETH), "${this.cfg.alias}" or a token address.`);
    const assetAddr = isEth ? ZERO : (low(tk) === this.cfg.alias ? this.cfg.stable : low(tk));
    const secs = Number(durationSeconds) > 0 ? Math.round(Number(durationSeconds)) : Math.round(Number(durationDays) * 86400);
    if (!(secs >= 1) || !Number.isFinite(secs)) bad("set durationSeconds or durationDays (above 0).");
    const arb = arbiter ? low(arbiter) : ZERO;
    if (arbiter && !/^0x[0-9a-fA-F]{40}$/.test(String(arbiter))) bad("arbiter must be a wallet address.");
    const start = Number(startAt) > 0 ? Math.floor(Number(startAt)) : 0;
    const body = { payer: this.address, payee, durationSeconds: secs, ...(isEth ? {} : { token: tk }), ...(start ? { startAt: start } : {}), ...(arbiter ? { arbiter } : {}), ...(amountRaw !== undefined ? { amountRaw: String(amountRaw) } : { amount: String(amount) }) };
    const q = await this.#call("/api/v1/streams", body);
    await this.#preflight(q.steps, isEth);
    if (!isEth) this.#note(tk);
    const want = amountRaw !== undefined ? BigInt(String(amountRaw)) : parseUnits(String(amount), await this.#decimals(isEth ? "eth" : tk));
    if (want <= 0n) bad("the stream amount must be above 0.");
    const creates = (q.steps || []).filter((x) => low(x?.transaction?.to) === this.cfg.stream).length;
    if (creates !== 1) bad(`the server returned ${creates} createStream steps, you asked for exactly one.`);
    const cap = (isEth ? want : 0n) + parseEther("0.05"); // amount (if ETH) plus a fee allowance, same as agreements
    let rc;
    for (const step of q.steps) {
      const tx = step.transaction;
      const check = (fn) => {
        if (fn.functionName !== "createStream") return;
        const p = fn.args[0], f = fn.args[1];
        if (low(p.payee) !== low(payee) || low(p.arbiter) !== arb || low(p.asset) !== assetAddr || p.amount !== want) bad("the stream transaction has a different payee, arbiter, asset or amount than you asked for.");
        if (Number(p.durationSecs) !== secs) bad("the stream transaction has a different duration than you asked for.");
        if (Number(p.start) !== start) bad("the stream transaction starts at another time than you asked for.");
        if (BigInt(tx.value || "0") !== BigInt(f.feeWei) + (isEth ? want : 0n)) bad("the stream transaction carries a different ETH value than the fee (plus the amount, if paid in ETH).");
        if (Number(f.expiry) <= Math.floor(Date.now() / 1000)) bad("the fee quote of the stream transaction has already expired.");
      };
      rc = await this.#send(tx, cap, { token: assetAddr, maxApprove: want, fn: ["createStream"], check, stream: true });
    }
    const logs = parseEventLogs({ abi: STREAM_EVT, logs: rc.logs, eventName: "StreamCreated" });
    if (!logs.length) throw new Error("StreamCreated event not found.");
    const L = logs[0].args;
    if (low(L.payer) !== low(this.address) || low(L.payee) !== low(payee) || low(L.arbiter) !== arb || low(L.asset) !== assetAddr || L.amount !== want) bad("the stream that was created has a different payer, payee, arbiter, asset or amount than you asked for.");
    return String(L.id);
  }

  /** Pays the payee once every condition is true (anyone can send it). */
  async release(id) {
    const a = await this.agreement(id);
    if (!a.releaseTransaction) throw new Error("Not releasable yet: " + a.conditions.filter((c) => !c.met).map((c) => c.type).join(", "));
    return (await this.#send(a.releaseTransaction, 0n, { fn: ["release"], id })).transactionHash;
  }

  /** After the expiry, sends the funds back to the payer (anyone can send it). */
  async refund(id) {
    const a = await this.agreement(id);
    if (!a.refundTransaction) throw new Error("Not refundable yet.");
    return (await this.#send(a.refundTransaction, 0n, { fn: ["refund"], id })).transactionHash;
  }

  // ---- Cross-chain (Base <-> Robinhood Chain), third-party bridge. Bull never holds bridge funds; the recipient is always your own address. ----
  /** bull.bridge.quote({from,to,amount}) / .send(quote) / .status(id) / .wait(id). `to` is the settlement chain. Experimental, not tested end to end. */
  get bridge() {
    const self = this;
    const forbidSet = (user) => new Set([NATIVE, DEAD, low(user), low(self.cfg.agreement), ...self.cfg.escrows.map(low), BRIDGE.base.token, low(BRIDGE.robinhood.token)]);
    const prep = async ({ from, to, amount, user, asset, fromAsset, toAsset }, needPrice = false) => {
      const f = bridgeChain(from), t = bridgeChain(to);
      if (f.id === t.id) bad("from and to must be different chains.");
      const legacy = bridgeAsset(asset) === "eth" ? "eth" : "stable"; // old `asset`: "eth" = eth->eth, default = stable->stable
      const inKind = kindOf(fromAsset ?? legacy, "fromAsset"), outKind = kindOf(toAsset ?? legacy, "toAsset");
      const mixed = inKind !== outKind;
      const a = mixed ? "mixed" : inKind === "eth" ? "eth" : "usdc_usdg";
      const raw = toRaw(amount, inKind === "eth" ? "eth" : "usdc_usdg");
      const u = user || self.address;
      if (inKind === "eth") {
        if (raw <= 0n) bad("amount must be greater than 0.");
        if (needPrice) { // same USD caps as the stablecoin bridge (1 to 10000 USD); only checked client-side when the SDK talks to Relay directly (the Bull server checks its own path)
          const p = await ethSpot(); if (!p) bad("could not read the ETH/USD price to apply the 1 to 10000 USD bridge limits. Try again.");
          const usd = Number(raw) / 1e18 * p; if (usd < 1 || usd > 10000) bad(`the ETH amount is about $${usd.toFixed(2)}; the bridge limits are $1 to $10000.`);
        }
      } else if (raw < 1000000n || raw > 10000n * 1000000n) bad("amount must be between 1 and 10000.");
      return { from: f, to: t, amount: String(amount).trim(), raw, user: u, asset: a, inKind, outKind, mixed, inCur: inKind === "eth" ? NATIVE : f.token, outCur: outKind === "eth" ? NATIVE : t.token, forbid: forbidSet(u), allowedSpenders: envList("BRIDGE_ALLOWED_SPENDERS"), allowedTo: envList("BRIDGE_ETH_ALLOWED_TO") };
    };
    const relay = async (path, body) => {
      const r = await fetch(RELAY_API + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-api-key": self.relayKey }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || j?.error || `Relay ${r.status}`);
      return j;
    };
    return {
      /** Quote: the transactions that move your stablecoin to the settlement chain. Nothing is sent. */
      quote: async (o) => {
        const req = await prep(o, !!this.relayKey);
        const price = req.mixed ? await ethSpot() : null; // swap routes: the output value is checked in USD here as well (fails closed without a price)
        if (low(req.user) === low(this.cfg.agreement) || this.cfg.escrows.includes(low(req.user))) bad("user must be your own wallet, not a Bull contract.");
        if (this.relayKey) {
          if (req.inKind === "eth" && !req.allowedTo.length) bad("native ETH routes with your own Relay key need a router you verified: set BRIDGE_ETH_ALLOWED_TO (comma separated). Bull cannot verify Relay's router addresses for you.");
          const j = await relay("/quote/v2", { user: req.user, originChainId: req.from.id, destinationChainId: req.to.id, originCurrency: req.inCur, destinationCurrency: req.outCur, amount: req.raw.toString(), tradeType: "EXACT_INPUT", recipient: req.user });
          return checkBridge(relayToBull(req, j, price), req);
        }
        const r = await fetch(this.base + "/api/v1/bridge/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fromChain: req.from.key, toChain: req.to.key, amount: req.amount, user: req.user, ...(req.mixed ? { fromAsset: req.inKind, toAsset: req.outKind } : req.asset === "eth" ? { asset: "eth" } : {}) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error?.message || j?.error || `Bull API ${r.status}`);
        if (req.mixed) { if (j?.to?.token && low(j.to.token) !== low(req.outCur)) bad("the bridge pays out another currency than you asked for."); mixedValueCheck(req, j?.expectedOut ?? null, price); }
        return checkBridge(j, req);
      },
      /** Sends the quote's transactions from this wallet, in order (the SDK must be constructed with chain = the ORIGIN chain). Returns the transaction hashes. */
      send: async (q) => {
        const f = bridgeChain(q?.from?.chain), t = bridgeChain(q?.to?.chain);
        const inKind = low(q?.from?.token) === NATIVE || q?.fromAsset === "eth" || q?.asset === "eth" ? "eth" : "stable"; // a quote that says ETH is checked by the (stricter, value-bearing) ETH rules
        const outKind = low(q?.to?.token) === NATIVE || q?.toAsset === "eth" || q?.asset === "eth" ? "eth" : "stable";
        const a = inKind; // "eth" = value-bearing single transaction
        const req = { from: f, to: t, amount: q.amount, raw: toRaw(q.amount, inKind === "eth" ? "eth" : "usdc_usdg"), user: self.address, asset: inKind === outKind ? (inKind === "eth" ? "eth" : "usdc_usdg") : "mixed", inKind, outKind, mixed: inKind !== outKind, outCur: outKind === "eth" ? NATIVE : t.token, forbid: forbidSet(self.address), allowedSpenders: envList("BRIDGE_ALLOWED_SPENDERS"), allowedTo: envList("BRIDGE_ETH_ALLOWED_TO") };
        checkBridge(q, req);
        if (this.cfg.id !== f.id) bad(`create the Bull instance with chain "${f.key}" to send the bridge from ${f.name}.`);
        await this.#chainOk();
        const hashes = [];
        for (const s of q.steps) {
          const hash = await this.w.sendTransaction({ account: this.w.account, to: s.transaction.to, data: s.transaction.data, value: a === "eth" ? BigInt(s.transaction.value) : 0n });
          let rc;
          try { rc = await this.p.waitForTransactionReceipt({ hash, timeout: 180000 }); }
          catch (e) { throw new Error(`Bridge transaction ${hash} was sent but no receipt arrived (${e?.shortMessage || e?.message || e}). Check the chain for this hash before you retry.`); }
          if (rc.status !== "success") throw new Error("Bridge transaction failed: " + hash + ". Later steps were not sent.");
          hashes.push(hash);
        }
        return hashes;
      },
      /** pending | confirmed | failed | refunded. Open the agreement only when it is confirmed. */
      status: async (id) => {
        if (!/^0x[0-9a-fA-F]{64}$/.test(String(id || ""))) bad("id must be the 0x… id from bridge.quote.");
        if (this.relayKey) {
          const j = await relay("/intents/status/v3?requestId=" + id);
          const raw = low(j?.status);
          const status = raw === "success" ? "confirmed" : raw === "refund" || raw === "refunded" ? "refunded" : raw === "failure" ? "failed" : "pending";
          return { id, status, done: status !== "pending", relayStatus: raw || null };
        }
        const r = await fetch(this.base + "/api/v1/bridge/status?id=" + id);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error?.message || j?.error || `Bull API ${r.status}`);
        return j;
      },
      /** Polls until the bridge is confirmed. Throws if it failed or was refunded. Default timeout 15 minutes. */
      wait: async (id, { timeoutMs = 900000, everyMs = 4000 } = {}) => {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
          const s = await this.bridge.status(id);
          if (s.status === "confirmed") return s;
          if (s.status === "failed" || s.status === "refunded") throw new Error("Bridge " + s.status + ". Do not open the agreement.");
          await new Promise((r) => setTimeout(r, everyMs));
        }
        throw new Error("Bridge not confirmed in time. Check bridge.status(id) before you do anything else.");
      },
    };
  }

  /** Plan for an agreement between agents on different chains. Sends nothing. Returns ordered steps:
   *  1 bridge (payer's stablecoin to the settlement chain, only if the payer is not already there), 2 wait for the bridge, 3 approve + open the agreement ON the
   *  settlement chain, 4 release later. settleOn defaults to the seller's chain, so the seller is paid natively. Experimental: third-party bridge, not tested end to end. */
  async crossChainSettle({ payerChain, sellerChain, amount, settleOn, payer = this.address, template = "arbiter_escrow", terms, asset }) {
    const eth = bridgeAsset(asset) === "eth";
    const pc = bridgeChain(payerChain), sc = bridgeChain(sellerChain), st = bridgeChain(settleOn || sellerChain);
    if (pc.id === sc.id) bad("both agents are on the same chain: no bridge needed, use bull.deal() on that chain.");
    const steps = [];
    if (pc.id !== st.id) {
      const quote = await this.bridge.quote({ from: pc.key, to: st.key, amount, user: payer, asset: eth ? "eth" : undefined });
      steps.push({ n: 1, action: "bridge", chain: pc.key, by: "payer", note: eth ? `Send this transaction on ${pc.name}: ETH arrives as ETH on ${st.name}, to your own address.` : `Send these transactions on ${pc.name}: ${pc.symbol} arrives as ${st.symbol} on ${st.name}, to your own address.`, quote });
      steps.push({ n: 2, action: "wait_bridge", by: "payer", note: "Call bull.bridge.wait(quote.id). Only continue when it is confirmed.", id: quote.id });
    } else {
      steps.push({ n: 1, action: "bridge", by: "none", note: `The payer is already on the settlement chain ${st.name}. The seller receives ${st.symbol} there and can bridge it with bull.bridge.quote() if it wants it on ${sc.name}.` });
    }
    steps.push({ n: steps.length + 1, action: "open_agreement", chain: st.key, by: "payer", note: `With a Bull instance on chain "${st.key}": await bull.deal("${template}", { payee, asset: "${eth ? "eth" : st.asset}", amount: "${amount}"${terms ? `, terms: ${JSON.stringify(terms)}` : ""}, ... }). Approve + createAgreement are sent, checked by the SDK. Needs a little ETH on ${st.name} for gas and the protocol fee.` });
    steps.push({ n: steps.length + 1, action: "release", chain: st.key, by: "anyone", note: "When the conditions are true (e.g. the arbiter attested): bull.release(id). The keeper does it too. After expiry: bull.refund(id)." });
    return { settlementChain: st.key, payerChain: pc.key, sellerChain: sc.key, amount: String(amount), status: "experimental: third-party bridge (Relay), not tested end to end", steps };
  }

  /** STAGE 2, one call: settle with an agent on either chain. RULE: the agreement lives on exactly ONE chain, the seller's (settlementChain). The seller never bridges.
   *  1. Read the buyer's (this wallet's) balance of the settlement token and ETH gas on the settlement chain.
   *  2. Enough? NOTHING is bridged: the agreement is opened and funded right there.
   *  3. Not enough, but the buyer holds enough on the other chain? Bridge exactly the shortfall (+ a 5% buffer, minimum 1) with Relay to the buyer's OWN address,
   *     wait until it is confirmed AND the balance arrived (polls, with timeouts), then open + fund on the settlement chain.
   *  4. Otherwise throws a clear error saying what is missing (token, amount, chain, gas). Any failed step stops everything: funds then sit with the buyer, never half-locked.
   *  dryRun: true returns the decision ("bridge: not needed" / "bridge 21 USDC -> USDG") and sends nothing (needs only publicClients).
   *  Clients: this instance's clients are used for its own chain. Pass the OTHER chain's clients in `clients`, e.g. { base: { walletClient, publicClient } } when this instance is on Robinhood (same account on both).
   *  const out = await bull.settleCrossChain({ settlementChain: "robinhood", sellerAddress: "0xSeller", amount: "25", template: "arbiter_escrow", arbiter: "0xArbiter", terms: "Deliver the report", clients: { base: { walletClient: wBase, publicClient: pBase } } });
   *  Own conditions instead of a template: pass `conditions: [...]` (see agree()). delivery_vs_payment (instant swap) settles on ONE chain and is not part of the cross-chain helper: use bull.open() on that chain.
   *  Options: bufferBps (default 500), minGasEth ("0.0003", settlement chain), originGasEth ("0.00005"), bridgeTimeoutMs (15 min), arrivalTimeoutMs (5 min).
   *  Experimental: third-party bridge (Relay), not tested end to end. Bull never holds bridge funds; the bridge recipient is always the buyer's own address. */
  async settleCrossChain({ pendingBridge, onBridge, asset, payWith, settlementAsset, mixedBufferBps = 800, settlementChain, sellerAddress, payee, amount, template = "arbiter_escrow", conditions, terms, expiryHours, clients = {}, dryRun = false, bufferBps = 500, minGasEth = "0.0003", originGasEth = "0.00005", bridgeTimeoutMs = 900000, arrivalTimeoutMs = 300000, ...params }) {
    // settlementAsset ("eth"|"stable"): what the agreement is denominated in (legacy `asset: "eth"` means the same). payWith ("eth"|"stable"): what the buyer spends; omitted = try the same-kind route first, then the swap route.
    const settleKind = kindOf(settlementAsset ?? (bridgeAsset(asset) === "eth" ? "eth" : "stable"), "settlementAsset");
    const payKind = payWith === undefined || payWith === null || payWith === "" ? null : kindOf(payWith, "payWith");
    if (!Number.isInteger(mixedBufferBps) || mixedBufferBps < 0 || mixedBufferBps > 2000) bad("mixedBufferBps must be an integer from 0 to 2000.");
    const eth = settleKind === "eth"; // "eth": the agreement is funded in native ETH on the settlement chain
    const sc0 = bridgeChain(settlementChain);
    const oc0 = bridgeChain(sc0.key === "base" ? "robinhood" : "base");
    const sc = eth ? { ...sc0, symbol: "ETH", asset: "eth" } : sc0, oc = eth ? { ...oc0, symbol: "ETH", asset: "eth" } : oc0;
    const seller = sellerAddress || payee;
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(seller || ""))) bad("sellerAddress (the payee, on the settlement chain) must be a wallet address.");
    const buyer = this.address;
    if (low(seller) === low(buyer)) bad("the seller and the buyer must be different wallets.");
    if (!Number.isInteger(bufferBps) || bufferBps < 0 || bufferBps > 1000) bad("bufferBps must be an integer from 0 to 1000.");
    if (!dryRun && !conditions && template === "delivery_vs_payment") bad("delivery_vs_payment is a single-chain swap (Robinhood or Base) and is not supported by settleCrossChain. Use bull.open() on that chain, or a template such as arbiter_escrow, or pass conditions.");
    // Templates that need a third wallet fail HERE, before any balance read or bridge (also in dryRun): the default template is arbiter_escrow.
    if (!conditions && ["arbiter_escrow", "performance_bond", "milestones", "confirmed_with_cooling", "two_of_three"].includes(template)) {
      const ar = String(params.arbiter || "");
      if (!/^0x[0-9a-fA-F]{40}$/.test(ar) || low(ar) === ZERO) bad(`template "${template}" (the default is arbiter_escrow) needs { arbiter: "0xThirdWallet" } (a third wallet, not the buyer or the seller), or pass your own { conditions }. Nothing was bridged or sent.`);
      if (low(ar) === low(buyer) || low(ar) === low(seller)) bad("the arbiter must be a third wallet, not the buyer or the seller. Nothing was bridged or sent.");
    }
    const amountRaw = toRaw(amount, eth ? "eth" : "usdc_usdg");
    if (amountRaw <= 0n) bad("amount must be greater than 0.");
    let _px; const px = async () => (_px !== undefined ? _px : (_px = await ethSpot()));
    // Settlement-chain ETH reserve = max(minGasEth, protocol fee estimate x 1.1 + gas). The fee is 0.5% of the value (min $0.25, max $250) in native ETH, so a large agreement needs far more than minGasEth.
    // Without an ETH price the plain minGasEth stays (fail soft; the fee check then happens at the quote).
    let minSettleWei = parseEther(String(minGasEth)); const minOriginWei = parseEther(String(originGasEth));
    { const p0 = await px(); if (p0) { const usd = eth ? Number(amountRaw) / 1e18 * p0 : Number(amountRaw) / 1e6; const feeUsd = Math.min(250, Math.max(0.25, usd * 0.005)); const fw = BigInt(Math.ceil(feeUsd / p0 * 1e18 * 1.1)) + GAS_RESERVE_WEI; if (fw > minSettleWei) minSettleWei = fw; } }
    const inst = (key) => {
      if (key === this.chainName) return this;
      const c = clients[key];
      if (!c?.publicClient) bad(`pass clients.${key}.publicClient (and .walletClient to send) for ${BRIDGE[key].name}: the plan reads your balance there.`);
      if (!dryRun && !c.walletClient) bad(`pass clients.${key}.walletClient for ${BRIDGE[key].name}.`);
      return new Bull({ walletClient: c.walletClient || this.w, publicClient: c.publicClient, chain: key, baseUrl: this.base, relayApiKey: this.relayKey });
    };
    const S = inst(sc.key), O = inst(oc.key);
    if (!dryRun && (low(S.address) !== low(buyer) || low(O.address) !== low(buyer))) bad("the wallets on both chains must be the same account.");
    const readBal = async (who, c) => {
      let id; try { id = Number(await who.p.getChainId()); } catch { bad(`could not read the chain id of the ${c.name} publicClient.`); }
      if (id !== c.id) bad(`the ${c.name} publicClient is on chain ${id}, not ${c.id}.`);
      const [tok, ethBal] = await Promise.all([who.p.readContract({ address: c.token, abi: erc20Abi, functionName: "balanceOf", args: [buyer] }), who.p.getBalance({ address: buyer })]);
      return { tok: BigInt(tok), eth: BigInt(ethBal) };
    };
    const held = (b) => (eth ? b.eth : b.tok); // balance of the settlement asset
    const [s0, o0] = await Promise.all([readBal(S, sc), readBal(O, oc)]);
    const wantSame = !payKind || payKind === settleKind, wantMixed = !payKind || payKind !== settleKind;
    const need = eth ? amountRaw + minSettleWei : amountRaw; // ETH mode: the agreement locks the ETH and the buyer keeps the reserve for gas + protocol fee
    const sameKind = async () => {
      if (eth) {
        // ETH price only turns the Bull USD bridge caps (1 to 10000) into wei; needed only when a bridge is needed. Fails closed without it.
        let minBridgeWei = 0n, maxBridgeWei = 0n;
        if (amountRaw + minSettleWei > s0.eth) {
          const p = await px(); if (!p) bad("could not read the ETH/USD price to apply the 1 to 10000 USD bridge limits. Try again.");
          minBridgeWei = BigInt(Math.ceil(1 / p * 1e18 * 1.001)); maxBridgeWei = BigInt(Math.floor(10000 / p * 1e18 * 0.999));
        }
        return { ...decideCrossEth({ amountWei: amountRaw, sEth: s0.eth, oEth: o0.eth, sc, oc, minSettleWei, minOriginWei, bufferBps, minBridgeWei, maxBridgeWei }), route: "same-kind", originDec: 18, settleDec: 18 };
      }
      return { ...decideCross({ amountRaw, bal: { sTok: s0.tok, sEth: s0.eth, oTok: o0.tok, oEth: o0.eth }, sc, oc, minSettleWei, minOriginWei, bufferBps }), route: "same-kind", originDec: 6, settleDec: 6 };
    };
    let d, alternatives;
    let dSame = null;
    try { dSame = await sameKind(); } catch (e) { if (wantSame && !wantMixed) throw e; }
    if (dSame && !dSame.bridgeNeeded) d = dSame; // enough of the settlement asset on the settlement chain: nothing to bridge, whatever payWith says
    else {
      const cands = [];
      if (wantSame && dSame) cands.push(dSame);
      let priceErr = null;
      if (wantMixed) {
        const p = await px();
        if (!p) priceErr = new Error("could not read the ETH/USD price for a swap route (ETH <-> stable). Try again.");
        else cands.push(decideCrossMixed({ amountRaw, settleEth: eth, s: s0, o: o0, sc: sc0, oc: oc0, price: p, minSettleWei, minOriginWei, mixedBufferBps }));
      }
      if (!cands.length) throw priceErr || new Error("no route");
      d = cands.find((c) => c.feasible) || cands[0];
      if (cands.length > 1) alternatives = cands.filter((c) => c !== d).map((c) => ({ route: c.route, feasible: c.feasible, reason: c.reason, missing: c.missing }));
    }
    const mixedRoute = d.route === "mixed";
    const fmtU = (v, dd) => { const x = BigInt(v).toString().padStart(dd + 1, "0"); const f = x.slice(-dd).replace(/0+$/, ""); return x.slice(0, -dd) + (f ? "." + f : ""); };
    const f6 = (v) => fmtU(v, d.settleDec ?? (eth ? 18 : 6)); // settlement-asset units
    const fOrigin = (v) => fmtU(v, d.originDec ?? (eth ? 18 : 6)); // origin-asset units (the amount to bridge)
    const plan = {
      asset: eth ? "eth" : "usdc_usdg", settlementAsset: settleKind, payWith: mixedRoute ? (eth ? "stable" : "eth") : settleKind, route: d.route, bridgeNeeded: d.bridgeNeeded, feasible: d.feasible, reason: d.reason, settlementChain: sc.key, originChain: oc.key, amount: String(amount),
      gasReserveEth: ethStr(minSettleWei), shortfall: f6(d.shortfall), bridgeAmount: d.bridgeAmount === null ? null : fOrigin(d.bridgeAmount), missing: d.missing, ...(alternatives ? { alternatives } : {}),
      balances: { settlement: { chain: sc.key, token: fmtU(s0.tok, 6), eth: s0.eth.toString() + " wei" }, origin: { chain: oc.key, token: fmtU(o0.tok, 6), eth: o0.eth.toString() + " wei" } },
    };
    // Gas top-up hint: stablecoin is enough on the settlement chain but its ETH for gas / protocol fee is short. An ETH bridge (asset "eth") can fix that.
    if (!eth && !d.bridgeNeeded && s0.eth < minSettleWei) {
      const need = minSettleWei - s0.eth, top = ((need * BigInt(10000 + bufferBps) + 9999n) / 10000n / 10n ** 10n + 1n) * 10n ** 10n;
      plan.gasTopUp = { available: o0.eth >= top + minOriginWei, asset: "eth", fromChain: oc.key, toChain: sc.key, bridgeAmount: (() => { const x = top.toString().padStart(19, "0"); return (x.slice(0, -18) + "." + x.slice(-18)).replace(/0+$/, "").replace(/\.$/, ""); })(), note: `Short only on ETH gas on ${sc.name}. Bridge this small amount from ${oc.name} with bull.bridge.quote({ from: "${oc.key}", to: "${sc.key}", amount: "<bridgeAmount>", asset: "eth" }) then send + wait (the $1 minimum applies), and call settleCrossChain again.` };
    }
    if (dryRun) return { dryRun: true, ...plan };
    if (!d.feasible) {
      const e = new Error("Cross-chain settlement not started, nothing was sent. Missing: " + d.missing.map((m) => m.message).join(" "));
      e.stage = "plan"; e.missing = d.missing; e.plan = plan; throw e;
    }
    const stop = (stage, e, funds) => { const x = new Error(`Cross-chain settlement stopped at "${stage}": ${String(e?.shortMessage || e?.message || e).replace(/\.$/, "")}. ${funds}`); x.stage = stage; x.cause = e; return x; };
    let bridge = null;
    // No double bridge: a bridge this process already started for this buyer and route (or one the caller passes as pendingBridge, e.g. read back from its own storage) is checked FIRST.
    // Pending: wait for it. Confirmed: use the arrived funds. Failed / refunded: forget it and plan again. A new quote is only made when no earlier bridge is outstanding.
    const pkey = `${low(buyer)}|${oc.key}>${sc.key}|${settleKind}`;
    const pend = pendingBridge ? (typeof pendingBridge === "string" ? pendingBridge : pendingBridge.id) : PENDING_BRIDGES.get(pkey)?.id;
    let skipBridge = false;
    if (pend && d.bridgeNeeded) {
      let st;
      try { st = await O.bridge.status(pend); } catch (e) { const x = stop("bridge status", e, `An earlier bridge (id ${pend}) may still be in flight. Nothing new was sent. Check bridge.status("${pend}") before you retry.`); x.bridgeId = pend; throw x; }
      let waited = false;
      if (st.status === "pending") { try { await O.bridge.wait(pend, { timeoutMs: bridgeTimeoutMs }); waited = true; st = { status: "confirmed" }; } catch (e) { const x = stop("bridge wait", e, `Nothing new was sent. The earlier bridge (id ${pend}) pays or refunds only to your own address; check bridge.status("${pend}") before you retry.`); x.bridgeId = pend; throw x; } }
      if (st.status === "confirmed") {
        const until = Date.now() + (waited ? arrivalTimeoutMs : Math.min(arrivalTimeoutMs, 20000));
        let nw = await readBal(S, sc);
        while (held(nw) < need && Date.now() < until) { await new Promise((r) => setTimeout(r, 4000)); nw = await readBal(S, sc); }
        if (held(nw) >= need) {
          if (nw.eth < minSettleWei) throw stop("gas", new Error(`the buyer has too little ETH for gas and the protocol fee on ${sc.name}`), `Nothing is locked. Send a little ETH to ${sc.name} and call settleCrossChain again (it will then skip the bridge).`);
          skipBridge = true; bridge = { id: pend, amount: null, txHashes: [], resumed: true };
        }
      }
      if (!skipBridge) PENDING_BRIDGES.delete(pkey);
    }
    if (d.bridgeNeeded && !skipBridge) {
      const amt = fOrigin(d.bridgeAmount);
      let q;
      try {
        q = await O.bridge.quote({ from: oc.key, to: sc.key, amount: amt, user: buyer, ...(mixedRoute ? { fromAsset: eth ? "stable" : "eth", toAsset: settleKind } : { asset: eth ? "eth" : undefined }) });
        if (q.expectedOut !== null && q.expectedOut !== undefined && (eth ? parseEther(String(q.expectedOut)) : BigInt(Math.round(Number(q.expectedOut) * 1e6))) + held(s0) < need) bad(`the bridge quote returns about ${q.expectedOut} ${sc.symbol}, not enough for the shortfall of ${f6(d.shortfall)}. Retry with a larger bufferBps.`);
      } catch (e) { throw stop("bridge quote", e, "Nothing was sent. Your funds are untouched."); }
      let hashes;
      try { hashes = await O.bridge.send(q); }
      catch (e) { if (q.id) { PENDING_BRIDGES.set(pkey, { id: q.id, at: Date.now() }); try { onBridge?.({ id: q.id, key: pkey, stage: "send_failed" }); } catch {} } const x = stop("bridge send", e, `Your funds are with you on ${oc.name} unless a bridge transaction already went through: check your wallet history there before you retry${q.id ? ` (bridge id ${q.id}; passing it as pendingBridge makes the next call check it before quoting again)` : ""}. Nothing is locked.`); x.bridgeId = q.id || null; throw x; }
      bridge = { id: q.id || null, amount: amt, txHashes: hashes };
      if (q.id) { PENDING_BRIDGES.set(pkey, { id: q.id, at: Date.now() }); try { onBridge?.({ id: q.id, key: pkey, stage: "sent", txHashes: hashes, amount: amt, from: oc.key, to: sc.key }); } catch {} } // persist this id yourself: pass it back as pendingBridge after a crash
      try {
        if (q.id) await O.bridge.wait(q.id, { timeoutMs: bridgeTimeoutMs });
      } catch (e) { const x = stop("bridge wait", e, `Nothing is locked. The bridge pays or refunds only to your own address (id ${q.id}); check bridge.status(id) and your balances on both chains. Pass pendingBridge: "${q.id}" to continue without a second bridge.`); x.bridgeId = q.id || null; throw x; }
      const end = Date.now() + arrivalTimeoutMs;
      let now = await readBal(S, sc);
      while (held(now) < need && Date.now() < end) { await new Promise((r) => setTimeout(r, 4000)); now = await readBal(S, sc); }
      if (held(now) < need) throw stop("arrival", new Error(`only ${f6(held(now))} ${sc.symbol} is on ${sc.name}, the agreement needs ${f6(need)}${eth ? " (agreement plus the gas/fee reserve)" : ""}`), `Nothing is locked. Whatever arrived stays with you on ${sc.name}; top up the difference and call settleCrossChain again (it will then skip the bridge).`);
      if (now.eth < minSettleWei) throw stop("gas", new Error(`the buyer has too little ETH for gas and the protocol fee on ${sc.name}`), `Nothing is locked. Your ${sc.symbol} is with you on ${sc.name}; send a little ETH there and call settleCrossChain again (it will then skip the bridge).`);
    }
    let id;
    try {
      const extra = {}; if (terms !== undefined) extra.terms = terms; if (expiryHours !== undefined) extra.expiryHours = expiryHours;
      id = conditions ? await S.agree({ payee: seller, asset: sc.asset, amount: String(amount), conditions, ...extra }) : await S.deal(template, { ...params, ...extra, payee: seller, asset: sc.asset, amount: String(amount) });
    } catch (e) { throw stop("open agreement", e, `Your ${sc.symbol} is with you on ${sc.name}${bridge ? " (the bridge already arrived)" : ""}. If the error names a transaction hash, check it before you retry; otherwise nothing is locked.`); }
    return { id, settlementChain: sc.key, bridged: !!bridge, bridge, plan };
  }

  // ---- bull.settle: say WHAT (pay agent B 25 USD for X, released when Y), not HOW. EXPERIMENTAL, unaudited, third-party bridge, not tested live. ----
  /** bull.payoutPrefs.get(wallet) (verified yourself) / .message({chains,nonce,issuedAt}) / .set({chains}) (signs with this wallet; EOA only). Preferences are hints: a payer's resolver honours them when it can. */
  get payoutPrefs() {
    const self = this;
    return {
      message: ({ chains, nonce, issuedAt, address = self.address }) => payoutPrefsMessage(address, chains, nonce, issuedAt, 2),
      /** Returns { chains|null, verified, raw }. chains is null when there is none or the signature does not check out. */
      get: async (wallet) => {
        const r = await fetch(self.base + "/api/v1/agents/" + wallet + "/payout-prefs", { signal: AbortSignal.timeout(15000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw serr("prefs_unavailable", j?.error?.message || `Bull API ${r.status}`, "Try again.", r.status >= 500 || r.status === 429);
        const chains = await verifyPayoutPrefs(wallet, j);
        return { chains, verified: !!chains, raw: j };
      },
      /** await bull.payoutPrefs.set({ chains: [{ chain: "base", assets: ["stable"], priority: 1 }, { chain: "robinhood", assets: ["stable"], priority: 2 }] }) */
      set: async ({ chains }) => {
        const nonce = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""), issuedAt = Date.now();
        const message = payoutPrefsMessage(self.address, chains, nonce, issuedAt, 2); // v2: bound to the host
        const sig = await self.w.signMessage({ account: self.w.account, message });
        const r = await fetch(self.base + "/api/v1/agents/" + self.address + "/payout-prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ chains, nonce, issuedAt, sig }), signal: AbortSignal.timeout(15000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw serr(j?.error?.code || "prefs_rejected", j?.error?.message || `Bull API ${r.status}`, j?.error?.fix || "Check the chains and your clock.", !!j?.error?.retryable);
        return j;
      },
    };
  }

  /** One call, no chain thinking:
   *    const r = await bull.settle({ to: "0xSeller", amountUsd: 25, terms: "Deliver the report", template: "arbiter_escrow", arbiter: "0xArbiter",
   *      policy: { maxUsd: 50 }, clients: { base: { walletClient, publicClient } } });   // r.state is resumable; r.id is the agreement id when r.state.phase === "done"
   *    await bull.settle.resume(r.state, { clients });   // idempotent: re-reads the chain (bridge arrived? agreement already open?) and continues; never double-sends.
   *  Decides: seller's signed payout prefs > the chain where YOU already hold enough (no bridge) > cheapest bridge. The server only ADVISES: its plan is re-checked here against
   *  your request and policy, and the on-chain decision (balances) is made locally by the same code as settleCrossChain. Operator policy (per call, safe defaults):
   *  { maxUsd: 100, allowedChains: both, allowedAssets: ["stable"], allowBridge: true, requireDryRun: false }. requireDryRun: call once with dryRun: true, then pass approvedPlan: result.planDigest.
   *  Release condition: pass `template` (+ arbiter, terms, ...) or `conditions`. Single-agreement templates only. Errors are BullSettleError { code, message, fix, retryable } (+ .state to persist).
   *  Options: policy, dryRun, approvedPlan, preferredAsset, constraints { chain, payWith }, expiryHours, params, clients, onState(state) (called with a JSON copy after every step, before every send), minGasEth, bridgeTimeoutMs, arrivalTimeoutMs. */
  get settle() {
    const f = (o) => this.#settle(o);
    /** Continues a state from bull.settle. Safe to call any number of times, from any process that has the same wallet. */
    f.resume = (state, o = {}) => this.#settleResume(state, o);
    return f;
  }

  #settleInst(key, clients, needWallet) {
    if (key === this.chainName) return this;
    const c = clients?.[key];
    if (!c?.publicClient) throw serr("clients_missing", `Pass clients.${key}.publicClient${needWallet ? " and .walletClient" : ""} for ${BRIDGE[key].name}.`, "Same account on both chains.");
    if (needWallet && !c.walletClient) throw serr("clients_missing", `Pass clients.${key}.walletClient for ${BRIDGE[key].name}.`, "Same account on both chains.");
    return new Bull({ walletClient: c.walletClient || this.w, publicClient: c.publicClient, chain: key, baseUrl: this.base, relayApiKey: this.relayKey });
  }

  async #settle(o = {}) {
    try { return await this.#settleInner(o); } catch (e) { throw toSettleError(e); }
  }

  async #settleInner({ to, amountUsd, amount, asset, preferredAsset, constraints, terms, template, conditions, arbiter, expiryHours, params, policy, dryRun = false, approvedPlan, clients = {}, onState, minGasEth = "0.0003", ...opts } = {}) {
    // 1. validate what was asked (nothing here talks to a server)
    const me = this.address;
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(to || ""))) throw serr("bad_request", "to must be the wallet address of the agent to pay.", "Pass to: 0x….");
    if (low(to) === low(me)) throw serr("bad_request", "to must be another wallet than yours.", "A Bull agreement refuses a self-deal.");
    const hasUsd = amountUsd !== undefined && amountUsd !== null && amountUsd !== "", hasAmt = amount !== undefined && amount !== null && amount !== "";
    if (hasUsd === hasAmt) throw serr("bad_request", "Give exactly one of amountUsd, or amount together with asset.", 'Example: { amountUsd: 25 } or { amount: "0.01", asset: "eth" }.');
    if (hasUsd && !/^\d{1,9}(\.\d{1,6})?$/.test(String(amountUsd))) throw serr("bad_request", "amountUsd must be a positive number with at most 6 decimals.", "Example: amountUsd: 25.");
    const askKind = hasAmt ? (asset === undefined ? (() => { throw serr("bad_request", "amount needs asset (\"eth\" or \"stable\").", 'Example: { amount: "25", asset: "stable" }.'); })() : kindOf(asset, "asset")) : undefined;
    const pol = normalizeSettlePolicy(policy);
    if (hasUsd && Number(amountUsd) > pol.maxUsd + 1e-9) throw serr("policy_max_usd", `amountUsd ${amountUsd} is above policy.maxUsd of ${pol.maxUsd}.`, "Lower the amount or raise policy.maxUsd on purpose (operator decision).");
    if (askKind && !pol.allowedAssets.includes(askKind)) throw serr("policy_asset_not_allowed", `The request is in ${askKind}, which policy.allowedAssets does not allow.`, `Add "${askKind}" to policy.allowedAssets on purpose.`);
    if (terms !== undefined && (typeof terms !== "string" || terms.length > 960)) throw serr("bad_request", "terms must be a string of at most 960 characters (bull.settle adds a short settle:<id> tag).", "Shorten terms.");
    if (constraints?.payWith && !pol.allowedAssets.includes(kindOf(constraints.payWith, "constraints.payWith"))) throw serr("policy_asset_not_allowed", `constraints.payWith "${constraints.payWith}" is not in policy.allowedAssets.`, "Add it to policy.allowedAssets on purpose, or drop the constraint.");
    if (conditions !== undefined && template) throw serr("bad_request", "Pass template OR conditions, not both.", "Remove one.");
    if (template && ["delivery_vs_payment", "milestones", "recurring_payment", "split_payment"].includes(template)) throw serr("unsupported_template", `${template} is not supported by bull.settle (it opens several agreements or a single-chain swap).`, "Use a single-agreement template such as arbiter_escrow, optimistic or scheduled_payment, or conditions; or the dedicated function (bull.deal / bull.open).");
    if (!dryRun && !template && !conditions) throw serr("missing_release_condition", "How is the payment released? Neither template nor conditions was given.", 'Pass template: "arbiter_escrow" with arbiter, or conditions: [...] (see bull.agree).');
    if (pol.requireDryRun && !dryRun && !approvedPlan) throw serr("dry_run_required", "policy.requireDryRun is true: a dry run must come first.", "Call bull.settle({ ..., dryRun: true }), review it, then call again with approvedPlan: result.planDigest.");
    const price = (askKind === "eth" || pol.allowedAssets.includes("eth")) ? await ethSpot() : null;

    // 2. ask the server for the plan (an adviser), then re-check it here against the request and the policy
    let plan;
    try {
      const body = { buyer: me, seller: to, ...(hasUsd ? { amountUsd: String(amountUsd) } : { amount: String(amount), asset: askKind }), preferredAsset, constraints, policy: pol, template, arbiter, terms };
      const r = await fetch(this.base + "/api/v1/settle-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw serr(j?.error?.code || "plan_unavailable", j?.error?.message || `Bull API ${r.status}`, j?.error?.fix || "Try again.", j?.error?.retryable ?? r.status >= 500);
      plan = j;
    } catch (e) { throw e instanceof BullSettleError ? e : serr("plan_unavailable", "Could not reach the Bull settle-plan API: " + (e?.message || e), "Try again.", true); }
    const prefs = plan.sellerPrefs ? await verifyPayoutPrefs(to, { address: to, isDefault: false, chains: plan.sellerPrefs.chains, signed: plan.sellerPrefs }) : null; // the seller's own signed word, never the server's claim
    const signedPayees = {}; for (const c of prefs || []) if (c.address) signedPayees[c.chain] = low(c.address);
    const chk = verifySettlePlan(plan, { buyer: me, seller: to, amountUsd: hasUsd ? amountUsd : undefined, amount: hasAmt ? String(amount) : undefined, asset: askKind, policy: pol, price, signedPayees, constraints });
    if (chk.payeeMode === "same_address") await verifyPayeePortable(to, (key, addr) => this.#settleInst(key, clients, false).p.getCode({ address: addr })); // fail closed: needs publicClients for both chains
    if (plan.source === "seller_prefs") {
      if (!prefs || !prefs.some((c) => c.chain === chk.chain && c.assets.includes(chk.kind))) throw serr("prefs_signature_invalid", "The plan claims a seller preference that the seller's signature does not prove.", "Do not use this plan. Retry, or set constraints.chain.");
    }

    // 3. decide the on-chain part LOCALLY from your own balances (same code as settleCrossChain), then apply the policy to it
    const dec = await this.settleCrossChain({ settlementChain: chk.chain, settlementAsset: chk.kind, payWith: constraints?.payWith, sellerAddress: to, amount: chk.amount, template: template || "arbiter_escrow", dryRun: true, clients, minGasEth });
    if (dec.bridgeNeeded && !pol.allowBridge) throw serr("policy_bridge_not_allowed", "Your balances need a bridge but policy.allowBridge is false.", "Fund the buyer on the settlement chain, or set policy.allowBridge true on purpose.");
    let bridgeUsd = 0;
    if (dec.bridgeNeeded) {
      const originKind = dec.route === "mixed" ? dec.payWith : chk.kind;
      if (!pol.allowedAssets.includes(originKind)) throw serr("policy_asset_not_allowed", `The bridge would spend ${originKind} on the origin chain, which policy.allowedAssets does not allow.`, `Add "${originKind}" to policy.allowedAssets on purpose, or fund the buyer on the settlement chain.`);
      if (dec.route === "mixed" && pol.maxBridgeFeeBps < MIXED_WORST_BPS) throw serr("policy_bridge_fee_too_high", `The swap route may lose up to ${MIXED_WORST_BPS / 100}%; policy.maxBridgeFeeBps is ${pol.maxBridgeFeeBps}.`, "Raise policy.maxBridgeFeeBps on purpose or fund the buyer on the settlement chain.");
      if (originKind === "eth" && !(price > 0)) throw serr("price_unavailable", "Could not read the ETH/USD price to apply maxUsd to the bridge amount.", "Try again.", true);
      bridgeUsd = originKind === "eth" ? Number(dec.bridgeAmount) * price : Number(dec.bridgeAmount);
      if (bridgeUsd > pol.maxUsd + 1e-6) throw serr("policy_max_usd", `The bridge amount is about $${bridgeUsd.toFixed(2)} (shortfall plus buffer), above policy.maxUsd of $${pol.maxUsd}.`, "Raise policy.maxUsd on purpose: a bridge needs the amount plus a buffer.");
    }
    if (plan.bridge !== "none" || dec.bridgeNeeded) await this.#needlessBridgeCheck({ chk, dec, pol, constraints, preferredAsset, prefs, signedPayees, to, price, clients, minGasEth, planBridges: plan.bridge !== "none" });
    if (!dec.feasible) throw serr("insufficient_funds", "The buyer cannot fund this payment right now: " + dec.missing.map((m) => m.message).join(" "), dec.missing[0]?.message || "Fund the buyer wallet.", false, { missing: dec.missing, plan: dec });
    const planDigest = keccak256(toHex(JSON.stringify({ v: 1, buyer: low(me), seller: low(to), payee: chk.payee, chain: chk.chain, asset: chk.kind, amount: chk.amount, bridge: dec.bridgeNeeded ? { route: dec.route, from: dec.originChain, amount: dec.bridgeAmount } : null, maxUsd: pol.maxUsd })));
    const summary = { settlementChain: chk.chain, settlementAsset: chk.kind, amount: chk.amount, amountUsd: Math.round(chk.usd * 100) / 100, bridge: dec.bridgeNeeded ? { route: dec.route, fromChain: dec.originChain, amount: dec.bridgeAmount, amountUsd: Math.round(bridgeUsd * 100) / 100 } : "none", source: plan.source, why: plan.why, risks: plan.risks, estimatedFeesUsd: plan.estimatedFeesUsd };
    const eth = chk.kind === "eth", sc = bridgeChain(chk.chain);
    const state = {
      v: 1, id: Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join(""), createdAt: Date.now(), updatedAt: Date.now(), phase: "planned",
      buyer: low(me), seller: chk.payee, sellerIdentity: low(to), payeeMode: chk.payeeMode, chain: chk.chain, settleKind: chk.kind, assetName: eth ? "eth" : sc.asset, amount: chk.amount, amountUsd: summary.amountUsd,
      needRaw: (eth ? toRaw(chk.amount, "eth") + parseEther(String(minGasEth)) : toRaw(chk.amount, "usdc_usdg")).toString(), minGasWei: parseEther(String(minGasEth)).toString(),
      planDigest, policy: pol, plan: summary, expiresAt: Date.now() + STATE_TTL_MS, executable: !dryRun,
      request: { template, conditions, terms, arbiter, expiryHours, params, constraints: constraints || null },
      bridge: dec.bridgeNeeded ? { needed: true, route: dec.route, originChain: dec.originChain, amount: dec.bridgeAmount, fromAsset: dec.route === "mixed" ? dec.payWith : chk.kind, toAsset: chk.kind, quoteId: null, txHashes: [], amountUsd: Math.round(bridgeUsd * 100) / 100 } : { needed: false },
      agreement: null, history: [{ at: Date.now(), phase: "planned", note: summary.bridge === "none" ? "planned without a bridge" : "planned with a bridge" }],
    };
    state.stateMac = await this.w.signMessage({ account: this.w.account, message: settleStateMessage(state) });
    if (dryRun) return { dryRun: true, plan: summary, planDigest, decision: dec, state, note: "Nothing was sent. With policy.requireDryRun pass approvedPlan: planDigest to execute. The state is only a plan: bull.settle.resume(state) would execute it." };
    if (pol.requireDryRun && approvedPlan !== planDigest) throw serr(approvedPlan ? "plan_changed" : "dry_run_required", approvedPlan ? "The plan changed since the dry run (balances, route or amount differ)." : "policy.requireDryRun is true: a dry run must come first.", "Run bull.settle({ ..., dryRun: true }) again, review it, then pass approvedPlan: result.planDigest.");
    if (onState) await onState(JSON.parse(JSON.stringify(state)));
    return this.#settleRun(state, { clients, onState, ...opts });
  }

  /** Runs the SDK's own balance decision for EVERY policy-allowed (chain, asset) and rejects a bridging plan when the best allowed route needs no bridge (the server is an adviser, not an authority). Fails closed when a chain cannot be evaluated. */
  async #needlessBridgeCheck({ chk, dec, pol, constraints, preferredAsset, prefs, signedPayees, to, price, clients, minGasEth, planBridges }) {
    const local = { [`${chk.chain}/${chk.kind}`]: { eligible: true, feasible: !!dec.feasible, bridgeNeeded: !!dec.bridgeNeeded, originKind: dec.route === "mixed" ? dec.payWith : chk.kind, bridgeUsd: dec.bridgeNeeded ? (((dec.route === "mixed" ? dec.payWith : chk.kind) === "eth") ? Number(dec.bridgeAmount) * price : Number(dec.bridgeAmount)) : 0 } };
    let portable = null;
    const isPortable = async () => (portable ??= verifyPayeePortable(to, (key, addr) => this.#settleInst(key, clients, false).p.getCode({ address: addr })).then(() => true, () => false));
    const fmtAmt = (kind) => kind === "stable" ? (Math.ceil(chk.usd * 1e6) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") : (Math.ceil((chk.usd / price) * 1e8) / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    for (const chain of ["robinhood", "base"]) for (const kind of ["stable", "eth"]) {
      if (local[`${chain}/${kind}`] || !pol.allowedChains.includes(chain) || !pol.allowedAssets.includes(kind) || (constraints?.chain && constraints.chain !== chain)) continue;
      if (kind === "eth" && !(price > 0)) continue;
      const payee = signedPayees?.[chain] || null;
      if (!payee && !(await isPortable())) { local[`${chain}/${kind}`] = { eligible: false }; continue; }
      let d; try { d = await this.settleCrossChain({ settlementChain: chain, settlementAsset: kind, payWith: constraints?.payWith, sellerAddress: payee || to, amount: fmtAmt(kind), template: "arbiter_escrow", dryRun: true, clients, minGasEth }); }
      catch (e) { throw serr("local_check_failed", "Could not evaluate every allowed chain locally, so a needless bridge cannot be ruled out: " + String(e?.shortMessage || e?.message || e).slice(0, 200), "Pass clients (publicClient) for both chains and retry.", true); }
      const originKind = d.route === "mixed" ? d.payWith : kind;
      local[`${chain}/${kind}`] = { eligible: true, feasible: !!d.feasible, bridgeNeeded: !!d.bridgeNeeded, originKind, bridgeUsd: d.bridgeNeeded ? (originKind === "eth" ? Number(d.bridgeAmount) * price : Number(d.bridgeAmount)) : 0 };
    }
    rejectNeedlessBridge({ planBridges, expected: expectedSettlePick({ prefs, policy: pol, constraints, preferredAsset: preferredAsset ? kindOf(preferredAsset, "preferredAsset") : null, local }) });
  }

  async #settleResume(state, o = {}) {
    try {
      if (!state || state.v !== 1) throw serr("bad_state", "That is not a bull.settle state.", "Pass the state object that bull.settle returned (or err.state).");
      if (low(state.buyer) !== low(this.address)) throw serr("wrong_wallet", "This state belongs to another wallet.", "Resume with the wallet that started it.");
      state.policy = await verifySettleState(state, { approvedPlan: o.approvedPlan });
      if (state.executable === false) state.executable = true; // approvedPlan matched the digest
      return await this.#settleRun(JSON.parse(JSON.stringify(state)), o);
    } catch (e) { throw toSettleError(e); }
  }

  async #settleRun(state, o = {}) {
    const { clients = {}, onState, ...rest } = o;
    if (state.phase === "done") return { id: state.agreement?.id ?? null, settlementChain: state.chain, bridged: !!state.bridge?.quoteId, state };
    const S = this.#settleInst(state.chain, clients, true);
    const O = state.bridge?.needed ? this.#settleInst(state.bridge.originChain, clients, true) : null;
    if (low(S.address) !== low(state.buyer) || (O && low(O.address) !== low(state.buyer))) throw serr("wrong_wallet", "The wallets on both chains must be the buyer's account.", "Use the same account on both chains.");
    const sc = bridgeChain(state.chain), eth = state.settleKind === "eth";
    const io = {
      now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), save: onState,
      readSettle: async () => {
        const id = Number(await S.p.getChainId()); if (id !== sc.id) bad(`the ${sc.name} publicClient is on chain ${id}, not ${sc.id}.`);
        const [tok, e] = await Promise.all([S.p.readContract({ address: sc.token, abi: erc20Abi, functionName: "balanceOf", args: [state.buyer] }), S.p.getBalance({ address: state.buyer })]);
        return { tok: BigInt(tok), eth: BigInt(e) };
      },
      nonces: async (key) => { const w = key === state.chain ? S : O; const [latest, pending] = await Promise.all([w.p.getTransactionCount({ address: state.buyer, blockTag: "latest" }), w.p.getTransactionCount({ address: state.buyer, blockTag: "pending" })]); return { latest: Number(latest), pending: Number(pending) }; },
      bridgeStatus: async (id) => { try { return await O.bridge.status(id); } catch { return { status: "unknown" }; } },
      quoteBridge: async (st) => {
        const b = st.bridge, mixed = b.route === "mixed";
        const q = await O.bridge.quote({ from: b.originChain, to: st.chain, amount: b.amount, user: st.buyer, ...(mixed ? { fromAsset: b.fromAsset, toAsset: b.toAsset } : { asset: eth ? "eth" : undefined }) });
        if (q.expectedOut !== null && q.expectedOut !== undefined) {
          const out = eth ? parseEther(String(q.expectedOut)) : BigInt(Math.round(Number(q.expectedOut) * 1e6));
          const have = await io.readSettle(), held = eth ? have.eth : have.tok;
          if (out + held < BigInt(st.needRaw)) bad(`the bridge quote returns about ${q.expectedOut}, not enough for the amount.`);
          const maxFee = Number(st.policy?.maxBridgeFeeBps ?? SAME_KIND_WORST_BPS);
          if (b.route !== "mixed" && Number(q.expectedOut) < Number(b.amount) * (1 - maxFee / 10000)) bad(`the bridge quote returns ${q.expectedOut} for ${b.amount}, a loss above policy.maxBridgeFeeBps (${maxFee}).`);
        }
        return q;
      },
      sendBridge: (q) => O.bridge.send(q),
      maxAgreementId: async () => { const j = await S.#call(`/api/v1/agreements?payer=${state.buyer}&status=all&limit=50`); if (!Array.isArray(j?.agreements)) throw new Error("the agreements feed did not return a list"); return j.agreements.reduce((m, a) => Math.max(m, Number(a.id) || 0), 0); },
      // Adoption: only an agreement newer than the baseline, from this buyer to this payee, whose ON-CHAIN terms hash is the settle:<id> tag of THIS state. The machine then verifies payer/amount/asset/status/conditions.
      findAgreement: async (st) => {
        const j = await S.#call(`/api/v1/agreements?payer=${st.buyer}&payee=${st.seller}&status=all&limit=50`);
        if (!Array.isArray(j?.agreements)) throw new Error("the agreements feed did not return a list");
        for (const c of j.agreements.filter((a) => Number(a.id) > Number(st.agreement.baselineId)).slice(0, 10)) {
          const a = await io.getAgreement(c.id, st);
          if (a && a.termsHash && low(a.termsHash) === low(settleTermsHash(st)) && low(a.payer) === st.buyer && low(a.payee) === st.seller) return { id: c.id };
        }
        return null;
      },
      payeeCodes: async () => { const o = {}; for (const key of ["base", "robinhood"]) o[key] = codeKind(await this.#settleInst(key, clients, false).p.getCode({ address: state.seller })); return o; },
      // Everything is read from the chain through Bull's agreement endpoint; the machine compares each field with what was planned.
      getAgreement: async (id, st = state) => {
        const a = await S.agreement(id); if (!a) return null;
        const r = st.request || {}, conds = Array.isArray(a.conditions) ? a.conditions : [];
        return {
          id: a.id, payee: a.payee, payer: a.payer, amount: a.amount, status: a.status, termsHash: a.termsHash,
          assetOk: (eth ? low(a.asset) === "eth" : (a.assetVerified === true && low(a.symbol) === st.assetName)) && low(a.contract || a.agreement || "") === low(S.cfg.agreement), // the right asset, on THIS chain's current Bull agreement contract
          conditionsOk: conds.length > 0 && (!Array.isArray(r.conditions) || conds.length === r.conditions.length),
        };
      },
      openAgreement: async (st) => {
        const r = st.request || {}, extra = { terms: settleTermsText(st) }; // always carries the settle:<id> tag (see findAgreement)
        if (r.expiryHours !== undefined) extra.expiryHours = r.expiryHours;
        return r.conditions ? S.agree({ payee: st.seller, asset: st.assetName, amount: st.amount, conditions: r.conditions, ...extra }) : S.deal(r.template, { ...(r.params || {}), ...(r.arbiter ? { arbiter: r.arbiter } : {}), ...extra, payee: st.seller, asset: st.assetName, amount: st.amount });
      },
    };
    const out = await runSettleMachine(state, io, rest);
    return { id: out.agreement?.id ?? null, settlementChain: out.chain, bridged: !!(out.bridge?.needed && out.bridge?.quoteId), state: out };
  }
}
