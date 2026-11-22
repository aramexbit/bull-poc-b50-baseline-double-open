// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Mocks.sol";

// MINOR 12-A — Team A.
//  - K-3292 (M-942): panel duplicate voters [payee,payee]/k=2 — M-932 follow-up.
//  - K-3294 (M-944): panel [payee,payee,arbiter]/k=2 — duplicate + honest.
//  - K-3315 (M-965): confirmed_with_cooling kind-9 data=999 (not 0), value=3600.
//  - K-3312 (M-962): panel [payer,payee,arbiter]/k=3 — honest control.
//  - K-3314 (M-964): panel voter=ZERO — probe.
//  - WATCH re-probes: 0x2591a130 returns 0; claimTo 2-arg reverts.
// Throwaway local keys only. No mainnet, no live calls.

contract Minor12Test is Test {
    address constant AGMT_V41 = 0x7AB58fAAe65eFCF0037635382cAA546EaC233DA6;
    address constant ESCROW_V3 = 0xd961cA37e339E14e0D3478383a252E218fe7aa4a;
    address constant TREASURY = 0x1B3b7abb6553a1bbc9B285E6ab3F2012e88e4d5f;

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

    // K-3292 (M-942): panel [payee,payee]/k=2 — M-932 follow-up. Does the
    // contract count one distinct voter twice, or reject duplicates?
    function testK3292PanelDupVotersAA() public {
        address[] memory voters = new address[](2);
        voters[0] = payee; voters[1] = payee;
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _panelConds(voters, 2), block.timestamp + 72 hours, 0, bytes32(uint256(201)));
        emit log_named_uint("K-3292 create ok", ok ? 1 : 0);
        if (!ok) {
            emit log_named_bytes("K-3292 create revert", ret);
            assertEq(bytes4(ret), bytes4(0x2bb9acf7), "revert must be BadInput if creation fails");
            assertEq(token.balanceOf(payee), 0, "payee gains 0");
            return;
        }
        uint256 id = abi.decode(ret, (uint256));
        (bool v1,) = _callAs(payee, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        (bool v2,) = _callAs(payee, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(1)));
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        emit log_named_uint("K-3292 vote idx0 ok", v1 ? 1 : 0);
        emit log_named_uint("K-3292 vote idx1 ok", v2 ? 1 : 0);
        emit log_named_uint("K-3292 release ok", rel ? 1 : 0);
        // Probe only: whether duplicate votes count is read from the logs
        // + node k3292 (verdict there).
        assertTrue(token.balanceOf(payee) == 0 || token.balanceOf(payee) == 500 ether, "payee gains 0 or 500");
    }

    // K-3294 (M-944): panel [payee,payee,arbiter]/k=2 — duplicate + honest.
    function testK3294PanelDupVotersAAV1() public {
        address[] memory voters = new address[](3);
        voters[0] = payee; voters[1] = payee; voters[2] = arbiter;
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _panelConds(voters, 2), block.timestamp + 72 hours, 0, bytes32(uint256(202)));
        emit log_named_uint("K-3294 create ok", ok ? 1 : 0);
        if (!ok) {
            emit log_named_bytes("K-3294 create revert", ret);
            assertEq(bytes4(ret), bytes4(0x2bb9acf7), "revert must be BadInput if creation fails");
            assertEq(token.balanceOf(payee), 0, "payee gains 0");
            return;
        }
        uint256 id = abi.decode(ret, (uint256));
        (bool v1,) = _callAs(payee, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        (bool v2,) = _callAs(arbiter, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(2)));
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        emit log_named_uint("K-3294 vote payee ok", v1 ? 1 : 0);
        emit log_named_uint("K-3294 vote arbiter ok", v2 ? 1 : 0);
        emit log_named_uint("K-3294 release ok", rel ? 1 : 0);
        assertTrue(token.balanceOf(payee) == 0 || token.balanceOf(payee) == 500 ether, "payee gains 0 or 500");
    }

    // K-3315 (M-965): kind-9 cooling value=3600, data=999 (not 0) — the
    // contract validates kind-9 data too: creation reverts BadInput.
    // (First run asserted creation success — wrong; evidence says revert.)
    function testK3315Kind9Data999() public {
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _coolingConds(3600, 999), block.timestamp + 72 hours, 0, bytes32(uint256(203)));
        emit log_named_uint("K-3315 create ok", ok ? 1 : 0);
        emit log_named_bytes("K-3315 create revert", ret);
        assertFalse(ok, "create with kind-9 data=999 must revert");
        assertEq(bytes4(ret), bytes4(0x2bb9acf7), "revert must be BadInput");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }

    // K-3312 (M-962): panel [payer,payee,arbiter]/k=3 — honest control.
    function testK3312PanelK3Control() public {
        address[] memory voters = new address[](3);
        voters[0] = payer; voters[1] = payee; voters[2] = arbiter;
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _panelConds(voters, 3), block.timestamp + 72 hours, 0, bytes32(uint256(204)));
        require(ok, "create must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool v1,) = _callAs(payer, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        (bool v2,) = _callAs(payee, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        (bool v3,) = _callAs(arbiter, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        require(v1 && v2 && v3, "three votes must succeed");
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        require(rel, "release at 3/3 quorum must succeed");
        assertEq(token.balanceOf(payee), 500 ether, "payee gains 500");
    }

    // K-3314 (M-964): panel voter=ZERO — probe: creation outcome.
    function testK3314PanelZeroVoterProbe() public {
        address[] memory voters = new address[](1);
        voters[0] = address(0);
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _panelConds(voters, 1), block.timestamp + 72 hours, 0, bytes32(uint256(205)));
        emit log_named_uint("K-3314 create ok", ok ? 1 : 0);
        emit log_named_bytes("K-3314 create revert-or-id", ret);
        // Probe only: verdict reads the logs + node k3314.
        assertTrue(token.balanceOf(payee) == 0 || token.balanceOf(payee) == 500 ether, "payee gains 0 or 500");
    }
}
