import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import {
  createImportedImageObjectPath,
  fetchImportImage,
  normalizeImportResult,
} from "./metadata.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const bucketId = "trip-media";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

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
    const authorization = request.headers.get("authorization") ?? "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { authorization } },
    });

    const userResponse = await supabase.auth.getUser();
    const user = userResponse.data.user;
    if (userResponse.error || !user) {
      throw new Error(
        userResponse.error?.message || "Sign in before importing images.",
      );
    }

    const body = await request.json();
    const tripId = typeof body.tripId === "string" ? body.tripId.trim() : "";
    const destinationId = typeof body.destinationId === "string"
      ? body.destinationId.trim()
      : "";
    if (!tripId || !destinationId) {
      throw new Error("Select a stop before importing images.");
    }

    const result = normalizeImportResult(body.result);
    const { bytes, contentType } = await fetchImportImage({
      imageUrl: result.imageUrl,
    });
    const objectPath = createImportedImageObjectPath({
      tripId,
      destinationId,
      title: result.title,
      contentType,
    });

    const uploadResponse = await supabase.storage.from(bucketId).upload(
      objectPath,
      bytes,
      {
        contentType,
        upsert: false,
      },
    );
    if (uploadResponse.error) {
      throw new Error(
        uploadResponse.error.message || "Unable to upload imported image.",
      );
    }

    const existingRows = await supabase
      .from("media_assets")
      .select("sort_order")
      .eq("trip_id", tripId)
      .eq("destination_id", destinationId)
      .is("activity_id", null);
    if (existingRows.error) {
      await supabase.storage.from(bucketId).remove([objectPath]);
      throw new Error(
        existingRows.error.message || "Unable to load media order.",
      );
    }

    const sortOrder = (existingRows.data ?? []).reduce(
      (maxOrder: number, row: { sort_order: number }) =>
        Math.max(maxOrder, row.sort_order),
      -1,
    ) + 1;

    const inserted = await supabase
      .from("media_assets")
      .insert({
        trip_id: tripId,
        destination_id: destinationId,
        activity_id: null,
        bucket_id: bucketId,
        object_path: objectPath,
        caption: result.title,
        credit: result.sourceName,
        sort_order: sortOrder,
        content_type: contentType,
        size_bytes: bytes.byteLength,
        uploaded_by: user.id,
      })
      .select("*")
      .single();
    if (inserted.error || !inserted.data) {
      await supabase.storage.from(bucketId).remove([objectPath]);
      throw new Error(
        inserted.error?.message || "Unable to save imported image.",
      );
    }

    return Response.json({ mediaAsset: inserted.data }, {
      headers: corsHeaders,
    });
  } catch (caught) {
    return Response.json(
      {
        error: caught instanceof Error
          ? caught.message
          : "Unable to import image.",
      },
      { status: 400, headers: corsHeaders },
    );
  }
});
