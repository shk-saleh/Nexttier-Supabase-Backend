import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./cors.ts";

serve(async (req) => {
    
  //  Handle preflight FIRST
  const cors = handleCors(req);
  if (cors) return cors;
  
  try {

    if (req.method === "OPTIONS") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    if (req.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );

    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);

    if (!userData?.user) {
     return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const userId = userData.user.id;

    const { data, error } = await supabase
      .from("courses")
      .select(`
        id,
        title,
        short_description,
        status,
        progress_percentage,
        total_modules,
        completed_modules,
        created_at
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const courses = data.map((course) => ({
      id: course.id,
      slug: String(course.id),
      title: course.title,
      short_description: course.short_description,
      status: course.status,
      progress: course.progress_percentage || 0,
      total_modules: course.total_modules || 0,
      completed_modules: course.completed_modules || 0,
    }));

    return jsonResponse({courses});

  } catch (err) {
     return jsonResponse({ error: err.message }, 500);
  }
});