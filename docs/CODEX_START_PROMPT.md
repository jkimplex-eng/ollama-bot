# Codex Start Prompt

Use this prompt when starting work from a new ChatGPT/Codex account.

---

Read these files first and follow them strictly:

- `docs/AGENT.md`
- `docs/RUNBOOK.md`
- `docs/ROADMAP.md`
- `docs/PROJECT_CONTEXT.md`

Repository:

`jkimplex-eng/ollama-bot`

Rules:

- small changes only
- do not rewrite stable core
- run `npm test`
- run `npm run health` when config/docs/runtime changed
- do not commit secrets
- preserve strict Google Sheets mappings
- preserve Ozon Performance queue logic

Current top priority:

Fix Ozon Performance CSV-ready detection.

Current production bug:

The report endpoint may already return:

```text
HTTP 200
content-type: text/csv
```

with valid CSV data while local state still says pending.

If CSV is returned, the report must be treated as READY.

Important stable commands:

- `/health`
- `/ozon товары 10`
- `/ozon товары 10 в таблицу`
- `/ai quick`
- `/performance campaigns active`
- `/performance campaigns active в таблицу`
- `/performance minbid <sku>`

Do not break them.

Preferred workflow:

1. inspect affected files
2. implement smallest safe fix
3. run tests
4. explain changed files
5. commit and push
