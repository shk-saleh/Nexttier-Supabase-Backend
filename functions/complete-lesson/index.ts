import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "../_shared/cors.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") {
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

    const user = userData.user;
    const { lesson_id, quiz_score = 0, xp_earned = 0 } = await req.json();

    if (!lesson_id) {
      return jsonResponse({ error: "lesson_id is required" }, 400);
    }

    const { data: lesson, error: lessonError } = await supabase
      .from("lessons")
      .select(`
        id,
        module_id,
        position,
        modules (
          id,
          course_id,
          position
        )
      `)
      .eq("id", lesson_id)
      .single();

    if (lessonError || !lesson) {
      return jsonResponse({ error: "Lesson not found" }, 404);
    }

    const moduleId = lesson.module_id;
    const moduleRow = Array.isArray(lesson.modules)
      ? lesson.modules[0]
      : lesson.modules;

    if (!moduleRow?.course_id) {
      return jsonResponse({ error: "Course not found for lesson" }, 404);
    }

    const courseId = moduleRow.course_id;
    const modulePosition = moduleRow.position ?? 0;

    const { data: existingProgress } = await supabase
      .from("lesson_progress")
      .select("id, is_completed")
      .eq("user_id", user.id)
      .eq("lesson_id", lesson_id)
      .maybeSingle();

    if (existingProgress?.is_completed) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("xp, streak")
        .eq("id", user.id)
        .single();

      const { data: course } = await supabase
        .from("courses")
        .select("id, progress_percentage, completed_modules, total_modules, status")
        .eq("id", courseId)
        .eq("user_id", user.id)
        .single();

      return jsonResponse({
        success: true,
        already_completed: true,
        new_xp: profile?.xp ?? 0,
        course: course
          ? {
              ...course,
              slug: String(course.id),
              progress: course.progress_percentage ?? 0,
            }
          : null,
      });
    }

    const { error: progressError } = await supabase
      .from("lesson_progress")
      .upsert(
        {
          user_id: user.id,
          lesson_id,
          is_completed: true,
          quiz_score,
          xp_earned,
          completed_at: new Date().toISOString(),
        },
        { onConflict: "user_id,lesson_id" },
      );

    if (progressError) {
      const { error: insertError } = await supabase
        .from("lesson_progress")
        .insert({
          user_id: user.id,
          lesson_id,
          is_completed: true,
          quiz_score,
          xp_earned,
          completed_at: new Date().toISOString(),
        });

      if (insertError) {
        const { error: updateError } = await supabase
          .from("lesson_progress")
          .update({
            is_completed: true,
            quiz_score,
            xp_earned,
            completed_at: new Date().toISOString(),
          })
          .eq("user_id", user.id)
          .eq("lesson_id", lesson_id);

        if (updateError) {
          return jsonResponse({ error: updateError.message }, 500);
        }
      }
    }

    await supabase
      .from("lessons")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", lesson_id);

    if (xp_earned > 0) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("xp")
        .eq("id", user.id)
        .single();

      await supabase
        .from("profiles")
        .update({ xp: (profile?.xp ?? 0) + Number(xp_earned) })
        .eq("id", user.id);
    }

    const { data: moduleLessons } = await supabase
      .from("lessons")
      .select("id, position")
      .eq("module_id", moduleId)
      .order("position", { ascending: true });

    const moduleLessonIds = (moduleLessons ?? []).map((item) => item.id);

    const { data: completedInModule } = await supabase
      .from("lesson_progress")
      .select("lesson_id")
      .eq("user_id", user.id)
      .eq("is_completed", true)
      .in("lesson_id", moduleLessonIds);

    const completedModuleCount = completedInModule?.length ?? 0;
    const totalModuleLessons = moduleLessonIds.length;
    const moduleCompleted =
      totalModuleLessons > 0 && completedModuleCount === totalModuleLessons;

    await supabase
      .from("modules")
      .update({
        status: moduleCompleted ? "completed" : "in-progress",
        completed_at: moduleCompleted ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", moduleId);

    const currentLessonIndex = (moduleLessons ?? []).findIndex(
      (item) => item.id === lesson_id,
    );

    if (!moduleCompleted && currentLessonIndex !== -1) {
      const nextLesson = moduleLessons[currentLessonIndex + 1];
      if (nextLesson) {
        await supabase
          .from("lessons")
          .update({ status: "in-progress", updated_at: new Date().toISOString() })
          .eq("id", nextLesson.id);
      }
    }

    if (moduleCompleted) {
      const { data: nextModule } = await supabase
        .from("modules")
        .select("id")
        .eq("course_id", courseId)
        .gt("position", modulePosition)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (nextModule) {
        await supabase
          .from("modules")
          .update({
            status: "in-progress",
            updated_at: new Date().toISOString(),
          })
          .eq("id", nextModule.id);

        const { data: firstNextLesson } = await supabase
          .from("lessons")
          .select("id")
          .eq("module_id", nextModule.id)
          .order("position", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (firstNextLesson) {
          await supabase
            .from("lessons")
            .update({
              status: "in-progress",
              updated_at: new Date().toISOString(),
            })
            .eq("id", firstNextLesson.id);
        }
      }
    }

    const { data: courseModules } = await supabase
      .from("modules")
      .select("id")
      .eq("course_id", courseId);

    const courseModuleIds = (courseModules ?? []).map((item) => item.id);

    const { data: courseLessons } = await supabase
      .from("lessons")
      .select("id")
      .in("module_id", courseModuleIds);

    const courseLessonIds = (courseLessons ?? []).map((item) => item.id);
    const totalLessons = courseLessonIds.length;

    const { data: completedLessonsData } = await supabase
      .from("lesson_progress")
      .select("lesson_id")
      .eq("user_id", user.id)
      .eq("is_completed", true)
      .in("lesson_id", courseLessonIds);

    const completedLessons = completedLessonsData?.length ?? 0;
    const progressPercentage =
      totalLessons > 0
        ? Math.round((completedLessons / totalLessons) * 100)
        : 0;

    const { data: allModules } = await supabase
      .from("modules")
      .select("id, status")
      .eq("course_id", courseId);

    const completedModulesCount = (allModules ?? []).filter(
      (item) => item.status === "completed",
    ).length;

    const courseCompleted =
      totalLessons > 0 && completedLessons === totalLessons;

    const { data: updatedCourse, error: courseUpdateError } = await supabase
      .from("courses")
      .update({
        progress_percentage: progressPercentage,
        completed_modules: completedModulesCount,
        total_modules: allModules?.length ?? 0,
        status: courseCompleted ? "completed" : "in-progress",
        completed_at: courseCompleted ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", courseId)
      .eq("user_id", user.id)
      .select("id, title, short_description, progress_percentage, completed_modules, total_modules, status")
      .single();

    if (courseUpdateError) {
      return jsonResponse({ error: courseUpdateError.message }, 500);
    }

    const { data: updatedProfile } = await supabase
      .from("profiles")
      .select("xp, streak")
      .eq("id", user.id)
      .single();

    return jsonResponse({
      success: true,
      xp_earned,
      new_xp: updatedProfile?.xp ?? 0,
      streak: updatedProfile?.streak ?? 0,
      module_unlocked: moduleCompleted,
      course_complete: courseCompleted,
      course: updatedCourse
        ? {
            ...updatedCourse,
            slug: String(updatedCourse.id),
            progress: updatedCourse.progress_percentage ?? 0,
          }
        : null,
      module: {
        id: moduleId,
        status: moduleCompleted ? "completed" : "in-progress",
        completed: moduleCompleted,
      },
      lesson: {
        id: lesson_id,
        status: "completed",
      },
    });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
