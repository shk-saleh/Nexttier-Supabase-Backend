import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "../_shared/cors.ts";

serve(async (req) => {
  //  Handle preflight FIRST
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );

    // Auth
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);

    if (!userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const user = userData.user;

    // Refresh credits if a new day has started
    const { error: resetError } = await supabase.rpc("refresh_daily_credits", {
      p_user_id: user.id,
    });

    if (resetError) {
      return jsonResponse({ error: resetError.message }, 500);
    }

    // Profile
    const { data: profile } = await supabase
      .from("profiles")
      .select(
        "id, full_name, email, avatar_url, credits, xp, streak, current_level",
      )
      .eq("id", user.id)
      .single();

    // Active Courses (basic info only)
    const { data: courses } = await supabase
      .from("courses")
      .select(
        `
        id,
        title,
        short_description,
        progress_percentage,
        status,
        total_modules,
        completed_modules,
        created_at
      `,
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);

    // Simple stats
    const totalCourses = courses?.length || 0;
    const activeCourses =
      courses?.filter((c) => c.status !== "completed") || [];
    const completedCourses =
      courses?.filter((c) => c.status === "completed") || [];

    return jsonResponse({
      profile,
      stats: {
        total_courses: totalCourses,
        active_courses: activeCourses.length,
        completed_courses: completedCourses.length,
      },
      courses: (courses || []).map((course) => ({
        ...course,
        progress: course.progress_percentage || 0,
      })),
    });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
