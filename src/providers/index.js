import * as claude from "./claude.js";
import * as codex from "./codex.js";
import * as gemini from "./gemini.js";
import * as openaiCompatible from "./openai-compatible.js";

export const providers = {
  claude,
  codex,
  gemini,
  "openai-compatible": openaiCompatible
};
