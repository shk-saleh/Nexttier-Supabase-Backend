import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { buildJsonChatBody, parseJsonResponse } from "../_shared/llm.js";
import { deriveTechnicalFocus } from "../_shared/tech-domain.js";

interface RecommendCoursesRequest {
  interests?: string[];
  learning_style?: string[];
  time_commitment?: string;
  goal?: string;
}

interface CourseRecommendation {
  title: string;
  short_description: string;
  duration: string;
  demand: string;
  complexity: string;
  slug: string;
}

Deno.serve(async (req: Request) => {
  try {
    const corsResponse = handleCors(req);
    if (corsResponse) return corsResponse;

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { data: userData, error: authError } = await supabase.auth.getUser(
      token,
    );

    if (authError || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const requestBody: RecommendCoursesRequest & { learning_styles?: string[] } = await req.json();
    const interests = requestBody.interests ?? [];
    const learning_style = requestBody.learning_style ?? requestBody.learning_styles ?? [];
    const time_commitment = requestBody.time_commitment;
    const goal = requestBody.goal;

    if (!interests?.length || !goal) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    const combinedProfile = [
      interests.join(", "),
      learning_style?.join(", ") || "",
      time_commitment || "",
      goal || "",
    ].join(" ");
    const technicalFocus = deriveTechnicalFocus(combinedProfile);

    const systemPrompt = `
You are an elite technical curriculum strategist for a production AI learning platform.
Recommend only technical learning paths for computer science, software engineering, data science, cybersecurity, AI/ML, cloud, DevOps, networking, databases, systems, mobile, and related engineering disciplines.
Do not recommend literature, arts, humanities, or other non-technical topics.
If the request is outside scope, return a valid JSON object with an \`error\` field and a concise \`message\` explaining that the platform supports only technical learning paths.
Return only valid JSON and no extra text.
`.trim();

    const userPrompt = `
Create exactly 3 course recommendations for a tech student.

User profile:
- Interests: ${interests.join(", ")}
- Learning style: ${learning_style?.join(", ") || "not specified"}
- Time commitment: ${time_commitment}
- Goal: ${goal}
- Technical focus to prioritize: ${technicalFocus}

Requirements:
- Stay strictly within technical fields.
- Choose courses that feel practical, modern, and employable.
- Make each recommendation distinct so the three options cover different but related paths.
- Keep titles short, specific, and professional.
- Keep the short description focused on the career or skill outcome.
- Make the duration realistic for the learner's time commitment.
- Use the demand and complexity values exactly as provided in the schema.
- Output valid JSON only.

Return this exact shape:
[
  {
    "title": "2-4 word course title",
    "short_description": "A concise outcome-focused explanation of why this path matters",
    "duration": "4-6 weeks",
    "demand": "low | medium | high",
    "complexity": "beginner | intermediate | advanced",
    "slug": "kebab-case-title"
  }
]
`.trim();

    const ollamaApiKey = Deno.env.get("OLLAMA_API_KEY");
    if (!ollamaApiKey) {
      return jsonResponse({ error: "AI service not configured" }, 500);
    }

    const aiRes = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ollamaApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildJsonChatBody({
          systemPrompt,
          userPrompt,
          temperature: 0.2,
          topP: 0.85,
          repeatPenalty: 1.08,
          numPredict: 1024,
          numCtx: 4096,
        })
      ),
    });

    const aiData = await aiRes.json();
    const parsed = parseJsonResponse(aiData);

    if (!parsed || !Array.isArray(parsed)) {
      return jsonResponse({ error: "Invalid AI response" }, 500);
    }

    let recommendations: CourseRecommendation[];
    try {
      recommendations = parsed as CourseRecommendation[];
    } catch {
      return jsonResponse({ error: "Malformed JSON from AI" }, 500);
    }

    return jsonResponse({ recommendations });
  } catch (error: unknown) {
    const message = error instanceof Error
      ? error.message
      : "Internal server error";

    return jsonResponse({ error: message }, 500);
  }
});
