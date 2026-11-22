// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ROUND 9 — Team A (forge / on-chain).
// Mocks for the round-9 SDK-guard tests. The Agreement under test is the
// LIVE etched v3 bytecode (bytecode/agreement-84c6-zerofee.hex — feeSigner
// patched to address(0), same technique as Round8CreateTest), so
// createAgreement() is the real function, not a mock.

contract MockERC20 {
    string public name = "Mock Token";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "insufficient");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    function transfer(address to, uint256 amount) external virtual returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "no allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

// Honest vesting locker (the contract the USER pins as `locker`): pulls
// the locked amount, emits the exact LockCreated event the SDK parses,
// linear vesting from cliff to end, claimable by the beneficiary.
contract MockLocker {
    event LockCreated(uint256 indexed id, address indexed token, address indexed beneficiary, address creator, uint256 amount, uint64 start, uint64 cliff, uint64 end, uint64 step);
    struct Lock {
        address token; address beneficiary; uint256 amount;
        uint64 start; uint64 cliff; uint64 end; uint64 step;
    }
    uint256 public nextId = 1;
    mapping(uint256 => Lock) public locks;
    mapping(uint256 => uint256) public claimed;

    function createLock(address token, uint256 amount, address beneficiary, uint64 start, uint64 cliff, uint64 end, uint64 step) external returns (uint256 id) {
        id = nextId++;
        require(MockERC20(token).transferFrom(msg.sender, address(this), amount), "pull failed");
        locks[id] = Lock(token, beneficiary, amount, start, cliff, end, step);
        emit LockCreated(id, token, beneficiary, msg.sender, amount, start, cliff, end, step);
    }
    function getLock(uint256 id) external view returns (Lock memory) { return locks[id]; }
    function vested(uint256 id) public view returns (uint256) {
        Lock memory l = locks[id];
        if (block.timestamp < l.cliff) return 0;
        if (block.timestamp >= l.end) return l.amount;
        if (l.end <= l.cliff) return l.amount;
        return (l.amount * (block.timestamp - l.cliff)) / (l.end - l.cliff);
    }
    function claimable(uint256 id) external view returns (uint256) {
        uint256 v = vested(id);
        return v > claimed[id] ? v - claimed[id] : 0;
    }
    function claim(uint256 id) external {
        uint256 c = this.claimable(id);
        require(c > 0, "nothing claimable");
        claimed[id] += c;
        require(MockERC20(locks[id].token).transfer(locks[id].beneficiary, c), "claim failed");
    }
}

// Attacker-controlled oracle: always reports a huge value, so a kind-2
// call_gte / kind-3 call_lte condition with this target is met (or not)
// exactly as the attacker wants, at any time.
contract AttackerOracle {
    uint256 public v = 1e30;
    function set(uint256 x) external { v = x; }
    function get() external view returns (uint256) { return v; }
    function balanceOf(address) external view returns (uint256) { return v; }
    // Live price_trigger shape (agreement #8): selector + one 32-byte arg.
    function price(address) external view returns (uint256) { return v; }
}

// Fake Bull escrow for K-681: deals(uint256) always reports a configurable
// status word (index 9 of the 13-word tuple). Used by the SDK after_deal
// runner: the mock server swaps the kind-4 target to this contract.
contract FakeEscrow {
    uint256 public statusWord;
    constructor(uint256 s) { statusWord = s; }
    function setStatus(uint256 s) external { statusWord = s; }
    function deals(uint256) external view returns (address,address,address,address,uint256,address,uint256,uint256,uint256,uint256,bool,bool,uint256) {
        return (address(0),address(0),address(0),address(0),0,address(0),0,0,0,statusWord,false,false,0);
    }
}

// ROUND 29 — Team C (M-411/K-2742): a vesting locker that ALSO exposes a
// function whose arguments contain the token + beneficiary hex, so the
// SDK lock() substring check passes while the call drains to an attacker.
// The locker is caller-trusted in the SDK threat model; this mock shows
// the check itself is bypassable by construction (any function whose args
// include token+beneficiary passes), not that a real locker has trap().
contract TrapLocker {
    event LockCreated(uint256 indexed id, address indexed token, address indexed beneficiary, address creator, uint256 amount, uint64 start, uint64 cliff, uint64 end, uint64 step);
    uint256 public nextId = 1;
    function trap(address token, uint256 amount, address beneficiary, address attacker) external returns (uint256 id) {
        id = nextId++;
        require(MockERC20(token).transferFrom(msg.sender, attacker, amount), "pull failed");
        emit LockCreated(id, token, beneficiary, msg.sender, amount, 0, 0, 0, 0);
    }
    function createLock(address token, uint256 amount, address beneficiary, uint64 start, uint64 cliff, uint64 end, uint64 step) external returns (uint256 id) {
        id = nextId++;
        require(MockERC20(token).transferFrom(msg.sender, address(this), amount), "pull failed");
        emit LockCreated(id, token, beneficiary, msg.sender, amount, start, cliff, end, step);
    }
}
