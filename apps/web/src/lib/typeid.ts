import { fromString, getType, TypeID, toUUID, typeid } from "typeid-js";

// Narrowed to just the Better Auth tables. Add new prefixes here as domain
// entities get introduced (events, presets, generation jobs, etc.).
export const idTypesMapNameToPrefix = {
  user: "usr",
  session: "ses",
  account: "acc",
  verification: "ver",
  walletAddress: "wal",
} as const;

export type IdTypePrefixNames = keyof typeof idTypesMapNameToPrefix;

export type TypeIdString<T extends IdTypePrefixNames> =
  `${(typeof idTypesMapNameToPrefix)[T]}_${string}`;

export const typeIdGenerator = <const T extends IdTypePrefixNames>(prefix: T) =>
  typeid(idTypesMapNameToPrefix[prefix]).toString() as TypeIdString<T>;

export const typeIdFromUuid = <const T extends IdTypePrefixNames>(
  prefix: T,
  uuid: string,
) => {
  const actualPrefix = idTypesMapNameToPrefix[prefix];
  return TypeID.fromUUID(actualPrefix, uuid).toString() as TypeIdString<T>;
};

export const typeIdToUuid = <const T extends IdTypePrefixNames>(
  input: TypeIdString<T>,
) => {
  const id = fromString(input);
  return {
    uuid: toUUID(id).toString(),
    prefix: getType(id),
  };
};

// Typed brands — use with `.$type<UserId>()` on schema columns so wrong-prefix
// ids fail at the type level.
export type UserId = TypeIdString<"user">;
export type SessionId = TypeIdString<"session">;
export type AccountId = TypeIdString<"account">;
export type VerificationId = TypeIdString<"verification">;
export type WalletAddressId = TypeIdString<"walletAddress">;
