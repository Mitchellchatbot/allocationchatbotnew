import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;
    const { sourcePropertyId } = await req.json();

    if (!sourcePropertyId) {
      return new Response(JSON.stringify({ error: "sourcePropertyId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Verify source property is owned by user
    const { data: sourceProp } = await serviceClient
      .from("properties")
      .select("id")
      .eq("id", sourcePropertyId)
      .eq("user_id", userId)
      .single();

    if (!sourceProp) {
      return new Response(JSON.stringify({ error: "Source property not found or not owned" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read source salesforce_settings
    const { data: sourceSettings } = await serviceClient
      .from("salesforce_settings")
      .select("access_token, refresh_token, instance_url, token_expires_at, client_id, client_secret, login_url, enabled")
      .eq("property_id", sourcePropertyId)
      .single();

    if (!sourceSettings?.instance_url) {
      return new Response(JSON.stringify({ error: "Source property has no active Salesforce connection" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all other properties owned by this user
    const { data: allProperties } = await serviceClient
      .from("properties")
      .select("id")
      .eq("user_id", userId)
      .neq("id", sourcePropertyId);

    if (!allProperties || allProperties.length === 0) {
      return new Response(JSON.stringify({ updated: 0, message: "No other properties found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let updated = 0;
    for (const prop of allProperties) {
      const { error: upsertError } = await serviceClient
        .from("salesforce_settings")
        .upsert(
          {
            property_id: prop.id,
            access_token: sourceSettings.access_token,
            refresh_token: sourceSettings.refresh_token,
            instance_url: sourceSettings.instance_url,
            token_expires_at: sourceSettings.token_expires_at,
            client_id: sourceSettings.client_id,
            client_secret: sourceSettings.client_secret,
            login_url: sourceSettings.login_url,
            enabled: true,
          },
          { onConflict: "property_id" }
        );

      if (!upsertError) {
        updated++;
      } else {
        console.error(`Failed to upsert for ${prop.id}:`, upsertError);
      }
    }

    return new Response(JSON.stringify({ updated, total: allProperties.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
