import { fetchLinkPreview } from "./metadata.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed." },
      { status: 405, headers: corsHeaders },
    );
  }

  try {
    const body = await request.json();
    const url = typeof body.url === "string" ? body.url : "";
    const preview = await fetchLinkPreview(url);

    return Response.json(preview, { headers: corsHeaders });
  } catch (caught) {
    return Response.json(
      {
        error: caught instanceof Error
          ? caught.message
          : "Unable to fetch link preview.",
      },
      { status: 400, headers: corsHeaders },
    );
  }
});
