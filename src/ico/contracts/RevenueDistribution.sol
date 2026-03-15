// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title RevenueDistribution
 * @dev Distributes platform revenue to NoxSoft token holders.
 *
 * 50% of net platform revenue is distributed proportionally to token
 * holders based on their balance at the time of each distribution.
 *
 * Features:
 *   - Snapshot-based distribution (ERC20Snapshot)
 *   - Proportional to balance at snapshot time
 *   - Multiple distribution rounds (monthly)
 *   - Claimable by token holders at any time
 *   - Unclaimed funds roll into next distribution after 90 days
 *   - Emergency pause
 *
 * @notice Revenue tokens, NOT equity dividends. Revenue participation only.
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract RevenueDistribution is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    struct Distribution {
        uint256 id;
        uint256 totalAmount;       // Total revenue to distribute (in payment token)
        uint256 snapshotSupply;    // Total token supply at snapshot
        uint256 createdAt;         // Timestamp
        uint256 expiresAt;         // After this, unclaimed funds return to treasury
        uint256 totalClaimed;      // Running total of claims
        bool active;
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    /// @dev The NoxSoft revenue token (for checking balances)
    IERC20 public immutable revenueToken;

    /// @dev Payment token for distributions (USDC, USDT, or ETH wrapper)
    IERC20 public immutable paymentToken;

    /// @dev Distribution ID => Distribution
    mapping(uint256 => Distribution) public distributions;

    /// @dev Distribution ID => user => claimed
    mapping(uint256 => mapping(address => bool)) public claimed;

    /// @dev Distribution ID => user => balance snapshot
    mapping(uint256 => mapping(address => uint256)) public snapshots;

    /// @dev Total distributions created
    uint256 public distributionCount;

    /// @dev Unclaimed expiry period (90 days)
    uint256 public constant EXPIRY_PERIOD = 90 days;

    /// @dev Minimum distribution amount (prevents dust distributions)
    uint256 public constant MIN_DISTRIBUTION = 100 * 1e6; // $100 in USDC (6 decimals)

    /// @dev Treasury address for expired unclaimed funds
    address public treasury;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event DistributionCreated(
        uint256 indexed distributionId,
        uint256 totalAmount,
        uint256 snapshotSupply,
        uint256 expiresAt
    );

    event RevenueClaimed(
        uint256 indexed distributionId,
        address indexed holder,
        uint256 amount
    );

    event UnclaimedRecovered(
        uint256 indexed distributionId,
        uint256 amount
    );

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(
        address revenueTokenAddress,
        address paymentTokenAddress,
        address treasuryAddress
    ) Ownable(msg.sender) {
        require(revenueTokenAddress != address(0), "Revenue token cannot be zero");
        require(paymentTokenAddress != address(0), "Payment token cannot be zero");
        require(treasuryAddress != address(0), "Treasury cannot be zero");

        revenueToken = IERC20(revenueTokenAddress);
        paymentToken = IERC20(paymentTokenAddress);
        treasury = treasuryAddress;
    }

    // -----------------------------------------------------------------------
    // Admin — Create Distribution
    // -----------------------------------------------------------------------

    /**
     * @dev Create a new revenue distribution round.
     * The payment tokens must already be deposited in this contract.
     * @param totalAmount Amount of payment tokens to distribute
     * @param snapshotSupply Total token supply at time of snapshot
     * @param holderBalances Array of (address, balance) pairs at snapshot
     */
    function createDistribution(
        uint256 totalAmount,
        uint256 snapshotSupply,
        address[] calldata holders,
        uint256[] calldata balances
    ) external onlyOwner whenNotPaused {
        require(totalAmount >= MIN_DISTRIBUTION, "Below minimum distribution");
        require(snapshotSupply > 0, "Supply cannot be zero");
        require(holders.length == balances.length, "Array length mismatch");
        require(
            paymentToken.balanceOf(address(this)) >= totalAmount,
            "Insufficient payment tokens"
        );

        uint256 id = distributionCount++;

        distributions[id] = Distribution({
            id: id,
            totalAmount: totalAmount,
            snapshotSupply: snapshotSupply,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + EXPIRY_PERIOD,
            totalClaimed: 0,
            active: true
        });

        // Store balance snapshots
        for (uint256 i = 0; i < holders.length; i++) {
            if (holders[i] != address(0) && balances[i] > 0) {
                snapshots[id][holders[i]] = balances[i];
            }
        }

        emit DistributionCreated(id, totalAmount, snapshotSupply, block.timestamp + EXPIRY_PERIOD);
    }

    // -----------------------------------------------------------------------
    // Holder — Claim Revenue
    // -----------------------------------------------------------------------

    /**
     * @dev Claim revenue share from a specific distribution.
     */
    function claim(uint256 distributionId) external nonReentrant whenNotPaused {
        Distribution storage dist = distributions[distributionId];
        require(dist.active, "Distribution not active");
        require(!claimed[distributionId][msg.sender], "Already claimed");
        require(block.timestamp <= dist.expiresAt, "Distribution expired");

        uint256 holderBalance = snapshots[distributionId][msg.sender];
        require(holderBalance > 0, "No balance at snapshot");

        // Calculate proportional share
        uint256 share = (dist.totalAmount * holderBalance) / dist.snapshotSupply;
        require(share > 0, "Share too small");

        claimed[distributionId][msg.sender] = true;
        dist.totalClaimed += share;

        paymentToken.safeTransfer(msg.sender, share);

        emit RevenueClaimed(distributionId, msg.sender, share);
    }

    /**
     * @dev Claim from all active distributions at once.
     */
    function claimAll() external nonReentrant whenNotPaused {
        uint256 totalClaim = 0;

        for (uint256 i = 0; i < distributionCount; i++) {
            Distribution storage dist = distributions[i];
            if (!dist.active || claimed[i][msg.sender] || block.timestamp > dist.expiresAt) {
                continue;
            }

            uint256 holderBalance = snapshots[i][msg.sender];
            if (holderBalance == 0) continue;

            uint256 share = (dist.totalAmount * holderBalance) / dist.snapshotSupply;
            if (share == 0) continue;

            claimed[i][msg.sender] = true;
            dist.totalClaimed += share;
            totalClaim += share;

            emit RevenueClaimed(i, msg.sender, share);
        }

        require(totalClaim > 0, "Nothing to claim");
        paymentToken.safeTransfer(msg.sender, totalClaim);
    }

    // -----------------------------------------------------------------------
    // View
    // -----------------------------------------------------------------------

    /**
     * @dev Calculate claimable amount for a holder across all distributions.
     */
    function claimableAmount(address holder) external view returns (uint256 total) {
        for (uint256 i = 0; i < distributionCount; i++) {
            Distribution storage dist = distributions[i];
            if (!dist.active || claimed[i][holder] || block.timestamp > dist.expiresAt) {
                continue;
            }
            uint256 balance = snapshots[i][holder];
            if (balance == 0) continue;
            total += (dist.totalAmount * balance) / dist.snapshotSupply;
        }
    }

    /**
     * @dev Get details for a specific distribution.
     */
    function getDistribution(uint256 id) external view returns (Distribution memory) {
        return distributions[id];
    }

    // -----------------------------------------------------------------------
    // Admin — Recover Unclaimed
    // -----------------------------------------------------------------------

    /**
     * @dev Recover unclaimed funds from an expired distribution.
     */
    function recoverUnclaimed(uint256 distributionId) external onlyOwner {
        Distribution storage dist = distributions[distributionId];
        require(dist.active, "Not active");
        require(block.timestamp > dist.expiresAt, "Not expired yet");

        uint256 unclaimed_amount = dist.totalAmount - dist.totalClaimed;
        dist.active = false;

        if (unclaimed_amount > 0) {
            paymentToken.safeTransfer(treasury, unclaimed_amount);
        }

        emit UnclaimedRecovered(distributionId, unclaimed_amount);
    }

    // -----------------------------------------------------------------------
    // Admin — Config
    // -----------------------------------------------------------------------

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Cannot be zero");
        treasury = newTreasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
