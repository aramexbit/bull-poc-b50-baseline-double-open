// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Mocks.sol";

// ROUND 33-A — Team A.
//  - K-3382 (M-1032): panel [payer]/k=1 — voter is the payer himself.
//  - K-3383 (M-1033): two_of_three [payee,stranger]/k=2 — two attacker wallets.
//  - K-3385 (M-1035): confirmed_with_cooling kind-9 value=3599 (floor-1).
//  - K-3386 (M-1036): confirmed_with_cooling kind-9 value=86400 (24h vs 720h asked).
//  - K-3392 (M-1042): after_deal kind-4 target=live escrow v3, dealId=1.
//  - K-3402 (M-1052): scheduled_payment expiry == unlock (B-38 boundary probe).
//  - K-3411 (M-1061): panel [payee]/k=1, payee=stranger (voter != payee).
//  - WATCH re-probes: 0x2591a130 returns 0; claimTo 2-arg reverts.
// Throwaway local keys only. No mainnet, no live calls.

contract Round33Test is Test {
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
    function _timeConds(uint256 value) internal pure returns (Cond[] memory conds) {
        conds = new Cond[](1);
        conds[0] = Cond({ kind: 0, target: address(0), data: "", value: value });
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

    // K-3382 (M-1032): panel [payer]/k=1 — the payer himself is the sole voter.
    function testK3382PanelVoterPayer() public {
        address[] memory voters = new address[](1);
        voters[0] = payer;
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _panelConds(voters, 1), block.timestamp + 72 hours, 0, bytes32(uint256(301)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool v,) = _callAs(payer, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        assertTrue(v, "payer vote must succeed");
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertTrue(rel, "release must succeed");
        assertEq(token.balanceOf(payee), 500 ether, "payee gains 500");
    }

    // K-3383 (M-1033): two_of_three [payee,stranger]/k=2 — two attacker wallets.
    function testK3383TwoOfThreeAS() public {
        address[] memory voters = new address[](2);
        voters[0] = payee; voters[1] = stranger;
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _panelConds(voters, 2), block.timestamp + 72 hours, 0, bytes32(uint256(302)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool v1,) = _callAs(payee, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        (bool v2,) = _callAs(stranger, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        assertTrue(v1, "payee vote must succeed");
        assertTrue(v2, "stranger vote must succeed");
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertTrue(rel, "release must succeed");
        assertEq(token.balanceOf(payee), 500 ether, "payee gains 500");
    }

    // K-3385 (M-1035): confirmed_with_cooling kind-9 value=3599 (1s below the 3600 floor).
    function testK3385Cooling3599() public {
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _coolingConds(3599, 0), block.timestamp + 72 hours, 0, bytes32(uint256(303)));
        emit log_named_uint("K-3385 create ok", ok ? 1 : 0);
        if (!ok) emit log_named_bytes("K-3385 create revert", ret);
        assertFalse(ok, "creation must revert below the kind-9 floor");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }

    // K-3386 (M-1036): confirmed_with_cooling kind-9 value=86400 (24h).
    function testK3386Cooling86400() public {
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _coolingConds(86400, 0), block.timestamp + 72 hours, 0, bytes32(uint256(304)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool att,) = _callAs(arbiter, AGMT_V41, abi.encodeWithSignature("attest(uint256,uint256)", id, uint256(0)));
        assertTrue(att, "arbiter attest must succeed");
        vm.warp(block.timestamp + 3601);
        (bool relEarly,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertFalse(relEarly, "release must be blocked at +1h");
        vm.warp(block.timestamp + 86401 - 3601);
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertTrue(rel, "release must succeed after 24h cooling");
        assertEq(token.balanceOf(payee), 500 ether, "payee gains 500");
    }

    // K-3392 (M-1042): after_deal kind-4 target=live escrow v3, dealId=1 (no such deal on Anvil).
    function testK3392AfterDealEscrowV3() public {
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _afterDealConds(ESCROW_V3, 1), block.timestamp + 72 hours, 0, bytes32(uint256(305)));
        assertTrue(ok, "creation must succeed (SDK does not check kind-4 target)");
        uint256 id = abi.decode(ret, (uint256));
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertFalse(rel, "release must be blocked: no settled deal 1 in escrow v3");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }

    // K-3402 (M-1052): scheduled_payment expiry == unlock (B-38 boundary).
    // Probe-style: log the outcome; the verdict is decided by the node run.
    function testK3402ScheduledExpiryEqUnlock() public {
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _timeConds(block.timestamp + 24 hours), block.timestamp + 24 hours, 0, bytes32(uint256(306)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        vm.warp(block.timestamp + 24 hours);
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        emit log_named_uint("K-3402 release at exactly +24h ok", rel ? 1 : 0);
        emit log_named_uint("K-3402 payee balance ether", token.balanceOf(payee) / 1 ether);
        assertTrue(token.balanceOf(payee) == 0 || token.balanceOf(payee) == 500 ether, "payee gains 0 or 500");
    }

    // K-3411 (M-1061): panel [payee]/k=1, payee=stranger (voter != payee).
    function testK3411PanelPayeeStranger() public {
        address[] memory voters = new address[](1);
        voters[0] = payee;
        (bool ok, bytes memory ret) = _create(AGMT_V41, stranger, 500 ether, _panelConds(voters, 1), block.timestamp + 72 hours, 0, bytes32(uint256(307)));
        assertTrue(ok, "creation must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool v,) = _callAs(payee, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        assertTrue(v, "payee vote must succeed");
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertTrue(rel, "release must succeed");
        assertEq(token.balanceOf(stranger), 500 ether, "stranger (payee) gains 500");
    }
}
