import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./cors.ts";

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

    const {
      interests,
      learning_style,
      time_commitment,
      goal,
    }: RecommendCoursesRequest = await req.json();

    if (!interests?.length || !goal) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    const prompt = `
You are an AI that recommends tech learning paths.

User profile:
- Interests: ${interests.join(", ")}
- Learning Style: ${learning_style?.join(", ") || "not specified"}
- Time Commitment: ${time_commitment}
- Goal: ${goal}

Return EXACTLY 3 course recommendations in JSON format:

[
  {
    "title": "",
    "short_description": "",
    "duration": "e.g. 4-6 weeks",
    "demand": "low | medium | high",
    "complexity": "beginner | intermediate | advanced",
    "slug": "kebab-case-title"
  }
]

Rules:
- Title should be 2-3 word only 
- Keep descriptions under 30 words (It should be basically a "why to use" that course)
- Output valid JSON ONLY
`;

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
      body: JSON.stringify({
        model: "gpt-oss:120b",
        stream: false,
        messages: [
          { role: "system", content: "JSON only" },
          { role: "user", content: prompt },
        ],
        options: { temperature: 0.3 },
      }),
    });

    const aiData = await aiRes.json();
    const raw = aiData?.message?.content || "";

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) {
      return jsonResponse({ error: "Invalid AI response" }, 500);
    }

    let recommendations: CourseRecommendation[];
    try {
      recommendations = JSON.parse(match[0]) as CourseRecommendation[];
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
