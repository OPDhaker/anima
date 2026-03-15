// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title TokenVesting
 * @dev Manages vesting schedules for NoxSoft ICO token allocations.
 *
 * Two vesting types:
 *   - Team: 4-year vest, 1-year cliff (Tasks #33, #54)
 *   - Company Round: 2-year linear vest (Tasks #34, #55)
 *
 * Features:
 *   - Multiple beneficiaries with independent schedules
 *   - Cliff period (no tokens released until cliff passes)
 *   - Linear release after cliff
 *   - Revocable by admin (for team departures)
 *   - Emergency pause
 *
 * @notice Part of NoxSoft ICO smart contract suite
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract TokenVesting is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    struct VestingSchedule {
        address beneficiary;
        uint256 totalAmount;
        uint256 released;
        uint256 startTime;
        uint256 cliffDuration;   // seconds — no tokens before cliff
        uint256 vestingDuration; // seconds — total vest period (includes cliff)
        bool revocable;
        bool revoked;
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    IERC20 public immutable token;

    /// @dev scheduleId => VestingSchedule
    mapping(bytes32 => VestingSchedule) public schedules;

    /// @dev beneficiary => list of schedule IDs
    mapping(address => bytes32[]) public beneficiarySchedules;

    /// @dev Total tokens locked in vesting
    uint256 public totalLocked;

    /// @dev Counter for unique schedule IDs
    uint256 private _scheduleCount;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event ScheduleCreated(
        bytes32 indexed scheduleId,
        address indexed beneficiary,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestingDuration,
        bool revocable
    );

    event TokensReleased(
        bytes32 indexed scheduleId,
        address indexed beneficiary,
        uint256 amount
    );

    event ScheduleRevoked(
        bytes32 indexed scheduleId,
        address indexed beneficiary,
        uint256 unvestedReturned
    );

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(address tokenAddress) Ownable(msg.sender) {
        require(tokenAddress != address(0), "Token address cannot be zero");
        token = IERC20(tokenAddress);
    }

    // -----------------------------------------------------------------------
    // Admin — Create Vesting Schedules
    // -----------------------------------------------------------------------

    /**
     * @dev Create a new vesting schedule for a beneficiary.
     * @param beneficiary Address that will receive tokens
     * @param totalAmount Total tokens to vest
     * @param startTime Unix timestamp when vesting starts
     * @param cliffDuration Seconds before any tokens are released
     * @param vestingDuration Total vesting period in seconds (includes cliff)
     * @param revocable Whether the owner can revoke unvested tokens
     */
    function createSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestingDuration,
        bool revocable
    ) external onlyOwner whenNotPaused returns (bytes32) {
        require(beneficiary != address(0), "Beneficiary cannot be zero");
        require(totalAmount > 0, "Amount must be positive");
        require(vestingDuration > 0, "Duration must be positive");
        require(cliffDuration <= vestingDuration, "Cliff exceeds vesting");
        require(
            token.balanceOf(address(this)) >= totalLocked + totalAmount,
            "Insufficient tokens in contract"
        );

        bytes32 scheduleId = keccak256(
            abi.encodePacked(beneficiary, _scheduleCount, block.timestamp)
        );
        _scheduleCount++;

        schedules[scheduleId] = VestingSchedule({
            beneficiary: beneficiary,
            totalAmount: totalAmount,
            released: 0,
            startTime: startTime,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            revocable: revocable,
            revoked: false
        });

        beneficiarySchedules[beneficiary].push(scheduleId);
        totalLocked += totalAmount;

        emit ScheduleCreated(
            scheduleId,
            beneficiary,
            totalAmount,
            startTime,
            cliffDuration,
            vestingDuration,
            revocable
        );

        return scheduleId;
    }

    /**
     * @dev Convenience: create team vesting (4yr vest, 1yr cliff, revocable)
     */
    function createTeamSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 startTime
    ) external onlyOwner whenNotPaused returns (bytes32) {
        return this.createSchedule(
            beneficiary,
            totalAmount,
            startTime,
            365 days,     // 1-year cliff
            4 * 365 days, // 4-year vest
            true          // revocable
        );
    }

    /**
     * @dev Convenience: create company round vesting (2yr linear, no cliff, non-revocable)
     */
    function createCompanySchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 startTime
    ) external onlyOwner whenNotPaused returns (bytes32) {
        return this.createSchedule(
            beneficiary,
            totalAmount,
            startTime,
            0,            // no cliff
            2 * 365 days, // 2-year linear vest
            false         // non-revocable
        );
    }

    // -----------------------------------------------------------------------
    // Beneficiary — Release Tokens
    // -----------------------------------------------------------------------

    /**
     * @dev Release vested tokens for a specific schedule.
     */
    function release(bytes32 scheduleId) external nonReentrant whenNotPaused {
        VestingSchedule storage schedule = schedules[scheduleId];
        require(schedule.beneficiary == msg.sender, "Not beneficiary");
        require(!schedule.revoked, "Schedule revoked");

        uint256 releasable = _releasableAmount(schedule);
        require(releasable > 0, "Nothing to release");

        schedule.released += releasable;
        totalLocked -= releasable;

        token.safeTransfer(schedule.beneficiary, releasable);

        emit TokensReleased(scheduleId, schedule.beneficiary, releasable);
    }

    /**
     * @dev Release all vested tokens across all schedules for the caller.
     */
    function releaseAll() external nonReentrant whenNotPaused {
        bytes32[] storage ids = beneficiarySchedules[msg.sender];
        uint256 totalReleasable = 0;

        for (uint256 i = 0; i < ids.length; i++) {
            VestingSchedule storage schedule = schedules[ids[i]];
            if (schedule.revoked) continue;

            uint256 releasable = _releasableAmount(schedule);
            if (releasable > 0) {
                schedule.released += releasable;
                totalReleasable += releasable;
                emit TokensReleased(ids[i], msg.sender, releasable);
            }
        }

        require(totalReleasable > 0, "Nothing to release");
        totalLocked -= totalReleasable;
        token.safeTransfer(msg.sender, totalReleasable);
    }

    // -----------------------------------------------------------------------
    // Admin — Revoke
    // -----------------------------------------------------------------------

    /**
     * @dev Revoke a vesting schedule, returning unvested tokens to owner.
     */
    function revoke(bytes32 scheduleId) external onlyOwner {
        VestingSchedule storage schedule = schedules[scheduleId];
        require(schedule.revocable, "Not revocable");
        require(!schedule.revoked, "Already revoked");

        // Release any vested but unclaimed tokens to beneficiary first
        uint256 releasable = _releasableAmount(schedule);
        if (releasable > 0) {
            schedule.released += releasable;
            totalLocked -= releasable;
            token.safeTransfer(schedule.beneficiary, releasable);
            emit TokensReleased(scheduleId, schedule.beneficiary, releasable);
        }

        // Return unvested to owner
        uint256 unvested = schedule.totalAmount - schedule.released;
        schedule.revoked = true;
        totalLocked -= unvested;

        if (unvested > 0) {
            token.safeTransfer(owner(), unvested);
        }

        emit ScheduleRevoked(scheduleId, schedule.beneficiary, unvested);
    }

    // -----------------------------------------------------------------------
    // View — Vesting Calculations
    // -----------------------------------------------------------------------

    /**
     * @dev Calculate the vested amount for a schedule at current time.
     */
    function vestedAmount(bytes32 scheduleId) external view returns (uint256) {
        return _vestedAmount(schedules[scheduleId]);
    }

    /**
     * @dev Calculate the releasable (vested but unclaimed) amount.
     */
    function releasableAmount(bytes32 scheduleId) external view returns (uint256) {
        return _releasableAmount(schedules[scheduleId]);
    }

    /**
     * @dev Get all schedule IDs for a beneficiary.
     */
    function getScheduleIds(address beneficiary) external view returns (bytes32[] memory) {
        return beneficiarySchedules[beneficiary];
    }

    // -----------------------------------------------------------------------
    // Admin — Emergency
    // -----------------------------------------------------------------------

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Emergency: recover tokens sent to this contract by accident.
     * Cannot withdraw tokens that are locked in active vesting schedules.
     */
    function emergencyWithdraw(address tokenAddress, uint256 amount) external onlyOwner {
        if (tokenAddress == address(token)) {
            uint256 free = token.balanceOf(address(this)) - totalLocked;
            require(amount <= free, "Cannot withdraw locked tokens");
        }
        IERC20(tokenAddress).safeTransfer(owner(), amount);
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    function _vestedAmount(VestingSchedule storage schedule) internal view returns (uint256) {
        if (block.timestamp < schedule.startTime + schedule.cliffDuration) {
            return 0; // Before cliff
        }

        uint256 elapsed = block.timestamp - schedule.startTime;
        if (elapsed >= schedule.vestingDuration) {
            return schedule.totalAmount; // Fully vested
        }

        // Linear vesting after cliff
        return (schedule.totalAmount * elapsed) / schedule.vestingDuration;
    }

    function _releasableAmount(VestingSchedule storage schedule) internal view returns (uint256) {
        return _vestedAmount(schedule) - schedule.released;
    }
}
