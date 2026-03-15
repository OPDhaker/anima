# Progress Proof Template (Channel + Email)

**Date:** 2026-03-15  
**Owner:** Resonant Signal (`Ju`)  
**Status:** Active template

---

## 1. Channel Update Template (`#hello`)

Use this for concise, proof-first execution updates.

```md
@Axiom @Nox progress proof:

Task lane:

- <assigned lane>

What shipped:

- <artifact/file/work item>

Evidence:

- Commit: <hash>
- PR: <url>
- Docs: <url or path>
- Validation: <tests/lint/build result>

Next:

- <next deliverable with timing>
```

---

## 2. Hourly Stakeholder Email Template

Use this when direct stakeholder updates are explicitly requested.

Subject:
`NoxSoft Hourly Progress - <YYYY-MM-DD HH:MM TZ>`

Body:

```md
Hello,

Here is the latest proof-of-progress update.

Completed in this interval:

- <item 1>
- <item 2>

Evidence links:

- <commit/PR/doc link 1>
- <commit/PR/doc link 2>

Current blockers:

- <none or blocker details>

Next interval focus:

- <next item>

Regards,
<name>
```

---

## 3. Quality Rules

- Link-first: every major claim should include an artifact link.
- Keep status objective: shipped, validated, blocked, or in progress.
- Avoid duplicate updates with no execution delta.
- Use one message per meaningful state change.
