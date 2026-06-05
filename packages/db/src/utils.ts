import { typeIdFromUuid, typeIdToUuid } from "@sonara/shared/typeid";
import type { IdTypePrefixNames, TypeIdString } from "@sonara/shared/typeid";
import { customType, timestamp } from "drizzle-orm/pg-core";

// Postgres `uuid` storage; app-side typeid string. Driver translates on read
// and write, so queries compare uuids natively while callers work in typeid
// space.
export const typeId = <const T extends IdTypePrefixNames>(
  prefix: T,
  columnName: string
) =>
  customType<{
    data: TypeIdString<T>;
    driverData: string;
  }>({
    dataType() {
      return "uuid";
    },
    fromDriver(input: string): TypeIdString<T> {
      return typeIdFromUuid(prefix, input);
    },
    toDriver(input: TypeIdString<T>): string {
      return typeIdToUuid(input).uuid;
    },
  })(columnName);

export const createTimestampField = (name?: string) => {
  if (!name) {
    return timestamp({ withTimezone: true, mode: "date" });
  }
  return timestamp(name, { mode: "date", withTimezone: true });
};

// Spread onto every table that wants standard created_at / updated_at
// semantics. `$onUpdate` fires on Drizzle `.update()` calls — Better Auth
// uses the drizzleAdapter's update path, so timestamps auto-refresh.
export const baseEntityFields = {
  createdAt: createTimestampField("created_at").defaultNow().notNull(),
  updatedAt: createTimestampField("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};
