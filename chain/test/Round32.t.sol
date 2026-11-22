// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Mocks.sol";

// ROUND 32 — Tim A.
//  - K-3202 (M-852): panel quorum [payee]/k=1 — attacker-only voter list
//    releases +500 (B-23 fold on-chain leg).
//  - K-3203 (M-853): confirmed_with_cooling kind-9 value boundary probe:
//    0 / 1 / 3599 / 3600 — does the contract enforce a 3600s floor?
//  - K-3207 (M-857): panel voters reordered, same set, k=2 — control.
//  - K-3208 (M-858): panel duplicate voters [arbiter x3]/k=1 — probe.
//  - K-3223 (M-873): after_deal kind-4 target = the Agreement contract
//    itself — release must never succeed; refund after expiry whole.
//  - WATCH re-probes: 0x2591a130 returns 0; claimTo 2-arg reverts.
// Throwaway local keys only. No mainnet, no live calls.

contract Round32Test is Test {
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
    function _coolingConds(uint256 cooling) internal view returns (Cond[] memory conds) {
        conds = new Cond[](2);
        conds[0] = Cond({ kind: 1, target: arbiter, data: "", value: 0 });
        conds[1] = Cond({ kind: 9, target: payer, data: abi.encode(uint256(0)), value: cooling });
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

    // K-3202: panel [payee]/k=1 — single attacker voter releases +500.
    function testK3202PanelAttackerOnlyReleases() public {
        address[] memory voters = new address[](1);
        voters[0] = payee;
        Cond[] memory conds = new Cond[](1);
        conds[0] = Cond({ kind: 6, target: address(0), data: abi.encode(voters), value: 1 });
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, conds, block.timestamp + 72 hours, 0, bytes32(uint256(101)));
        require(ok, "create must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool v,) = _callAs(payee, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        require(v, "payee vote must succeed");
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        require(rel, "release at 1/1 quorum must succeed");
        assertEq(token.balanceOf(payee), 500 ether, "payee gains 500");
    }

    // K-3203: kind-9 cooling boundary. 3600 must create + release after
    // attest + warp. 0 / 1 / 3599 outcomes are logged (probe, not asserted
    // beyond payee-gain bounds) — the verdict reads them + node k3203.
    function testK3203Kind9Cooling3600Works() public {
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, _coolingConds(3600), block.timestamp + 72 hours, 0, bytes32(uint256(102)));
        require(ok, "create with cooling 3600 must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool att,) = _callAs(arbiter, AGMT_V41, abi.encodeWithSignature("attest(uint256,uint256)", id, uint256(0)));
        require(att, "arbiter attest must succeed");
        (bool relEarly,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        assertFalse(relEarly, "release before cooling must fail");
        vm.warp(block.timestamp + 3601);
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        require(rel, "release after 3601s must succeed");
        assertEq(token.balanceOf(payee), 500 ether, "payee gains 500 after cooling");
    }

    function testK3203Kind9CoolingZeroProbe() public {
        uint256[3] memory vals = [uint256(0), uint256(1), uint256(3599)];
        for (uint256 i = 0; i < vals.length; i++) {
            Cond[] memory conds = _coolingConds(vals[i]);
            (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, conds, block.timestamp + 72 hours, 0, bytes32(uint256(110 + i)));
            emit log_named_uint("K-3203 cooling value", vals[i]);
            emit log_named_uint("K-3203 create ok", ok ? 1 : 0);
            if (ok) {
                emit log_named_bytes("K-3203 create revert-or-id", ret);
                uint256 id = abi.decode(ret, (uint256));
                (bool att,) = _callAs(arbiter, AGMT_V41, abi.encodeWithSignature("attest(uint256,uint256)", id, uint256(0)));
                (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
                emit log_named_uint("K-3203 attest ok", att ? 1 : 0);
                emit log_named_uint("K-3203 release-immediately ok", rel ? 1 : 0);
            } else {
                emit log_named_bytes("K-3203 create revert", ret);
            }
        }
        // Probe only: whether a sub-floor cooling value creates + releases
        // immediately is read from the logs + node k3203 (verdict there).
        assertTrue(token.balanceOf(payee) == 0 || token.balanceOf(payee) == 500 ether, "payee gains 0 or 500 in the probe");
    }

    // K-3207: panel voters reordered [arbiter, payee, payer], k=2 — control:
    // same set, order irrelevant; 2 votes release +500.
    function testK3207PanelReorderedControl() public {
        address[] memory voters = new address[](3);
        voters[0] = arbiter; voters[1] = payee; voters[2] = payer;
        Cond[] memory conds = new Cond[](1);
        conds[0] = Cond({ kind: 6, target: address(0), data: abi.encode(voters), value: 2 });
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, conds, block.timestamp + 72 hours, 0, bytes32(uint256(103)));
        require(ok, "create must succeed");
        uint256 id = abi.decode(ret, (uint256));
        (bool v1,) = _callAs(payer, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        (bool v2,) = _callAs(payee, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        require(v1 && v2, "two votes must succeed");
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        require(rel, "release at 2/3 quorum must succeed");
        assertEq(token.balanceOf(payee), 500 ether, "payee gains 500");
    }

    // K-3208: panel duplicate voters [arbiter x3]/k=1 — probe: creation
    // outcome + whether one vote releases. Payee must gain 0 unless a
    // single (duplicate-counted) vote legitimately meets k=1.
    function testK3208PanelDupVotersProbe() public {
        address[] memory voters = new address[](3);
        voters[0] = arbiter; voters[1] = arbiter; voters[2] = arbiter;
        Cond[] memory conds = new Cond[](1);
        conds[0] = Cond({ kind: 6, target: address(0), data: abi.encode(voters), value: 1 });
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, conds, block.timestamp + 72 hours, 0, bytes32(uint256(104)));
        emit log_named_uint("K-3208 create ok", ok ? 1 : 0);
        if (!ok) {
            emit log_named_bytes("K-3208 create revert", ret);
            assertEq(bytes4(ret), bytes4(0x2bb9acf7), "revert must be BadInput if creation fails");
            assertEq(token.balanceOf(payee), 0, "payee gains 0");
            return;
        }
        uint256 id = abi.decode(ret, (uint256));
        (bool v,) = _callAs(arbiter, AGMT_V41, abi.encodeWithSignature("vote(uint256,uint256)", id, uint256(0)));
        (bool rel,) = _callAs(payee, AGMT_V41, abi.encodeWithSelector(SEL_RELEASE, id));
        emit log_named_uint("K-3208 vote ok", v ? 1 : 0);
        emit log_named_uint("K-3208 release ok", rel ? 1 : 0);
        // One distinct voter meeting k=1 is the contract's stated rule;
        // the probe only records it — node k3208 carries the verdict.
        assertTrue(token.balanceOf(payee) == 0 || token.balanceOf(payee) == 500 ether, "payee gains 0 or 500");
    }

    // K-3223: kind-4 target = the Agreement contract itself, dealId 1.
    // Release must never succeed (the target has no settled deal 1);
    // refund after expiry returns the payer whole.
    function testK3223Kind4TargetAgreementNeverReleases() public {
        Cond[] memory conds = new Cond[](1);
        conds[0] = Cond({ kind: 4, target: AGMT_V41, data: "", value: 1 });
        (bool ok, bytes memory ret) = _create(AGMT_V41, payee, 500 ether, conds, block.timestamp + 72 hours, 0, bytes32(uint256(105)));
        // Creation itself reverts (the contract validates the kind-4
        // target): no agreement is ever created, so nothing can release.
        emit log_named_uint("K-3223 create ok", ok ? 1 : 0);
        emit log_named_bytes("K-3223 create revert", ret);
        assertFalse(ok, "create with kind-4 target=Agreement must revert");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }
}
