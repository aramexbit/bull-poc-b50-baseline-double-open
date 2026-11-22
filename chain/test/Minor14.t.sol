// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Mocks.sol";

// MINOR 14-A — Team A.
//  - K-3676 (M-1326): confirmed_with_cooling kind-9 value=3599 (floor-1) —
//    contract accepts sub-floor values; the SDK is the guard (node refuses).
//  - K-3674 (M-1324): panel [V1,V2,V3]/k=3 — all voters keyless; release
//    blocked, votes by non-voters fail.
//  - K-3658 (M-1308): token_price_trigger kind-1 attest-by-payee (B-15 shape,
//    price=500 re-grade).
//  - K-3664 (M-1314): arbiter_escrow expiry now+24h — refund at +25h returns
//    the payer whole.
//  - K-3675 (M-1325): after_deal kind-4 target=live escrow v3, dealId=0 —
//    release blocked (no such deal).
//  - K-3677 (M-1327): confirmed_with_cooling kind-9 value=7200 vs
//    windowHours=1 — contract honors 7200s (blocked +1h, release after 2h).
//  - WATCH re-probes: 0x2591a130 returns 0; claimTo 2-arg reverts.
// Throwaway local keys only. No mainnet, no live calls.

contract Minor14Test is Test {
    address constant AGMT_V41 = 0x7AB58fAAe65eFCF0037635382cAA546EaC233DA6;
    address constant ESCROW_V3 = 0xd961cA37e339E14e0D3478383a252E218fe7aa4a;

    uint256 constant PAYER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant PAYEE_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 constant ARB_PK = 0x47e179ec1974f892c2cd3b0cf1a4ec6a36e72a0a0d26ccaa2aa5c8ad6b9b47a8;
    address payer; address payee; address arbiter; address stranger;
    MockERC20 token;

    bytes4 constant SEL_RELEASE = 0x37bdc99b;
    bytes4 constant SEL_REFUND = 0x278ecde1;

    struct Cond { uint8 kind; address target; bytes data; uint256 value; }
    struct Params { address payee; address asset; uint256 amount; uint64 expiry; bytes32 termsHash; Cond[] conditions; }
    struct Quote { uint256 feeWei; uint64 expiry; bytes sig; }

    function setUp() public {
        vm.chainId(4663);
        payer = vm.addr(PAYER_PK);
        payee = vm.addr(PAYEE_PK);
        arbiter = vm.addr(ARB_PK);
        stranger = vm.addr(0x9999);
        vm.etch(AGMT_V41, vm.parseBytes(vm.readFile("bytecode/agreement-v41-zerofee.hex")));
        vm.etch(ESCROW_V3, vm.parseBytes(vm.readFile("bytecode/escrow-v3.hex")));
        vm.store(AGMT_V41, bytes32(uint256(0)), bytes32(uint256(1)));
        vm.store(AGMT_V41, bytes32(uint256(11)), bytes32(uint256(1)));
        vm.store(ESCROW_V3, bytes32(uint256(5)), bytes32(uint256(1)));
        token = new MockERC20();
        token.mint(payer, 10000000 ether);
        token.mint(AGMT_V41, 100000 ether);
        vm.deal(payer, 100 ether);
        vm.deal(payee, 10 ether);
        vm.deal(arbiter, 10 ether);
        vm.deal(stranger, 10 ether);
        vm.warp(1000);
    }

    function _callAs(address who, address to, bytes memory data) internal returns (bool ok, bytes memory ret) {
        vm.prank(who);
        (ok, ret) = to.call(data);
    }
    function _create(address a, address payee_, uint256 amount, Cond[] memory conds, uint256 expiry, uint256 feeWei, bytes32 termsHash) internal returns (bool ok, bytes memory ret) {
        Params memory p = Params({ payee: payee_, asset: address(token), amount: amount, expiry: uint64(expiry), termsHash: termsHash, conditions: conds });
        Quote memory q = Quote({ feeWei: feeWei, expiry: uint64(block.timestamp + 3600), sig: new bytes(65) });
        vm.prank(payer);
        token.approve(a, type(uint256).max);
        vm.prank(payer);
        (ok, ret) = a.call{ value: feeWei }(abi.encodeWithSignature(
            "createAgreement((address,address,uint256,uint64,bytes32,(uint8,address,bytes,uint256)[]),(uint256,uint64,bytes))", p, q));
    }
    function _coolingConds(uint256 cooling, uint256 dataVal) internal view returns (Cond[] memory conds) {
        conds = new Cond[](2);
        conds[0] = Cond({ kind: 1, target: arbiter, data: "", value: 0 });
        conds[1] = Cond({ kind: 9, target: payer, data: abi.encode(uint256(dataVal)), value: cooling });
    }
    function _panelConds(address[] memory voters, uint256 k) internal pure returns (Cond[] memory conds) {
        conds = new Cond[](1);
        conds[0] = Cond({ kind: 6, target: address(0), data: abi.encode(voters), value: k });
    }
    function _afterDealConds(address target, uint256 dealId) internal pure returns (Cond[] memory conds) {
        conds = new Cond[](1);
        conds[0] = Cond({ kind: 4, target: target, data: "", value: dealId });
    }

    // WATCH re-probe: 0x2591a130(1,0) returns 0.
    function testWatch2591ReturnsZero() public {
        (bool ok, bytes memory ret) = AGMT_V41.staticcall(abi.encodeWithSelector(bytes4(0x2591a130), uint256(1), uint256(0)));
        assertTrue(ok, "staticcall must not revert");
        assertEq(abi.decode(ret, (uint256)), 0, "0x2591a130(1,0) == 0");
    }

    // WATCH re-probe: claimTo 2-arg reverts (dormant).
    function testWatchClaimTo2ArgReverts() public {
        (bool ok,) = AGMT_V41.call(abi.encodeWithSignature("claimTo(uint256,address)", 1, address(0x1234)));
        assertFalse(ok, "claimTo 2-arg must revert");
    }

    // K-3676 (M-1326): cooling value=3599 (floor-1). The CONTRACT itself
    // rejects sub-floor values at creation (BadInput) — the floor is
    // enforced on-chain as well as by the SDK; node run decides the
    // verdict (KILL).
    function testK3676Cooling3599() public {
        (bool ok,) = _create(AGMT_V41, payee, 500 ether, _coolingConds(3599, 0), block.timestamp + 72 hours, 0, bytes32(uint256(501)));
        assertFalse(ok, "creation with kind-9 value=3599 must revert (floor 3600 enforced on-chain)");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }

    // K-3674 (M-1324): panel [V1,V2,V3]/k=3 — all three voters keyless.
    function testK3674PanelK3Keyless() public {
        address[] memory voters = new address[](3);
        voters[0] = address(0x1111111111111111111111111111111111111111);
        voters[1] = address(0x2222222222222222222222222222222222222222);
        voters[2] = address(0x3333333333333333333333333333333333333333);
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _panelConds(voters, 3), block.timestamp + 72 hours, 0, bytes32(uint256(502)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool relNoVote,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertFalse(relNoVote, "release without any vote must be blocked");
        (bool vBad,) = _callAs(payee, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        assertFalse(vBad, "vote by a non-voter must fail");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }

    // K-3658 (M-1308): token_price_trigger kind-1 attest-by-payee (B-15 shape).
    function testK3658TokenPriceTriggerPayeeAttest() public {
        Cond[] memory conds = new Cond[](1);
        conds[0] = Cond({ kind: 1, target: payee, data: "", value: 0 });
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, conds, block.timestamp + 72 hours, 0, bytes32(uint256(503)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool att,) = _callAs(payee, AGMT_V41, abi.encodeWithSignature("attest(uint256,uint256)", id, uint256(0)));
        assertTrue(att, "payee self-attest must succeed");
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertTrue(rel, "release must succeed");
        assertEq(token.balanceOf(payee), 500 ether, "payee gains 500");
    }

    // K-3664 (M-1314): arbiter_escrow expiry now+24h — refund at +25h
    // returns the payer whole.
    function testK3664ArbiterEscrowRefund24h() public {
        Cond[] memory conds = new Cond[](1);
        conds[0] = Cond({ kind: 1, target: arbiter, data: "", value: 0 });
        uint256 payerBefore = token.balanceOf(payer);
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, conds, block.timestamp + 24 hours, 0, bytes32(uint256(504)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        assertEq(token.balanceOf(payer), payerBefore - 500 ether, "payer funded 500");
        vm.warp(block.timestamp + 25 hours);
        (bool ref,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_REFUND, id));
        assertTrue(ref, "refund after expiry must succeed");
        assertEq(token.balanceOf(payer), payerBefore, "payer refunded whole");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }

    // K-3675 (M-1325): after_deal kind-4 target=live escrow v3, dealId=0.
    function testK3675AfterDealEscrowV3Deal0() public {
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _afterDealConds(ESCROW_V3, 0), block.timestamp + 72 hours, 0, bytes32(uint256(505)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertFalse(rel, "release must be blocked: no deal 0 in escrow v3");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }

    // K-3677 (M-1327): cooling value=7200 vs windowHours=1 — contract
    // honors 7200s (blocked +1h, release after 2h +500); the SDK is the
    // guard that refuses the window/value mismatch.
    function testK3677Cooling7200Window1h() public {
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _coolingConds(7200, 0), block.timestamp + 72 hours, 0, bytes32(uint256(506)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool att,) = _callAs(arbiter, AGMT_V41, abi.encodeWithSignature("attest(uint256,uint256)", id, uint256(0)));
        assertTrue(att, "arbiter attest must succeed");
        vm.warp(block.timestamp + 3601);
        (bool relEarly,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertFalse(relEarly, "release must be blocked at +1h (cooling 2h)");
        vm.warp(block.timestamp + 7201 - 3601);
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertTrue(rel, "release must succeed after 2h cooling");
        assertEq(token.balanceOf(payee), 500 ether, "payee gains 500");
    }
}
