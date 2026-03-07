# Perk API — Security Guidelines for Read-Only Chat Flows

This document describes practical safeguards to ensure the chat/search/find-path endpoints remain read-only and that LLM-proposed Cypher is treated as a proposal for operator review.

Recommended measures:

- Use a read-only DB account for all chat/search/find-path/start-node endpoints. Create a separate admin role for operators with write privileges and only use those credentials in operator tooling.
- Open Neo4j sessions with explicit read intent so the driver routes reads appropriately. Example (Neo4j JS driver):

```js
const session = driver.session({ defaultAccessMode: neo4j.session.READ });
return session
  .readTransaction((tx) => tx.run(query, params))
  .finally(() => session.close());
```

- Add a lightweight defensive sanitizer that rejects queries containing obvious write keywords before execution (e.g., `/\b(CREATE|MERGE|SET|DELETE|REMOVE|LOAD\s+CSV|CALL\s+apoc)\b/i`). Use this for defense-in-depth only — it is not a substitute for DB-level RBAC.
- Never execute Cypher statements produced by an LLM automatically. Treat LLM output as proposed queries that are surfaced to admins (via webhook, admin UI, or an audit queue) and require explicit operator approval and the admin credentials to run.
- Keep read and admin credentials separate (e.g., `NEO4J_READ_USER`, `NEO4J_ADMIN_USER`) and store them in environment variables. Rotate admin credentials regularly and audit their usage.
- Log and alert on any attempted write operations or `permission denied` DB errors; include tests asserting chat endpoints cannot perform writes.

Operational notes:

- Rely on DB-level RBAC (read-only accounts) as the authoritative safeguard. Driver-level read intent and code-level sanitizers are useful secondary protections.
- For operator flows, surface the proposed Cypher along with human-readable explanations and provenance. Keep an audit trail of proposals and operator actions.

These measures together provide defense-in-depth and help prevent accidental or malicious writes originating from LLM orchestration or user-submitted content.
