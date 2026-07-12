import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { buildJsonChatBody, parseJsonResponse } from "../_shared/llm.js";

const BASE_CREDIT_COST = 4;
const TOKENS_PER_CREDIT = 250;
const MAX_VARIABLE_COST = 6;

function calculateCreditCost(evalCount) {
  const variableCost = Math.min(MAX_VARIABLE_COST, Math.ceil(evalCount / TOKENS_PER_CREDIT));
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
    const systemPrompt = `
You are a senior technical instructor and curriculum writer for an AI learning platform.
Write only for technical topics such as computer science, software engineering, data science, cybersecurity, AI/ML, cloud, DevOps, networking, databases, systems, and mobile development.
Teach in a production-quality style: clear, rigorous, practical, and comprehensive.
Every lesson must include at least one real-world example and one case study or scenario.
Explain concepts in a way that a motivated learner can understand without needing an external source.
Avoid filler, repetition, and vague generalities.
Return only valid JSON and no extra text.
`.trim();

    const userPrompt = `
Generate a comprehensive lesson.

Course: ${course_title}
Module: ${module_title}
Lesson: ${lesson_title}
Lesson order: ${lesson_position} in module ${module_position}
Level: ${complexity}
Goal: ${goal}

Teaching requirements:
- Explain the concept from first principles.
- Include prerequisites or assumed knowledge.
- Break the concept into clear sections.
- Include at least one real-world example.
- Include at least one real case study or scenario.
- Include practical implications, common mistakes, and what to watch out for.
- Include a code block only when it genuinely helps.
- Make the lesson detailed enough that the student could learn the concept completely from this lesson alone.
- Keep the tone instructional and professional.
- Use plain language, but do not oversimplify.

Return JSON in this exact shape:
{
  "title": "Lesson title",
  "content": [
    { "type": "text", "value": "## Overview\\n\\n..." },
    { "type": "text", "value": "## Why It Matters\\n\\n..." },
    { "type": "text", "value": "## Core Concept\\n\\n..." },
    { "type": "example", "value": "A real-world example with concrete details." },
    { "type": "text", "value": "## Case Study\\n\\nA realistic scenario that shows the concept in action." },
    { "type": "text", "value": "## Common Mistakes\\n\\n- ..." },
    { "type": "code", "value": "..." },
    { "type": "references", "value": "## Further Study\\n\\n- Related technical topics to revisit" }
  ],
  "summary": "One-paragraph takeaway"
}

Rules:
- Return valid JSON only.
- Do not use markdown fences outside the JSON string values.
- Do not produce short or shallow content.
`.trim();

    // AI Call
    const aiRes = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("OLLAMA_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildJsonChatBody({
          systemPrompt,
          userPrompt,
          temperature: 0.3,
          topP: 0.9,
          repeatPenalty: 1.08,
          numPredict: 2048,
          numCtx: 6144,
        })
      ),
    });

    const aiData = await aiRes.json();
    const lesson = parseJsonResponse(aiData);

    if (!lesson) {
      return jsonResponse({ error: "Invalid AI response" }, 500);
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
