import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "../_shared/cors.ts";

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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: "Invalid user" }, 401 );
    }

    const { interests, learning_style, time_commitment, goal, onboarding_completed } = await req.json();

    const { error } = await supabase
      .from("user_preferences")
      .upsert({
        user_id: user.id,
        interests,
        learning_style,
        time_commitment,
        goal,
        onboarding_completed,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id"
    });

    if (error) {
      return jsonResponse({ error: error.message }, 500 );
    }

    return jsonResponse({ success: true });

  } catch (err) {
    return jsonResponse({ error: err.message }, 500 );
  }
});
