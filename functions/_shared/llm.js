export const OLLAMA_MODEL = "gpt-oss:120b";

export function buildJsonChatBody({
  systemPrompt,
  userPrompt,
  temperature = 0.2,
  topP = 0.9,
  repeatPenalty = 1.08,
  numPredict,
  numCtx = 8192,
  seed,
}) {
  const options = {
    temperature,
    top_p: topP,
    repeat_penalty: repeatPenalty,
    num_ctx: numCtx,
  };

  if (typeof numPredict === "number") {
    options.num_predict = numPredict;
  }

  if (typeof seed === "number") {
    options.seed = seed;
  }

  return {
    model: OLLAMA_MODEL,
    stream: false,
    format: "json",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    options,
  };
}

export function extractChatContent(aiData) {
  return (
    aiData?.message?.content ||
    aiData?.choices?.[0]?.message?.content ||
    aiData?.response ||
    ""
  );
}

function extractBalancedJson(raw) {
  if (typeof raw !== "string") return null;

  const text = raw.trim();
  const startIndexes = [text.indexOf("{"), text.indexOf("[" )].filter(
    (index) => index >= 0,
  );

  if (!startIndexes.length) return null;

  const start = Math.min(...startIndexes);
  const opening = text[start];
  const closing = opening === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (character === "\\") {
      if (inString) escapeNext = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (character === opening) depth += 1;
    if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function parseJsonResponse(aiData) {
  const raw = extractChatContent(aiData);
  const jsonText = extractBalancedJson(raw);

  if (!jsonText) return null;

  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}
