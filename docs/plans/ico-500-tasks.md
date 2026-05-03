# NoxSoft ICO — 500 Task Master Plan

**Date:** 2026-03-15
**Author:** Axiom (The Executioner)
**Status:** Active — Awaiting Sylys's prioritization
**Target:** $2M raise via bonding curve, revenue tokens (NOT equity)

---

## Summary

| Category                      | Tasks   | Priority           |
| ----------------------------- | ------- | ------------------ |
| Legal & Compliance            | 1-50    | P0 (must do first) |
| Smart Contracts & Security    | 51-100  | P0                 |
| ICO Platform & Infrastructure | 101-150 | P0                 |
| Revenue & Business Model      | 151-200 | P0                 |
| Marketing & Community         | 201-300 | P1                 |
| Product & Platform Readiness  | 301-370 | P1                 |
| SVRN Chain & Economics        | 371-420 | P1                 |
| Security & Operations         | 421-460 | P0                 |
| Exchange & Post-Launch        | 461-500 | P2                 |

**Timeline:** 90-120 days to ICO launch.

---

## What Already Exists

- `src/ico/tokenomics.ts` — Token allocation (5/30/50/15), bonding curve ($0.001 → $2M cap)
- `src/ico/contracts/BondingCurveICO.sol` — ERC-20 with 1% transfer tax, pause, vesting, anti-whale
- `src/ico/launch-platform.ts` — ICO project lifecycle, trading, dashboard
- `src/ico/verification.ts` — PBC verification gate, 0.5% platform tax
- `src/license/stripe-checkout.ts` — Stripe integration (ready, needs API keys)
- `src/license/validator.ts` — Offline Ed25519 license validation
- SVRN network: 7 nodes running, UCU economy, citizenship, wallets

---

## 1. Legal & Compliance (1-50)

### Entity & Jurisdiction (1-15)

1. Register NoxSoft DAO LLC in Wyoming (DAO-friendly)
2. Obtain EIN from IRS for NoxSoft DAO LLC
3. Engage crypto-specialized law firm (Anderson Kill, Debevoise, or Fenwick)
4. Draft token purchase agreement (revenue token, NOT equity)
5. Draft terms of service for ICO platform
6. Draft privacy policy (GDPR + CCPA compliant)
7. Legal opinion letter: tokens are NOT securities (Howey test analysis)
8. Register with FinCEN as MSB if required
9. Assess Reg D / Reg S exemption for US/non-US investors
10. Draft SAFT for pre-sale
11. Establish offshore subsidiary for non-US token sales if needed
12. Engage tax counsel for token sale proceeds treatment
13. File Form D with SEC if using Reg D exemption
14. Draft investor accreditation verification process
15. Create geo-blocking policy (restricted jurisdictions)

### KYC/AML (16-30)

16. Select KYC provider (Jumio, Onfido, or Sumsub)
17. Integrate KYC API into ICO platform
18. Build KYC verification flow (ID + selfie + proof of address)
19. Implement AML screening against OFAC/SDN lists
20. Build PEP check
21. Create tiered verification levels (basic $1K, enhanced $25K, institutional unlimited)
22. Build KYC data encryption at rest (AES-256)
23. Implement GDPR right-to-erasure for KYC data
24. Build KYC admin dashboard for manual review
25. Create automated re-verification triggers
26. Implement sanctions screening for all wallet addresses
27. Build travel rule compliance (FATF)
28. Create KYC exemption flow for institutional investors
29. Implement continuous transaction monitoring
30. Build SAR workflow

### Token Legal Structure (31-50)

31. Define revenue share mechanism legally
32. Draft token holder agreement
33. Define team token lockup (4yr vest, 1yr cliff)
34. Define company round vesting contracts
35. Draft UBC distribution rules
36. Create token burn/buyback documentation
37. Draft platform fee disclosure (0.5% tax)
38. Create risk disclosure document
39. Draft dispute resolution mechanism
40. Register trademarks: SVRN, NoxSoft, UCU, Anima
41. File provisional patents for bonding curve mechanism
42. Draft open source license strategy
43. Create investment memorandum
44. Draft whitepaper legal review checklist
45. Engage auditing firm for smart contract legal opinion
46. Create AML compliance manual
47. Draft insider trading policy
48. Create token holder communication policy
49. Draft governance framework
50. Establish escrow for ICO proceeds

---

## 2. Smart Contracts & Security (51-100)

### Development (51-75)

51. Finalize BondingCurveICO.sol
52. Anti-whale mechanism (max 1% per tx)
53. 1% transfer tax with treasury allocation
54. Team vesting contract (4yr/1yr cliff)
55. Company round vesting (2yr linear)
56. UBC distribution contract (15%, drip)
57. Emergency pause/unpause
58. Revenue distribution contract (50% to holders)
59. Token snapshot mechanism
60. Bonding curve cap ($2M) auto-transition
61. Multi-sig treasury (3-of-5)
62. Timelock contract (48hr delay)
63. Token migration (SVRN ↔ Ethereum bridge)
64. Buyback-and-burn mechanism
65. Airdrop contract
66. Staking contract
67. Governance voting contract
68. Uniswap V3 liquidity pool seeding
69. Emergency withdrawal function
70. EIP-2612 permit (gasless approvals)
71. Token metadata contract
72. Batch transfer function
73. Reentrancy guards
74. UUPS upgradeable proxy
75. Event logging

### Security (76-100)

76. Internal security audit
77. Trail of Bits or OpenZeppelin audit
78. Second audit (Certik, Halborn, Consensys)
79. Slither static analysis
80. Mythril symbolic execution
81. Echidna fuzzing (1M iterations)
82. Goerli/Sepolia testnet deployment
83. SVRN testnet deployment
84. Etherscan verification
85. Formal verification of bonding curve math
86. Emergency pause test under load
87. Multi-sig operation testing
88. Timelock operation testing
89. Frontend pen test (XSS/CSRF)
90. Gas optimization (< 100K per purchase)
91. Maximum supply edge cases
92. Vesting schedule accuracy test
93. Revenue distribution with 1M+ holders sim
94. Bug bounty program (Immunefi, $50K-$500K)
95. Risk documentation
96. Incident response plan
97. Bridge security test
98. Transfer pattern monitoring
99. Upgrade governance process
100.  Final security sign-off

---

_[Tasks 101-500 posted in full to #hello on NoxSoft chat, 2026-03-15]_
_[Categories: ICO Platform, Revenue, Marketing, Product, SVRN, Security, Exchange, Post-Launch]_
