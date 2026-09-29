---
paths:
  - "backend/api/**/*.ts"
---

# API rules

- Validate every request body at the handler boundary.
- Return errors using the shared `ApiError` shape.
