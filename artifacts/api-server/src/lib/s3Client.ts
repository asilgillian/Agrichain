import { S3Client } from "@aws-sdk/client-s3";

// Generic S3-compatible client. Works with real AWS S3 (leave S3_ENDPOINT
// unset), Cloudflare R2, Supabase Storage, Backblaze B2, MinIO, or anything
// else that speaks the S3 API — set S3_ENDPOINT to that provider's endpoint.
//
// This replaces the previous implementation, which only worked on Replit: it
// exchanged tokens with Replit's local credential-broker sidecar
// (http://127.0.0.1:1106) for short-lived Google Cloud Storage credentials.
// That sidecar is a Replit-only service — it doesn't exist on Bolt, on any
// other host, or on your own machine — so every call failed outside Replit.
export const region = process.env.S3_REGION || "auto";
export const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true";

export const s3Client = new S3Client({
  region,
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle,
  credentials:
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined, // falls back to the default AWS credential chain (env/role/etc.)
});

// Stand-in for @google-cloud/storage's `File` handle. Everything downstream
// (objectAcl.ts, routes/storage.ts) only ever needed a bucket + key pair, not
// the GCS SDK's richer object — so this is all that's left to carry around.
export interface ObjectHandle {
  bucket: string;
  key: string;
}

// PRIVATE_OBJECT_DIR / PUBLIC_OBJECT_SEARCH_PATHS both encode paths as
// "/bucket/prefix" — unchanged from the previous implementation — so this
// parsing logic (and those two env vars) carry over as-is.
export function parseObjectPath(path: string): ObjectHandle {
  if (!path.startsWith("/")) path = `/${path}`;
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  const bucket = pathParts[1];
  const key = pathParts.slice(2).join("/");
  return { bucket, key };
}
