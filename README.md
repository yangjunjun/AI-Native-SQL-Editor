# AI-Native SQL Editor

A runnable **Monaco Editor AI Inline Chat MVP**. The prototype uses Monaco ViewZone to place a chat input directly inside the SQL editor.

## Features

- **Ctrl+I / Cmd+I** opens the Inline Chat near the cursor
- Edit a selected SQL range, or the whole document when nothing is selected
- **Ctrl+Enter** to generate SQL; **Esc** to close
- Monaco **DiffEditor** shows inline changes in the original editor area, with Accept / Reject
- `executeEdits()` and undo stops, preserving Ctrl+Z undo
- Reject leaves SQL unchanged; version checks block changes when SQL has been edited since generation
- **Demo mode** (rule-based, no credentials) or **AI API mode** (OpenAI-compatible streaming chat completions via Node proxy)
- AI credentials are used only by the server, never embedded in frontend code

## Run demo

Open `index.html` in a browser with internet access. Monaco loads from a jsDelivr CDN. Alternatively:

```bash
python -m http.server 8080
```

Visit http://localhost:8080, select SQL, press Ctrl+I, and enter `增加最近30天过滤条件`. Generate, compare, and Accept.

## Run with real AI

Node.js 20.12+ required. Copy `.env.example` to `.env` in the project root:

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env`.

Edit `.env` with your provider settings (use `KEY=value` syntax):

```dotenv
AI_API_KEY="YOUR_KEY"
AI_MODEL="gpt-4.1-mini"
AI_BASE_URL="https://api.openai.com/v1"
```

Then run `node server.mjs`. The server automatically loads `.env` from the directory containing `server.mjs`. Restart the server after changing the file. Existing environment variables take precedence over `.env`; the file is optional. `.env` is ignored by Git. You may also set `PORT` in `.env` (default: `3000`).

Alternatively, keep using environment variables:

```bash
export AI_API_KEY="YOUR_KEY"
export AI_MODEL="gpt-4.1-mini"
export AI_BASE_URL="https://api.openai.com/v1"
node server.mjs
```

On Windows PowerShell:

```powershell
$env:AI_API_KEY = "YOUR_KEY"
$env:AI_MODEL = "gpt-4.1-mini"
$env:AI_BASE_URL = "https://api.openai.com/v1"
node server.mjs
```

Visit **http://localhost:3000**, select **AI API 模式**, then use Ctrl+I. AI API mode sends the current selected SQL and instruction to your configured provider through the Node server.

## Security / limitations

- Never put API credentials in browser code or a committed configuration file.
- `server.mjs` is a local development gateway without authentication, rate limits or quotas. Do **not** expose it publicly.
- SQL content is transmitted to the selected AI provider in API mode. Do not send confidential SQL unless the provider and policy permit it.
- Generated SQL must be reviewed; no SQL execution, schema validation, SQL dialect verification or database access occurs.
- This is a first implementation focused on Monaco editing interactions, not a production-ready AI agent.
- CDN loading requires internet access. For enterprise deployments, bundle Monaco locally rather than using this CDN.
