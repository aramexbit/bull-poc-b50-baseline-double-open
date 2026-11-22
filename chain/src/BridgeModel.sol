// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// BridgeModel copied VERBATIM from poc-repos/bull-poc-b42-checkbridge-drain/chain/test/Round23A.t.sol
// (B-42 PoC, round 23 Team A, lines 49-149): faithful Solidity re-implementation
// of checkBridge as written in live SDK f450d44d (sdk-live.mjs lines 81-99).
// Copied here so the round-25 approve-spender test (K-2026) runs against the
// same model without touching the submitted B-42 staging repo.
import "forge-std/Test.sol";

struct BStep { uint256 chainId; address from; address to; uint256 value; string data; }
struct BQuote { address recipient; uint256 toChainId; BStep[] steps; }
struct BReq { address user; uint256 fromChainId; string fromName; address fromToken; uint256 raw; uint256 toChainId; }

/// Faithful Solidity re-implementation of checkBridge (SDK f450, lines 81-99).
/// send() executes each step pranked as req.user — exactly as the real
/// bridge.send() sends the transactions FROM the user's wallet.
contract BridgeModel is Test {
    function check(BQuote memory q, BReq memory req) public pure returns (bool) {
        if (q.steps.length == 0 || q.steps.length > 4)
            revert("the bridge quote has no usable steps.");
        if (q.recipient != address(0) && q.recipient != req.user)
            revert("the bridge recipient is not your own address.");
        if (q.toChainId != req.toChainId)
            revert("the bridge pays out on another chain than you asked for.");
        for (uint256 i = 0; i < q.steps.length; i++) {
            BStep memory t = q.steps[i];
            if (t.chainId != req.fromChainId)
                revert(string.concat("a bridge step is not for ", req.fromName, " (", _toString(req.fromChainId), ")."));
            if (t.from != address(0) && t.from != req.user)
                revert("a bridge step is sent from another address than yours.");
            if (t.to == address(0))
                revert("a bridge step has no valid target.");
            if (t.value != 0)
                revert("a bridge step sends native coin. A stablecoin bridge never needs that.");
            bytes memory d = bytes(t.data);
            if (!_isValidHexData(d))
                revert("a bridge step has invalid calldata.");
            if (_startsWithApprove(d)) {
                if (t.to != req.fromToken)
                    revert("a bridge approval is on another token than the one you bridge.");
                if (d.length != 138 || _approveAmount(d) > req.raw)
                    revert("a bridge approval is malformed or for more than the amount you bridge.");
            }
        }
        return true;
    }

    /// Mirrors bridge.send(): check first, then execute each step verbatim
    /// from the user's account with value 0.
    function send(BQuote memory q, BReq memory req) public returns (bool) {
        require(check(q, req), "check failed");
        for (uint256 i = 0; i < q.steps.length; i++) {
            BStep memory t = q.steps[i];
            bytes memory cd = _hexToBytes(t.data);
            vm.prank(req.user);
            (bool ok,) = t.to.call(cd);
            require(ok, "bridge step execution reverted");
        }
        return true;
    }

    function _isValidHexData(bytes memory d) internal pure returns (bool) {
        if (d.length < 2 || d[0] != "0" || d[1] != "x") return false;
        if ((d.length - 2) % 2 != 0) return false;
        for (uint256 i = 2; i < d.length; i++) {
            bytes1 c = d[i];
            bool ok = (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
            if (!ok) return false;
        }
        return true;
    }

    /// Case-sensitive: exactly "0x095ea7b3" (lowercase), as in the JS.
    function _startsWithApprove(bytes memory d) internal pure returns (bool) {
        if (d.length < 10) return false;
        bytes memory p = bytes("0x095ea7b3");
        for (uint256 i = 0; i < 10; i++) if (d[i] != p[i]) return false;
        return true;
    }

    /// JS: BigInt("0x" + data.slice(74, 138)) — 64 hex chars = amount.
    function _approveAmount(bytes memory d) internal pure returns (uint256 amt) {
        for (uint256 i = 74; i < 138; i++) amt = amt * 16 + _hexVal(d[i]);
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 len;
        uint256 x = v;
        while (x > 0) { len++; x /= 10; }
        bytes memory out = new bytes(len);
        while (v > 0) { out[--len] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        return string(out);
    }

    function _hexVal(bytes1 c) internal pure returns (uint256) {
        if (c >= "0" && c <= "9") return uint8(c) - 48;
        if (c >= "a" && c <= "f") return uint8(c) - 87;
        return uint8(c) - 55; // A-F
    }

    function _hexToBytes(string memory s) public pure returns (bytes memory out) {
        bytes memory d = bytes(s);
        require(d.length >= 2 && d[0] == "0" && d[1] == "x", "not hex");
        out = new bytes((d.length - 2) / 2);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = bytes1(uint8(_hexVal(d[2 + 2 * i]) * 16 + _hexVal(d[3 + 2 * i])));
        }
    }
}
