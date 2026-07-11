import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./cors.js";

const BASE_CREDIT_COST = 3;
const TOKENS_PER_CREDIT = 8;

function calculateCreditCost(evalCount) {
  const variableCost = Math.ceil(evalCount / TOKENS_PER_CREDIT);
  return BASE_CREDIT_COST + variableCost;
}

serve(async (req) => {

  // Handle CORS
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
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");

    const { data: userData } = await supabase.auth.getUser(token);

    if (!userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const user = userData.user;

    const { lesson_id } = await req.json();

    if (!lesson_id) {
      return jsonResponse({ error: "Missing lesson_id" }, 400);
    }

    // Fetch lesson
    const { data: lessonData } = await supabase
      .from("lessons")
      .select("id, title, content, quiz")
      .eq("id", lesson_id)
      .single();

    if (!lessonData) {
      return jsonResponse({ error: "Lesson not found" }, 404);
    }

    // Cache check
    if (lessonData.quiz) {
      return jsonResponse({ quiz: lessonData.quiz });
    }

    if (!lessonData.content) {
      return jsonResponse(
        { error: "Lesson content not generated yet" },
        400
      );
    }

    // Prompt
    const userPrompt = `
Generate a quiz based on this lesson.

Lesson Title: ${lessonData.title}

Content:
${JSON.stringify(lessonData.content)}

Return JSON:
{
  "quiz": [
    {
      "question": "",
      "options": ["", "", "", ""],
      "correctIndex": 0
    }
  ]
}

Rules:
- 3 to 5 questions
- 4 options each
- only one correct answer
- valid JSON only
`;

    // AI Call
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
          { role: "system", content: "JSON only" },
          { role: "user", content: userPrompt },
        ],
        options: {
          temperature: 0.3,
        },
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

    let parsed;

    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return jsonResponse({ error: "Malformed JSON from AI" }, 500);
    }

    const quiz = parsed?.quiz;

    if (!Array.isArray(quiz) || quiz.length === 0) {
      return jsonResponse({ error: "Invalid quiz structure" }, 500);
    }

    // Credit Calculation
    const evalCount = aiData?.eval_count || 500;
    const creditsRequired = calculateCreditCost(evalCount);

    // Atomic Credit Deduction
    const { data: creditSuccess, error: creditError } =
      await supabase.rpc("deduct_credits", {
        p_user_id: user.id,
        p_amount: creditsRequired,
      });

    if (creditError || !creditSuccess) {
      return jsonResponse({ error: "Insufficient credits" }, 402);
    }

    // Store Quiz
    const { error: updateError } = await supabase
      .from("lessons")
      .update({
        quiz,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lesson_id);

    if (updateError) {
      return jsonResponse({ error: updateError.message }, 500);
    }

    return jsonResponse({ quiz });

  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});