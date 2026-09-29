# Backend architecture

The backend is a layered service:

```text
api/  →  services/  →  repositories/  →  PostgreSQL
```

## Layers

- **api** — HTTP handlers, request validation.
- **services** — business logic.
- **repositories** — SQL access. See [database guidance](prompts/database.md#queries).

Back to the [agent instructions](../AGENTS.md).
