# AI-Native SQL Editor

Monaco Editor AI Inline Chat prototype.

## Quick start

Open `index.html` in a browser with network access to the Monaco CDN, or run a static HTTP server:

```sh
python -m http.server 8080
```

Visit http://localhost:8080. Select SQL or place the cursor, press **Ctrl+I**, enter an instruction, preview the diff, and Accept or Reject. No API key is required for demo mode.

The demo is rule-based, **not a live AI model**. See the code for the `rewrite()` function; connect an authenticated server endpoint before using a real model. Never put API keys in browser code.
