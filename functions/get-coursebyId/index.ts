import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./cors.ts";

function mapLessonStatus(lesson, progressMap) {
  if (progressMap[lesson.id]?.is_completed) return "completed";
  return lesson.status || "not-started";
}

function mapModuleStatus(module, lessons) {
  if (lessons.length === 0) return module.status || "not-started";
  if (lessons.every((lesson) => lesson.status === "completed")) return "completed";
  if (
    lessons.some(
      (lesson) => lesson.status === "completed" || lesson.status === "in-progress",
    )
  ) {
    return "in-progress";
  }
  return module.status || "not-started";
}

serve(async (req) => {
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

    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);

    if (!userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const userId = userData.user.id;
    const url = new URL(req.url);
    const courseId = url.pathname.split("/").pop();

    if (!courseId) {
      return jsonResponse({ error: "Missing course id" }, 400);
    }

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
        modules (
          id,
          title,
          short_description,
          xp_reward,
          estimated_minutes,
          position,
          status,
          lessons (
            id,
            title,
            content,
            quiz,
            position,
            status,
            xp_reward
          )
        )
      `)
      .eq("id", courseId)
      .eq("user_id", userId)
      .single();

    if (error) throw error;

    const lessonIds = (data.modules ?? []).flatMap((module) =>
      (module.lessons ?? []).map((lesson) => lesson.id),
    );

    let progressMap = {};

    if (lessonIds.length > 0) {
      const { data: progressRows } = await supabase
        .from("lesson_progress")
        .select("lesson_id, is_completed, xp_earned, quiz_score")
        .eq("user_id", userId)
        .in("lesson_id", lessonIds);

      progressMap = Object.fromEntries(
        (progressRows ?? []).map((row) => [row.lesson_id, row]),
      );
    }

    const completedLessonCount = Object.values(progressMap).filter(
      (row) => row.is_completed,
    ).length;
    const totalLessons = lessonIds.length;
    const computedProgress =
      totalLessons > 0
        ? Math.round((completedLessonCount / totalLessons) * 100)
        : 0;

    const modules = (data.modules ?? [])
      .map((module) => {
        const lessons = (module.lessons ?? [])
          .map((lesson) => ({
            ...lesson,
            status: mapLessonStatus(lesson, progressMap),
            xp_reward: lesson.xp_reward ?? 10,
          }))
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

        return {
          ...module,
          subtitle: module.short_description,
          xp: module.xp_reward ?? 0,
          status: mapModuleStatus(module, lessons),
          lessons,
        };
      })
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    const completedModules = modules.filter(
      (module) => module.status === "completed",
    ).length;
    const progress = computedProgress;
    const courseCompleted =
      totalLessons > 0 && completedLessonCount === totalLessons;

    if (
      progress !== (data.progress_percentage ?? 0) ||
      completedModules !== (data.completed_modules ?? 0)
    ) {
      await supabase
        .from("courses")
        .update({
          progress_percentage: progress,
          completed_modules: completedModules,
          total_modules: modules.length,
          status: courseCompleted ? "completed" : completedLessonCount > 0 ? "in-progress" : data.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", courseId)
        .eq("user_id", userId);
    }

    return jsonResponse({
      course: {
        id: data.id,
        slug: String(data.id),
        title: data.title,
        short_description: data.short_description,
        subtitle: data.short_description,
        status: courseCompleted ? "completed" : completedLessonCount > 0 ? "in-progress" : data.status,
        progress,
        total_modules: data.total_modules || modules.length,
        completed_modules: completedModules,
        modules,
      },
    });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
