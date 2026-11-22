// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Mocks.sol";

// ROUND 36-A — Team A. Live SDK 2813ca14 (55.015 B, UNCHANGED vs Minor 15)
// + Agreement v4.1 etched zerofee on fresh Anvil 4663 (via forge).
//  - K-3936 (M-1586): price_trigger op=gte, server kind-8 gte HONEST match —
//    mirror of the lte honest case (Minor 15 K-3853). Expect creation revert.
//  - K-3931 (M-1581): panel quorum [payee]/value=0 (near-miss family, panel
//    side of M-1502 two_of_three value=0). Expect creation revert.
//  - K-3932 (M-1582): two_of_three quorum [payee, stranger]/value=0
//    (two voters, k=0). Expect creation revert.
//  - K-3933 (M-1583): panel quorum EMPTY list, value=1. Expect creation
//    revert (k > voters.length).
//  - WATCH re-probes: 0x2591a130 returns 0; claimTo 2-arg reverts;
//    MAX_GAP == 300 (selector 0x605036a1) on the etched Agreement.
// Throwaway local keys only. No mainnet, no live calls.

contract Round36Test is Test {
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
    function _panelConds(address[] memory voters, uint256 k) internal pure returns (Cond[] memory conds) {
        conds = new Cond[](1);
        conds[0] = Cond({ kind: 6, target: address(0), data: abi.encode(voters), value: k });
    }

    // K-3936 (M-1586): price_trigger op=gte, server kind-8 gte honest.
    function testK3936PriceTriggerGteHonest() public {
        Cond[] memory conds = new Cond[](1);
        conds[0] = Cond({ kind: 8, target: address(token), data: hex"1234", value: 100 });
        (bool ok,) = _create(AGMT_V41, payee, 500 ether, conds, block.timestamp + 72 hours, 0, bytes32(uint256(801)));
        assertFalse(ok, "creation with kind-8 price condition (data 0x1234, gte) must revert, like the lte honest case");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }

    // K-3931 (M-1581): panel quorum [payee]/value=0.
    function testK3931PanelValueZero() public {
        address[] memory voters = new address[](1);
        voters[0] = payee;
        (bool ok,) = _create(AGMT_V41, payee, 500 ether, _panelConds(voters, 0), block.timestamp + 72 hours, 0, bytes32(uint256(802)));
        assertFalse(ok, "creation with panel quorum value=0 must revert (near-miss family, panel side)");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }

    // K-3932 (M-1582): two_of_three quorum [payee, stranger]/value=0.
    function testK3932TwoOfThreeValueZeroTwoVoters() public {
        address[] memory voters = new address[](2);
        voters[0] = payee;
        voters[1] = stranger;
        (bool ok,) = _create(AGMT_V41, payee, 500 ether, _panelConds(voters, 0), block.timestamp + 72 hours, 0, bytes32(uint256(803)));
        assertFalse(ok, "creation with quorum value=0 (two voters) must revert");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
    }

    // K-3933 (M-1583): panel quorum EMPTY list, value=1.
    function testK3933EmptyQuorum() public {
        address[] memory voters = new address[](0);
        (bool ok,) = _create(AGMT_V41, payee, 500 ether, _panelConds(voters, 1), block.timestamp + 72 hours, 0, bytes32(uint256(804)));
        assertFalse(ok, "creation with empty quorum list and k=1 must revert");
        assertEq(token.balanceOf(payee), 0, "payee gains 0");
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

    // WATCH re-probe: MAX_GAP == 300.
    function testWatchMaxGap300() public {
        (bool ok, bytes memory ret) = AGMT_V41.staticcall(abi.encodeWithSelector(bytes4(0x605036a1)));
        assertTrue(ok, "MAX_GAP staticcall must not revert");
        assertEq(abi.decode(ret, (uint256)), 300, "MAX_GAP == 300");
    }
}
