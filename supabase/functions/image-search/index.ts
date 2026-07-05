import { searchWebImages } from "./metadata.ts";

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
    const query = typeof body.query === "string" ? body.query : "";
    const context = body.context && typeof body.context === "object"
      ? body.context
      : {};

    const results = await searchWebImages({
      apiKey: Deno.env.get("SERPAPI_API_KEY") ?? "",
      query,
      context: {
        stopName: typeof context.stopName === "string" ? context.stopName : "",
        regionName: typeof context.regionName === "string"
          ? context.regionName
          : undefined,
        countryName: typeof context.countryName === "string"
          ? context.countryName
          : undefined,
        countryCode: typeof context.countryCode === "string"
          ? context.countryCode
          : undefined,
      },
    });

    return Response.json({ results }, { headers: corsHeaders });
  } catch (caught) {
    return Response.json(
      {
        error: caught instanceof Error
          ? caught.message
          : "Unable to search web images.",
      },
      { status: 400, headers: corsHeaders },
    );
  }
});
