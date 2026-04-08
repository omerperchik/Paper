export const type = "gemma_local";
export const label = "Gemma 4 via Ollama (local)";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434/v1";
export const DEFAULT_OLLAMA_MODEL = "gemma4:e4b";
export const DEFAULT_FALLBACK_URL = "https://api.minimaxi.chat/v1";
export const DEFAULT_FALLBACK_MODEL = "MiniMax-M1";

export const models = [
  { id: "gemma4:e4b", label: "Gemma 4 E4B (Ollama)" },
  { id: "gemma4:27b", label: "Gemma 4 27B (Ollama)" },
  { id: "gemma3:latest", label: "Gemma 3 (Ollama)" },
  { id: "MiniMax-M1", label: "MiniMax M1 (fallback)" },
];

export const agentConfigurationDoc = `# gemma_local agent configuration

Adapter: gemma_local

Use when:
- You want Paperclip to run prompts against a local Ollama instance serving Gemma 4
- You need automatic fallback to MiniMax cloud API when Ollama is unavailable
- You want full trace logging of every AI call including latency and token counts

Don't use when:
- You need a full CLI-based coding agent with tool execution (use claude_local or gemini_local)
- You don't have Ollama installed locally and don't want MiniMax fallback
- You need streaming responses (this adapter uses synchronous completions)

Core fields:
- ollamaUrl (string, optional): Ollama OpenAI-compatible API base URL. Defaults to http://localhost:11434/v1
- ollamaModel (string, optional): Ollama model name. Defaults to gemma4:e4b
- fallbackUrl (string, optional): MiniMax API base URL. Defaults to https://api.minimaxi.chat/v1
- fallbackModel (string, optional): MiniMax model name. Defaults to MiniMax-M1
- fallbackApiKey (string, optional): API key for MiniMax authentication
- promptTemplate (string, optional): run prompt template
- systemPrompt (string, optional): system-level instructions prepended to every call
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): Ollama request timeout in seconds (default 240)
- fallbackTimeoutSec (number, optional): MiniMax request timeout in seconds (default 120)

Notes:
- Connects to Ollama's OpenAI-compatible chat completions endpoint.
- Every AI call is trace-logged with model, was_fallback, latency_ms, and token counts.
- Supports conversation history, system prompts, and tool calls via OpenAI chat format.
- When Ollama is unreachable or errors, automatically falls back to MiniMax cloud API.
`;
