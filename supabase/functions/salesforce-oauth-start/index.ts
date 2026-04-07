import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// PKCE helpers
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the user
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

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;

    const { propertyId } = await req.json();
    if (!propertyId) {
      return new Response(JSON.stringify({ error: "propertyId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify property ownership
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: property } = await serviceClient
      .from("properties")
      .select("id")
      .eq("id", propertyId)
      .eq("user_id", userId)
      .single();

    if (!property) {
      return new Response(JSON.stringify({ error: "Property not found or not owned" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Credential lookup: linked org → any user org → env var
    // (per-property client_id columns are legacy and may be stale — skip them)
    const { data: sfSettings } = await serviceClient
      .from("salesforce_settings")
      .select("login_url, salesforce_org_id")
      .eq("property_id", propertyId)
      .maybeSingle();

    let clientId: string | null | undefined = null;
    let loginUrl = sfSettings?.login_url;

    // 1. Linked org credentials (most up-to-date)
    if (sfSettings?.salesforce_org_id) {
      const { data: org } = await serviceClient
        .from("salesforce_orgs")
        .select("client_id, login_url")
        .eq("id", sfSettings.salesforce_org_id)
        .maybeSingle();
      clientId = org?.client_id || null;
      loginUrl = loginUrl || org?.login_url;
    }

    // 2. Any existing org for this user (credential reuse across properties)
    if (!clientId) {
      const { data: existingOrg } = await serviceClient
        .from("salesforce_orgs")
        .select("client_id, login_url")
        .eq("user_id", userId)
        .not("client_id", "is", null)
        .limit(1)
        .maybeSingle();
      clientId = existingOrg?.client_id || null;
      loginUrl = loginUrl || existingOrg?.login_url;
    }

    // 3. Platform-level env var
    clientId = clientId || Deno.env.get("SALESFORCE_CLIENT_ID");
    loginUrl = loginUrl || "https://login.salesforce.com";

    if (!clientId) {
      return new Response(JSON.stringify({ error: "Salesforce integration not configured. Please enter your Connected App credentials." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate PKCE + CSRF
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const csrfToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Upsert settings row with CSRF token + code verifier
    const { error: upsertError } = await serviceClient
      .from("salesforce_settings")
      .upsert(
        {
          property_id: propertyId,
          pending_oauth_token: csrfToken,
          pending_oauth_expires_at: expiresAt,
          pending_code_verifier: codeVerifier,
        },
        { onConflict: "property_id" }
      );

    if (upsertError) {
      console.error("Error storing OAuth state:", upsertError);
      return new Response(JSON.stringify({ error: "Failed to initiate OAuth" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build Salesforce authorization URL with PKCE
    const redirectUri = `${supabaseUrl}/functions/v1/salesforce-oauth-callback`;
    const baseLoginUrl = loginUrl;
    const authUrl = new URL(`${baseLoginUrl}/services/oauth2/authorize`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", "api refresh_token openid");
    authUrl.searchParams.set("state", `${propertyId}:${csrfToken}`);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    return new Response(JSON.stringify({ url: authUrl.toString() }), {
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
