import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await authClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

    const body = (await req.json().catch(() => ({}))) as {
      propertyId?: string | null;
      staleSeconds?: number;
    };

    const staleSeconds = clamp(Number(body.staleSeconds ?? 45), 10, 3600);
    const propertyId = body.propertyId ?? null;

    const serviceClient = createClient(supabaseUrl, serviceKey);
    let propertyIds: string[] = [];

    if (propertyId) {
      // Authorize against a single property.
      const [{ data: owns }, { data: isAgent }] = await Promise.all([
        authClient.rpc("user_owns_property", { property_uuid: propertyId, user_uuid: userId }),
        authClient.rpc("user_is_agent_for_property", { property_uuid: propertyId, user_uuid: userId }),
      ]);

      if (!owns && !isAgent) {
        // Gracefully return 0 instead of 403 — caller may have stale property selection
        console.warn("close-stale-conversations: user has no access to property", propertyId);
        return new Response(JSON.stringify({ ok: true, closedCount: 0, staleSeconds, propertyIds: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      propertyIds = [propertyId];
    } else {
      // Close stale conversations across all properties the user can access,
      // including co-owned properties via account_co_owners.
      const { data: ownerIds } = await serviceClient.rpc("get_account_owner_ids", { user_uuid: userId });
      const allOwnerIds: string[] = ownerIds ?? [userId];

      const { data: ownedProps, error: ownedErr } = await serviceClient
        .from("properties")
        .select("id")
        .in("user_id", allOwnerIds);

      if (ownedErr) {
        console.error("close-stale-conversations: failed to read owned properties", ownedErr);
      }

      const { data: agent, error: agentErr } = await serviceClient
        .from("agents")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (agentErr) {
        console.error("close-stale-conversations: failed to read agent", agentErr);
      }

      let assignedProps: Array<{ property_id: string }> = [];
      if (agent?.id) {
        const { data: assigned, error: assignedErr } = await serviceClient
          .from("property_agents")
          .select("property_id")
          .eq("agent_id", agent.id);

        if (assignedErr) {
          console.error("close-stale-conversations: failed to read property assignments", assignedErr);
        } else {
          assignedProps = assigned ?? [];
        }
      }

      const ids = [
        ...(ownedProps ?? []).map((p) => p.id as string),
        ...assignedProps.map((p) => p.property_id as string),
      ];

      propertyIds = Array.from(new Set(ids)).filter(Boolean);
    }

    if (propertyIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, closedCount: 0, staleSeconds, propertyIds: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const thresholdIso = new Date(Date.now() - staleSeconds * 1000).toISOString();

    const { data: updated, error: updateErr } = await serviceClient
      .from("conversations")
      .update({ status: "closed" })
      .in("property_id", propertyIds)
      .eq("status", "active")
      .lt("updated_at", thresholdIso)
      .select("id");

    if (updateErr) {
      console.error("close-stale-conversations: update failed", updateErr);
      return new Response(JSON.stringify({ error: "Failed to close stale conversations" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fire-and-forget: auto-export closed conversations to Salesforce
    const closedConvIds = (updated ?? []).map((c: any) => c.id);
    if (closedConvIds.length > 0) {
      for (const convId of closedConvIds) {
        try {
          // Get conversation details
          const { data: conv } = await serviceClient
            .from("conversations")
            .select("property_id, visitor_id")
            .eq("id", convId)
            .single();
          if (!conv) continue;

          const { data: sfSettings } = await serviceClient
            .from("salesforce_settings")
            .select("enabled, instance_url, access_token, auto_export_on_conversation_end")
            .eq("property_id", conv.property_id)
            .maybeSingle();

          if (sfSettings?.enabled && sfSettings?.auto_export_on_conversation_end && sfSettings?.instance_url && sfSettings?.access_token) {
            console.log("Auto-exporting stale-closed conversation", convId, "to Salesforce");
            fetch(`${supabaseUrl}/functions/v1/salesforce-export-leads`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                propertyId: conv.property_id,
                visitorIds: [conv.visitor_id],
                _serviceRoleExport: true,
              }),
            }).catch((e: any) => console.error("SF stale-close auto-export error:", e));
          }
        } catch (sfErr) {
          console.error("Error checking SF auto-export for stale conv:", sfErr);
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        closedCount: (updated ?? []).length,
        staleSeconds,
        propertyIds,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("close-stale-conversations error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
