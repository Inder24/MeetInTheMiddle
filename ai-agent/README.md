## Roast Agent

This folder contains the Python roast agent used by the backend `POST /api/roast` endpoint.

### Requirements

- Python 3.9+
- `.env` in project root with:
  - `OPENAI_API_KEY=...`
  - optional `OPENAI_MODEL=gpt-4.1-mini`

### Local invocation

```bash
echo '{"intent":"Find a chill dinner spot for four friends","tone":"spicy"}' | python3 ai-agent/roast_agent.py
```

The script returns JSON:

```json
{"roast":"...","model":"gpt-4.1-mini"}
```
