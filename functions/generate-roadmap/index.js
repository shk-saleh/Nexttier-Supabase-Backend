import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./cors.js";


const BASE_CREDIT_COST = 5;
const TOKENS_PER_CREDIT = 20; // ~20-30 credits for 1000-1500 tokens

function calculateCreditCost(evalCount){
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

    // Auth user
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const user = userData.user;

    // Check credits
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (!profile || profile.credits <= 0) {
      return jsonResponse({ error: "No credits left" }, 403);
    }

    const body = await req.json();
    const { mode, input } = body;

    if (!mode || !input) {
      return jsonResponse({ error: "Invalid input provided" }, 400);
    }

    // Prompt
    let userPrompt = "";

    if (mode === "recommendation") {
      const { title, complexity, goal, time_commitment } = input;

      userPrompt = `Generate a structured learning roadmap.

Course: ${title}
Level: ${complexity}
Goal: ${goal}
Time: ${time_commitment}

Return JSON:
{
      id: "python-ds",
      iconName: "python",
      title: "Python for Data Science",
      subtitle: "Master core libraries and analytical workflows for modern data science.",
      status: "not-started",
      progress: 0,
      modules: [
        {
          id: "m1",
          title: "Module 1: Python Basics",
          subtitle: "Syntax, variables, and primitive data types.",
          xp: 100,
          time: "1h 30m",
          status: "not-started",
          lessons: [
            { id: "l1", title: "Variables & Data Types", status: "not-started" },
          ],
        }
      ]
}

Rules:
- 4 to 8 modules
- valid JSON only`;
    } else {
      const { prompt, complexity, goal, time_commitment } = input;

      userPrompt = `Generate a structured learning roadmap.

User request: ${prompt}
Level: ${complexity}
Goal: ${goal}
Time: ${time_commitment}

Return JSON:
{
      id: "",
      iconName: "python",
      title: "Python for Data Science",
      subtitle: "Master core libraries and analytical workflows for modern data science.",
      status: "not-started",
      progress: 0,
      modules: [
        {
          id: "",
          title: "Module 1: Python Basics",
          subtitle: "Syntax, variables, and primitive data types.",
          xp: 100,
          time: "1h 30m",
          status: "not-started",
          lessons: [
            { id: "", title: "Variables & Data Types", status: "not-started" },
          ],
        }
      ]
}

Rules:
- 4 to 8 modules
- valid JSON only`;
    }

    // AI call
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
        options: { temperature: 0.3 },
      }),
    });

    const aiData = await aiRes.json();
    const raw = aiData?.message?.content || "";
    const match = raw.match(/\{[\s\S]*\}/);

    if (!match) {
      return jsonResponse({ error: "Invalid AI response" }, 500);
    }

    const roadmap = JSON.parse(match[0]);

    if (!roadmap.title || !Array.isArray(roadmap.modules)) {
      return jsonResponse({ error: "Failed to parse AI response" }, 500);
    }

    // Calculate Dynamic Credit Cost
    const evalCount = aiData?.eval_count || 1000; // Fallback if not provided
    const creditsRequired = calculateCreditCost(evalCount);

    if (profile.credits < creditsRequired) {
      return jsonResponse({ error: "Insufficient credits for this request" }, 402 );
    }

    // Insert Course
    const { data: course } = await supabase
      .from("courses")
      .insert({
        user_id: user.id,
        title: roadmap.title,
        short_description: roadmap.subtitle,
        status: "not-started",
        progress_percentage: 0,
        total_modules: roadmap.modules.length,
        completed_modules: 0,
      })
      .select()
      .single();

    // Insert Modules + Lessons
    for (let i = 0; i < roadmap.modules.length; i++) {
      const m = roadmap.modules[i];

      const { data: module, error: moduleError  } = await supabase
        .from("modules")
        .insert({
          course_id: course.id,
          title: m.title,
          short_description: m.subtitle,
          xp_reward: m.xp || 50,
          estimated_minutes: 60,
          position: i + 1,
          status: "not-started",
        })
        .select()
        .single();

      if (moduleError || !module) {
        throw new Error(moduleError?.message || "Module insert failed");
      }

      for (let j = 0; j < m.lessons.length; j++) {
        const l = m.lessons[j];

        const { error: lessonError } = await supabase.from("lessons").insert({
          module_id: module.id,
          title: l.title,
          position: j + 1,
          status: "not-started",
          content: null,
          quiz: null,
          challenge: null,
          xp_reward: 10
        });

        if (lessonError) {
          throw new Error(lessonError.message);
        }
      }
    }

    // Deduct Credits
    const newBalance = profile.credits - creditsRequired;

    await supabase
      .from("profiles")
      .update({ credits: newBalance })
      .eq("id", user.id);

    return jsonResponse({ success: true, course_id: course.id, roadmap: course });

  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
  
});