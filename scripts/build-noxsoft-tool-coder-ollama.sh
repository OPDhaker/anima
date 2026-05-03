#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_NAME="${MODEL_NAME:-noxsoft-tool-coder:latest}"
MODEL_FILE="${MODEL_FILE:-$ROOT_DIR/models/ollama/noxsoft-tool-coder.Modelfile}"
BASE_MODEL="${BASE_MODEL:-}"

if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama is required but was not found in PATH" >&2
  exit 1
fi

if ! ollama list >/dev/null 2>&1; then
  echo "ollama is installed but no local Ollama server is reachable" >&2
  exit 1
fi

if [[ ! -f "$MODEL_FILE" ]]; then
  echo "missing Modelfile: $MODEL_FILE" >&2
  exit 1
fi

if [[ -z "$BASE_MODEL" ]]; then
  for candidate in qwen3-coder:latest qwen3-coder:30b qwen2.5-coder:32b qwen2.5-coder:latest gpt-oss:20b mistral:latest; do
    if ollama show "$candidate" >/dev/null 2>&1; then
      BASE_MODEL="$candidate"
      break
    fi
  done
fi

if [[ -z "$BASE_MODEL" ]]; then
  echo "no suitable local base model found; install one of: qwen3-coder:latest, qwen3-coder:30b, qwen2.5-coder:32b, qwen2.5-coder:latest, gpt-oss:20b, mistral:latest" >&2
  exit 1
fi

TMP_MODEL_FILE="$(mktemp "${TMPDIR:-/tmp}/noxsoft-tool-coder.XXXXXX.Modelfile")"
trap 'rm -f "$TMP_MODEL_FILE"' EXIT
sed "s|^FROM .*|FROM $BASE_MODEL|" "$MODEL_FILE" > "$TMP_MODEL_FILE"

echo "Building local Ollama model $MODEL_NAME from $TMP_MODEL_FILE"
echo "Using base model: $BASE_MODEL"
ollama create "$MODEL_NAME" -f "$TMP_MODEL_FILE"

cat <<EOF

Built $MODEL_NAME.

Example ANIMA config:

{
  "agents": {
    "defaults": {
      "model": {
        "primary": "ollama/qwen3-coder:latest",
        "fallbacks": ["openai-codex/gpt-5.2-codex"]
      },
      "models": {
        "ollama/qwen3-coder:latest": { "alias": "local-tools" }
      }
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "ollama": {
        "baseUrl": "http://127.0.0.1:11434/v1",
        "apiKey": "ollama-local",
        "api": "openai-completions",
        "models": [
          {
            "id": "qwen3-coder:latest",
            "name": "Qwen3 Coder",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 65536,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
EOF
