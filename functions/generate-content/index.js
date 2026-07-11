import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./cors.js";

const BASE_CREDIT_COST = 5;
const TOKENS_PER_CREDIT = 10;

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

    const {
      lesson_id,
      course_title,
      module_title,
      lesson_title,
      lesson_position,
      module_position,
      complexity,
      goal
    } = await req.json();

    if (!lesson_id || !lesson_title) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    // Fetch Lesson + Module + Course
    const { data: existingLesson, error: lessonFetchError } = await supabase
      .from("lessons")
      .select(`
        id,
        module_id,
        title,
        status,
        content,
        modules (
          id,
          course_id,
          status
        )
      `)
      .eq("id", lesson_id)
      .single();

    if (lessonFetchError || !existingLesson) {
      return jsonResponse({ error: "Lesson not found" }, 404);
    }

    // Return Cached Lesson
    if (existingLesson.content) {
      return jsonResponse({
        lesson: {
          id: existingLesson.id,
          title: existingLesson.title,
          content: existingLesson.content,
          status: existingLesson.status,
        }
      });
    }

    // Prompt
    const userPrompt = `
Generate a structured lesson.

Course: ${course_title}
Module: ${module_title}
Lesson: ${lesson_title}
Lesson Order: ${lesson_position} in Module ${module_position}
Level: ${complexity}
Goal: ${goal}

Return JSON:
{
  "title": "",
  "content": [
    { "type": "text", "value": "" },
    { "type": "code", "value": "" },
    { "type": "example", "value": "" },
    { "type": "references", "value": "" }
  ],
  "summary": ""
}

Rules:
- clear explanation
- structured blocks
- no markdown
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

    let lesson;

    try {
      lesson = JSON.parse(match[0]);
    } catch {
      return jsonResponse({ error: "Malformed JSON from AI" }, 500);
    }

    if (!lesson?.content || !Array.isArray(lesson.content)) {
      return jsonResponse({ error: "Invalid lesson structure" }, 500);
    }

    // Calculate Credits
    const evalCount = aiData?.eval_count || 500;
    const creditsRequired = calculateCreditCost(evalCount);

    // Atomic Credit Deduction
    const { data: creditSuccess, error: creditError } = await supabase.rpc(
      "deduct_credits",
      {
        p_user_id: user.id,
        p_amount: creditsRequired,
      }
    );

    if (creditError || !creditSuccess) {
      return jsonResponse({ error: "Insufficient credits" }, 402);
    }

    // Update Lesson
    const { error: updateLessonError } = await supabase
      .from("lessons")
      .update({
        title: lesson.title || lesson_title,
        content: lesson.content,
        status: "in-progress",
        updated_at: new Date().toISOString(),
      })
      .eq("id", lesson_id);

    if (updateLessonError) {
      return jsonResponse({ error: updateLessonError.message }, 500);
    }

    // Update Module Status
    await supabase
      .from("modules")
      .update({
        status: "in-progress",
      })
      .eq("id", existingLesson.module_id);

    // Update Course Status
    const courseId = existingLesson.modules?.course_id;

    if (courseId) {
      await supabase
        .from("courses")
        .update({
          status: "in-progress",
        })
        .eq("id", courseId);
    }

    return jsonResponse({
      lesson_id,
      lesson,
    });

  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});