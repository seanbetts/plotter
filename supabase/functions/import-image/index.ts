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
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SupabaseTableClient = {
  from: (tableName: string) => any;
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
    if (!isUuid(tripId) || !isUuid(destinationId)) {
      throw new Error("Select a stop before importing images.");
    }

    const result = normalizeImportResult(body.result);

    await assertDestinationAccess(supabase, tripId, destinationId);
    const existingRows = await listExistingDestinationMediaSortOrders(
      supabase,
      tripId,
      destinationId,
    );

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
      throw new Error("Unable to upload imported image.");
    }

    let mediaAsset;
    try {
      mediaAsset = await insertMediaMetadataWithRetry(supabase, {
        tripId,
        destinationId,
        objectPath,
        caption: result.title,
        credit: result.sourceName,
        contentType,
        sizeBytes: bytes.byteLength,
        uploadedBy: user.id,
        existingRows,
      });
    } catch {
      await supabase.storage.from(bucketId).remove([objectPath]);
      throw new Error("Unable to save imported image.");
    }

    return Response.json({ mediaAsset }, {
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

function isUuid(value: string) {
  return uuidPattern.test(value);
}

async function assertDestinationAccess(
  supabase: SupabaseTableClient,
  tripId: string,
  destinationId: string,
) {
  const response = await supabase
    .from("destinations")
    .select("id")
    .eq("trip_id", tripId)
    .eq("id", destinationId)
    .maybeSingle();

  if (response.error || !response.data) {
    throw new Error("Select a stop before importing images.");
  }
}

async function listExistingDestinationMediaSortOrders(
  supabase: SupabaseTableClient,
  tripId: string,
  destinationId: string,
) {
  const response = await supabase
    .from("media_assets")
    .select("sort_order")
    .eq("trip_id", tripId)
    .eq("destination_id", destinationId)
    .is("activity_id", null);

  if (response.error) {
    throw new Error("Unable to save imported image.");
  }

  return response.data ?? [];
}

async function insertMediaMetadataWithRetry(
  supabase: SupabaseTableClient,
  input: {
    tripId: string;
    destinationId: string;
    objectPath: string;
    caption: string;
    credit: string;
    contentType: string;
    sizeBytes: number;
    uploadedBy: string;
    existingRows: { sort_order: number }[];
  },
) {
  let existingRows = input.existingRows;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sortOrder = existingRows.reduce(
      (maxOrder, row) => Math.max(maxOrder, row.sort_order),
      -1,
    ) + 1;

    const response = await supabase
      .from("media_assets")
      .insert({
        trip_id: input.tripId,
        destination_id: input.destinationId,
        activity_id: null,
        bucket_id: bucketId,
        object_path: input.objectPath,
        caption: input.caption,
        credit: input.credit,
        sort_order: sortOrder,
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
        uploaded_by: input.uploadedBy,
      })
      .select("*")
      .single();

    if (!response.error && response.data) {
      return response.data;
    }

    if (!isMediaSortOrderConflict(response.error?.message) || attempt === 2) {
      throw new Error("Unable to save imported image.");
    }

    existingRows = await listExistingDestinationMediaSortOrders(
      supabase,
      input.tripId,
      input.destinationId,
    );
  }

  throw new Error("Unable to save imported image.");
}

function isMediaSortOrderConflict(errorMessage: string | undefined) {
  if (!errorMessage) return false;

  return (
    errorMessage.includes("media_assets_trip_destination_sort_order_key") ||
    errorMessage.includes("media_assets_destination_owned_sort_order_key") ||
    errorMessage.includes("media_assets_activity_owned_sort_order_key") ||
    errorMessage.includes("duplicate key value")
  );
}
