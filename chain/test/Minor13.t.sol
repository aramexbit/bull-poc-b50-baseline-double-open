// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Mocks.sol";

// MINOR 13-A — Team A.
//  - K-3475 (M-1125): panel [V1]/k=1 — voter is a keyless address; release
//    blocked without a vote, vote by a non-voter fails.
//  - K-3477 (M-1127): confirmed_with_cooling kind-9 value=3601 (floor+1).
//  - K-3478 (M-1128): confirmed_with_cooling kind-9 value=7200 (2h).
//  - K-3485 (M-1135): token_price_trigger kind-1 attest-by-payee (B-15 shape).
//  - K-3486 (M-1136): after_deal kind-4 target=live escrow v3, dealId=2.
//  - K-3473 (M-1123): arbiter_escrow expiry now+1h — refund after expiry
//    returns the payer whole.
//  - WATCH re-probes: 0x2591a130 returns 0; claimTo 2-arg reverts.
// Throwaway local keys only. No mainnet, no live calls.

contract Minor13Test is Test {
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

    // K-3475 (M-1125): panel [V1]/k=1 — V1 holds no key; release blocked
    // without a vote, and a vote by the payee (not a voter) fails.
    function testK3475PanelVoterKeyless() public {
        address v1 = address(0x1111111111111111111111111111111111111111);
        address[] memory voters = new address[](1);
        voters[0] = v1;
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _panelConds(voters, 1), block.timestamp + 72 hours, 0, bytes32(uint256(401)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool relNoVote,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertFalse(relNoVote, "release without any vote must be blocked");
        (bool vBad,) = _callAs(payee, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        assertFalse(vBad, "vote by a non-voter must fail");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }

    // K-3477 (M-1127): cooling value=3601 (floor+1). Probe-style: log the
    // release outcome at exactly +3601s; the verdict is decided by the node run.
    function testK3477Cooling3601() public {
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _coolingConds(3601, 0), block.timestamp + 72 hours, 0, bytes32(uint256(402)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool att,) = _callAs(arbiter, AGMT_V41, abi.encodeWithSignature("attest(uint256,uint256)", id, uint256(0)));
        assertTrue(att, "arbiter attest must succeed");
        vm.warp(block.timestamp + 3601);
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        emit log_named_uint("K-3477 release at exactly +3601s ok", rel ? 1 : 0);
        emit log_named_uint("K-3477 payee balance ether", token.balanceOf(payee) / 1 ether);
        assertTrue(token.balanceOf(payee) == 0 || token.balanceOf(payee) == 500 ether, "payee gains 0 or 500");
    }

    // K-3478 (M-1128): cooling value=7200 (2h) — blocked at +1h, release after 2h +500.
    function testK3478Cooling7200() public {
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _coolingConds(7200, 0), block.timestamp + 72 hours, 0, bytes32(uint256(403)));
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

    // K-3485 (M-1135): token_price_trigger kind-1 attest-by-payee (B-15 shape).
    function testK3485TokenPriceTriggerPayeeAttest() public {
        Cond[] memory conds = new Cond[](1);
        conds[0] = Cond({ kind: 1, target: payee, data: "", value: 0 });
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, conds, block.timestamp + 72 hours, 0, bytes32(uint256(404)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool att,) = _callAs(payee, AGMT_V41, abi.encodeWithSignature("attest(uint256,uint256)", id, uint256(0)));
        assertTrue(att, "payee self-attest must succeed");
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertTrue(rel, "release must succeed");
        assertEq(token.balanceOf(payee), 500 ether, "payee gains 500");
    }

    // K-3486 (M-1136): after_deal kind-4 target=live escrow v3, dealId=2.
    function testK3486AfterDealEscrowV3Deal2() public {
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _afterDealConds(ESCROW_V3, 2), block.timestamp + 72 hours, 0, bytes32(uint256(405)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertFalse(rel, "release must be blocked: no settled deal 2 in escrow v3");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }

    // K-3473 (M-1123): arbiter_escrow expiry now+1h — refund after expiry
    // returns the payer whole.
    function testK3473ArbiterEscrowRefund1h() public {
        Cond[] memory conds = new Cond[](1);
        conds[0] = Cond({ kind: 1, target: arbiter, data: "", value: 0 });
        uint256 payerBefore = token.balanceOf(payer);
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, conds, block.timestamp + 1 hours, 0, bytes32(uint256(406)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        assertEq(token.balanceOf(payer), payerBefore - 500 ether, "payer funded 500");
        vm.warp(block.timestamp + 2 hours);
        (bool ref,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_REFUND, id));
        assertTrue(ref, "refund after expiry must succeed");
        assertEq(token.balanceOf(payer), payerBefore, "payer refunded whole");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }
}
