import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { buildJsonChatBody, parseJsonResponse } from "../_shared/llm.js";
import { isTechTutorRequest, techOnlyRefusalMessage } from "../_shared/tech-domain.js";

const BASE_CREDIT_COST = 3;
const TOKENS_PER_CREDIT = 250;
const MAX_VARIABLE_COST = 4;

function calculateCreditCost(evalCount) {
  const variableCost = Math.min(MAX_VARIABLE_COST, Math.ceil(evalCount / TOKENS_PER_CREDIT));
  return BASE_CREDIT_COST + variableCost;
}

serve(async (req) => {
  //  Handle preflight FIRST
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );

    // Auth
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    const { data: userData, error: userError } = await supabase.auth.getUser(token);

    if (userError || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const user = userData.user;

    // Credits check
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (!profile || profile.credits <= 0) {
      return jsonResponse({ error: "No credits left" }, 403);
    }

    const body = await req.json();
    const input = body?.input;

    if (!input || typeof input !== "string") {
      return jsonResponse({ error: "Invalid input provided" }, 400);
    }

    if (!isTechTutorRequest(input)) {
      return jsonResponse({
        response: {
          answer: techOnlyRefusalMessage(),
          key_points: [],
          example: "",
        },
      });
    }

    // Prompt
    const systemPrompt = `
You are an expert technical tutor for an AI learning platform serving computer science, software engineering, data science, cybersecurity, AI/ML, cloud, DevOps, databases, networking, and related technical students.
Answer only technical questions and career-relevant questions for those fields.
If the request is unrelated to computing or technical learning, respond with a short polite refusal in the answer field and leave key_points and example empty.
Do not answer irrelevant, unsafe, or off-topic requests.
Return only valid JSON and no extra text.
`.trim();

    const prompt = `
User message: ${input}

Instructions:
- Accept greetings and respond them in respectable way.
- Give a helpful, accurate, and concise teaching response.
- Explain the concept clearly and professionally.
- Use the answer field for the main explanation.
- Include 2 to 5 short key points that reinforce the idea.
- Include one concrete example or scenario when appropriate.
- If the message is outside technical education, set the answer to a short refusal.

Return JSON in this exact shape:
{
  "answer": "Main response",
  "key_points": ["Point 1", "Point 2"],
  "example": "Concrete example or scenario"
}
`.trim();

    // AI call (⚠️ your endpoint still questionable)
    const aiRes = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("OLLAMA_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildJsonChatBody({
          systemPrompt,
          userPrompt: prompt,
          temperature: 0.35,
          topP: 0.9,
          repeatPenalty: 1.05,
          numPredict: 600,
          numCtx: 4096,
        })
      ),
    });

    const aiData = await aiRes.json();
    const response = parseJsonResponse(aiData);

    if (!response) {
      return jsonResponse({ error: "Invalid AI response" }, 500);
    }

    // Credit logic
    const evalCount = aiData?.eval_count || 500;
    const creditsRequired = calculateCreditCost(evalCount);

    if (profile.credits < creditsRequired) {
      return jsonResponse(
        { error: "Insufficient credits for this request" },
        402
      );
    }

    const newBalance = profile.credits - creditsRequired;

    await supabase
      .from("profiles")
      .update({ credits: newBalance })
      .eq("id", user.id);

    return jsonResponse({ response });

  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
