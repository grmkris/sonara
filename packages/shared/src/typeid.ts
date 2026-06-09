import { fromString, getType, TypeID, toUUID, typeid } from "typeid-js";
import { z } from "zod";

// Master list of domain entity prefixes. Extend as new entities are added.
// Prefixes must be unique, lowercase, and stable — they become part of the
// serialized id format and renaming one is a breaking change.
export const idTypesMapNameToPrefix = {
  account: "acc",
  allowedEmail: "alw",
  credits: "crd",
  // The unified "set" entity (frame_set): a named, ordered, playable
  // collection of frames. Subsumes built-in decks, session recordings, and
  // curated reels (origin column). "set" is the UI word; code says frameSet
  // to dodge JS Set / SQL SET collisions.
  frameSet: "set",
  frameSetFrame: "fsf",
  imageLibrary: "img",
  // Visualizer WS session — minted in-memory on each Session construction.
  // Distinct from `session` (Better Auth's browser session). Used to group
  // image_library rows by live-play session for the timeline view.
  liveSession: "lse",
  // Curated collection of frames ("reel") + its ordered membership rows.
  // Superseded by frameSet (origin='curated'); kept while the legacy tables
  // exist — the boot converger copies reels into frame_set.
  reel: "rel",
  reelFrame: "rlf",
  session: "ses",
  usageLedger: "usg",
  user: "usr",
  verification: "ver",
} as const;

export type IdTypePrefixNames = keyof typeof idTypesMapNameToPrefix;

export type TypeIdString<T extends IdTypePrefixNames> =
  `${(typeof idTypesMapNameToPrefix)[T]}_${string}`;

export const typeIdGenerator = <const T extends IdTypePrefixNames>(prefix: T) =>
  typeid(idTypesMapNameToPrefix[prefix]).toString() as TypeIdString<T>;

export const typeIdFromUuid = <const T extends IdTypePrefixNames>(
  prefix: T,
  uuid: string
) => {
  const actualPrefix = idTypesMapNameToPrefix[prefix];
  return TypeID.fromUUID(actualPrefix, uuid).toString() as TypeIdString<T>;
};

export const typeIdToUuid = <const T extends IdTypePrefixNames>(
  input: TypeIdString<T>
) => {
  const id = fromString(input);
  return {
    prefix: getType(id),
    uuid: toUUID(id).toString(),
  };
};

// Zod validator for an entity's typeid. Usable directly in RPC input schemas
// so wrong-prefix ids are rejected at the boundary.
export const typeIdValidator = <const T extends IdTypePrefixNames>(
  prefix: T
) => {
  const expected = idTypesMapNameToPrefix[prefix];
  return z
    .string()
    .refine(
      (v) => v.startsWith(`${expected}_`) && v.length > expected.length + 1,
      { message: `Expected a ${prefix} id (prefix "${expected}_")` }
    )
    .transform((v) => v as TypeIdString<T>);
};

// Branded types — use with `.$type<UserId>()` on schema columns, and as
// RPC input shapes via the matching validators below.
export type UserId = TypeIdString<"user">;
export type SessionId = TypeIdString<"session">;
export type AccountId = TypeIdString<"account">;
export type VerificationId = TypeIdString<"verification">;
export type CreditsId = TypeIdString<"credits">;
export type UsageLedgerId = TypeIdString<"usageLedger">;
export type AllowedEmailId = TypeIdString<"allowedEmail">;
export type ImageLibraryId = TypeIdString<"imageLibrary">;
export type LiveSessionId = TypeIdString<"liveSession">;
export type ReelId = TypeIdString<"reel">;
export type ReelFrameId = TypeIdString<"reelFrame">;
export type FrameSetId = TypeIdString<"frameSet">;
export type FrameSetFrameId = TypeIdString<"frameSetFrame">;

export const UserIdSchema = typeIdValidator("user");
export const SessionIdSchema = typeIdValidator("session");
export const AccountIdSchema = typeIdValidator("account");
export const VerificationIdSchema = typeIdValidator("verification");
export const CreditsIdSchema = typeIdValidator("credits");
export const UsageLedgerIdSchema = typeIdValidator("usageLedger");
export const AllowedEmailIdSchema = typeIdValidator("allowedEmail");
export const ImageLibraryIdSchema = typeIdValidator("imageLibrary");
export const LiveSessionIdSchema = typeIdValidator("liveSession");
export const ReelIdSchema = typeIdValidator("reel");
export const ReelFrameIdSchema = typeIdValidator("reelFrame");
export const FrameSetIdSchema = typeIdValidator("frameSet");
export const FrameSetFrameIdSchema = typeIdValidator("frameSetFrame");
