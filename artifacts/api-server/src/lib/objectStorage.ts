import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { s3Client, parseObjectPath, type ObjectHandle } from "./s3Client";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

async function objectExists(handle: ObjectHandle): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: handle.bucket, Key: handle.key }));
    return true;
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") return false;
    throw err;
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Set it to one or more comma-separated " +
          "\"/bucket/prefix\" paths in your S3-compatible bucket."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Set it to a \"/bucket/prefix\" path in your " +
          "S3-compatible bucket."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<ObjectHandle | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const handle = parseObjectPath(fullPath);
      if (await objectExists(handle)) {
        return handle;
      }
    }
    return null;
  }

  async downloadObject(handle: ObjectHandle, cacheTtlSec: number = 3600): Promise<Response> {
    const [head, aclPolicy] = await Promise.all([
      s3Client.send(new HeadObjectCommand({ Bucket: handle.bucket, Key: handle.key })),
      getObjectAclPolicy(handle),
    ]);
    const isPublic = aclPolicy?.visibility === "public";

    const obj = await s3Client.send(new GetObjectCommand({ Bucket: handle.bucket, Key: handle.key }));
    const nodeStream = obj.Body as unknown as Readable;
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": head.ContentType || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (head.ContentLength != null) {
      headers["Content-Length"] = String(head.ContentLength);
    }

    return new Response(webStream, { headers });
  }

  // Returns both the presigned PUT URL the client uploads to AND the
  // already-normalized /objects/... path the rest of the app should store,
  // since both are known at signing time. (The previous GCS implementation
  // derived the path by re-parsing the signed URL after the fact — fragile,
  // and specific to GCS's path-style signed-URL shape. Computing it up front
  // avoids needing to reverse-engineer bucket/key out of an S3 URL, which can
  // be virtual-hosted-style or path-style depending on provider/config.)
  async getObjectEntityUploadURL(): Promise<{ uploadURL: string; objectPath: string }> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const handle = parseObjectPath(fullPath);

    const uploadURL = await getSignedUrl(
      s3Client,
      new PutObjectCommand({ Bucket: handle.bucket, Key: handle.key }),
      { expiresIn: 900 }
    );

    // Mirrors getObjectEntityFile's reverse mapping below: entityId is always
    // "uploads/<objectId>" under the private dir, so /objects/... is fixed by
    // construction — no need to re-derive it from privateObjectDir.
    const objectPath = `/objects/uploads/${objectId}`;

    return { uploadURL, objectPath };
  }

  async getObjectEntityFile(objectPath: string): Promise<ObjectHandle> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const handle = parseObjectPath(`${entityDir}${entityId}`);
    if (!(await objectExists(handle))) {
      throw new ObjectNotFoundError();
    }
    return handle;
  }

  // Best-effort: recovers a normalized /objects/... path from a raw S3 URL.
  // Not on the current live path (getObjectEntityUploadURL now returns the
  // normalized path directly — see above) but kept for parity/future ACL
  // routes. Handles both virtual-hosted-style (bucket.s3.region.host/key) and
  // path-style (host/bucket/key, e.g. with S3_FORCE_PATH_STYLE or R2/MinIO)
  // signed URLs.
  normalizeObjectEntityPath(rawUrl: string): string {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return rawUrl; // not a URL — treat as already-normalized
    }

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) objectEntityDir = `${objectEntityDir}/`;

    const bucketFromHost = forcePathStyleHint(url) ? null : url.hostname.split(".s3")[0];
    const fullPath =
      bucketFromHost && !url.pathname.startsWith(`/${bucketFromHost}/`)
        ? `/${bucketFromHost}${url.pathname}`
        : url.pathname;

    if (!fullPath.startsWith(objectEntityDir)) {
      return fullPath;
    }
    const entityId = fullPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const handle = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(handle, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: ObjectHandle;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function forcePathStyleHint(url: URL): boolean {
  // Virtual-hosted-style hostnames look like "<bucket>.s3.<region>.amazonaws.com"
  // or "<bucket>.<endpoint>"; path-style hostnames are just the endpoint/service
  // host with no bucket subdomain. This is a heuristic for the (currently
  // unused) normalize helper above, not load-bearing for uploads/downloads.
  return !url.hostname.includes(".s3") && url.pathname.split("/").length > 2;
}
