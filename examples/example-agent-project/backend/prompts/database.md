---
title: Database prompt
---

# Database guidance

Use this when the task touches SQL.

## Queries

- Always use parameterized queries.
- Never build SQL with string concatenation.

## Migrations

Migrations live in `backend/migrations/` and are reviewed by a human.
