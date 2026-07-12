import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { buildJsonChatBody, parseJsonResponse } from "../_shared/llm.js";
import { deriveTechnicalFocus } from "../_shared/tech-domain.js";


const BASE_CREDIT_COST = 5;
const TOKENS_PER_CREDIT = 250;
const MAX_VARIABLE_COST = 4;

function calculateCreditCost(evalCount){
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

    const systemPrompt = `
You are a senior technical curriculum architect for a production AI learning platform.
You only design learning paths for technical fields: computer science, software engineering, data science, cybersecurity, AI/ML, cloud, DevOps, networking, databases, systems, mobile, and related engineering disciplines.
Never generate literature, arts, humanities, or non-technical subjects.
If the request is outside scope, return a valid JSON object with an \`error\` field and a concise \`message\` explaining that the platform supports only technical learning paths.
Return only valid JSON and no extra text.
`.trim();

    let userPrompt = "";
    let numPredict = 1600;
    let topP = 0.88;
    let temperature = 0.2;
    let repeatPenalty = 1.08;

    if (mode === "recommendation") {
      const { title, complexity, goal, time_commitment } = input;
      const technicalFocus = deriveTechnicalFocus([
        title,
        goal,
        time_commitment,
      ].filter(Boolean).join(" "));

      userPrompt = `
Create a career-ready learning roadmap for a technical student.

Topic: ${title}
Mapped technical focus: ${technicalFocus}
Current level: ${complexity}
Goal: ${goal}
Time commitment: ${time_commitment}

Requirements:
- Stay strictly within the closest technical specialization.
- Build a complete progression from fundamentals to advanced applied practice.
- Include 4 to 8 modules.
- Each module should have 4 to 6 lessons.
- Include foundations, hands-on practice, real-world application, projects, deployment or usage, and career readiness where relevant.
- Include one capstone or portfolio-ready project near the end.
- Make the roadmap strong enough that a learner can finish it without needing a separate syllabus.
- Module titles must be specific and progression-based.
- Module subtitles must clearly state the outcome of that module.
- Lesson titles must be short, concrete, and sequenced logically.
- Use beginner-friendly language when the level is beginner, but keep the curriculum professional and rigorous.

Return JSON in this shape:
{
  "id": "kebab-case-identifier",
  "iconName": "technology-related-icon-name",
  "title": "Readable course title",
  "subtitle": "One-sentence outcome-focused description",
  "status": "not-started",
  "progress": 0,
  "modules": [
    {
      "id": "m1",
      "title": "Module title",
      "subtitle": "Module outcome",
      "xp": 100,
      "time": "1h 30m",
      "status": "not-started",
      "lessons": [
        {
          "id": "l1",
          "title": "Lesson title",
          "status": "not-started"
        }
      ]
    }
  ]
}

Rules:
- Return valid JSON only.
- Do not include markdown fences, explanations, or commentary.
`.trim();
      numPredict = 1600;
    } else {
      const { prompt, complexity, goal, time_commitment } = input;
      const technicalFocus = deriveTechnicalFocus([
        prompt,
        goal,
        time_commitment,
      ].filter(Boolean).join(" "));

      userPrompt = `
Create a roadmap from the user's own technical prompt.

User request: ${prompt}
Mapped technical focus: ${technicalFocus}
Current level: ${complexity}
Goal: ${goal}
Time commitment: ${time_commitment}

Requirements:
- Interpret the prompt as a technical learning goal only.
- If the prompt is vague, choose the closest technical specialization that best fits the request.
- Build a complete progression from fundamentals to advanced applied practice.
- Include 4 to 8 modules.
- Each module should have 4 to 6 lessons.
- Include foundations, hands-on practice, real-world application, projects, deployment or usage, and career readiness where relevant.
- Include one capstone or portfolio-ready project near the end.
- Make the roadmap strong enough that a learner can finish it without needing a separate syllabus.
- Module titles must be specific and progression-based.
- Module subtitles must clearly state the outcome of that module.
- Lesson titles must be short, concrete, and sequenced logically.
- Use beginner-friendly language when the level is beginner, but keep the curriculum professional and rigorous.

Return JSON in this shape:
{
  "id": "kebab-case-identifier",
  "iconName": "technology-related-icon-name",
  "title": "Readable course title",
  "subtitle": "One-sentence outcome-focused description",
  "status": "not-started",
  "progress": 0,
  "modules": [
    {
      "id": "m1",
      "title": "Module title",
      "subtitle": "Module outcome",
      "xp": 100,
      "time": "1h 30m",
      "status": "not-started",
      "lessons": [
        {
          "id": "l1",
          "title": "Lesson title",
          "status": "not-started"
        }
      ]
    }
  ]
}

Rules:
- Return valid JSON only.
- Do not include markdown fences, explanations, or commentary.
`.trim();
      numPredict = 1600;
    }

    // AI call
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
          temperature,
          topP,
          repeatPenalty,
          numPredict,
          numCtx: 8192,
        })
      ),
    });

    const aiData = await aiRes.json();
    const roadmap = parseJsonResponse(aiData);

    if (!roadmap) {
      return jsonResponse({ error: "Invalid AI response" }, 500);
    }

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
