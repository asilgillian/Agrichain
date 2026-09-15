import { CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, type ObjectHandle } from "./s3Client";

// S3 user metadata keys are lowercased and exposed to readers with an
// "x-amz-meta-" prefix stripped, so no colon (GCS's "custom:aclPolicy" key
// isn't a valid S3 metadata header name).
const ACL_POLICY_METADATA_KEY = "acl-policy";

// Can be flexibly defined according to the use case.
//
// Examples:
// - USER_LIST: the users from a list stored in the database;
// - EMAIL_DOMAIN: the users whose email is in a specific domain;
// - GROUP_MEMBER: the users who are members of a specific group;
// - SUBSCRIBER: the users who are subscribers of a specific service / content
//   creator.
export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  // The logic id that identifies qualified group members. Format depends on the
  // ObjectAccessGroupType — e.g. a user-list DB id, an email domain, a group id.
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

// Stored as an S3 object user-metadata entry under "acl-policy" (JSON string).
export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup {
  switch (group.type) {
    // Implement per access group type, e.g.:
    // case "USER_LIST":
    //   return new UserListAccessGroup(group.id);
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

export async function setObjectAclPolicy(
  objectHandle: ObjectHandle,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const head = await s3Client.send(
    new HeadObjectCommand({ Bucket: objectHandle.bucket, Key: objectHandle.key }),
  );

  // S3 has no in-place "update just the metadata" call — the standard way is
  // to copy the object onto itself with MetadataDirective: REPLACE, carrying
  // forward its existing metadata and content type. (GCS's file.setMetadata()
  // did this in one call; S3 needs the copy-to-self instead.)
  await s3Client.send(
    new CopyObjectCommand({
      Bucket: objectHandle.bucket,
      Key: objectHandle.key,
      CopySource: `${objectHandle.bucket}/${encodeURIComponent(objectHandle.key)}`,
      MetadataDirective: "REPLACE",
      ContentType: head.ContentType,
      Metadata: {
        ...(head.Metadata || {}),
        [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
      },
    }),
  );
}

export async function getObjectAclPolicy(
  objectHandle: ObjectHandle,
): Promise<ObjectAclPolicy | null> {
  const head = await s3Client.send(
    new HeadObjectCommand({ Bucket: objectHandle.bucket, Key: objectHandle.key }),
  );
  const raw = head.Metadata?.[ACL_POLICY_METADATA_KEY];
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: ObjectHandle;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }

  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (aclPolicy.owner === userId) {
    return true;
  }

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }

  return false;
}
