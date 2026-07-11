import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./cors.js";

const BASE_CREDIT_COST = 3;
const TOKENS_PER_CREDIT = 10;

function calculateCreditCost(evalCount) {
  const variableCost = Math.ceil(evalCount / TOKENS_PER_CREDIT);
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

    // Prompt
    const prompt = `
You are an elite AI tutor...

Input:
${input}

Return JSON:
{
  "answer": "",
  "key_points": [],
  "example": "",
}
`;

    // AI call (⚠️ your endpoint still questionable)
    const aiRes = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("OLLAMA_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-oss:120b",
        stream: false,
        messages: [
          { role: "system", content: "Return JSON only." },
          { role: "user", content: prompt },
        ],
      }),
    });

    const aiData = await aiRes.json();
    const raw =
      aiData?.message?.content ||
      aiData?.choices?.[0]?.message?.content ||
      "";

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return jsonResponse({ error: "Invalid AI response" }, 500);
    }

    let response;
    try {
      response = JSON.parse(match[0]);
    } catch {
      return jsonResponse({ error: "Failed to parse AI response" }, 500);
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