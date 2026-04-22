import { NextResponse } from "next/server";
import { and, eq, gte, sum } from "drizzle-orm";
import { env } from "@/env";
import { getAuth } from "@/server/auth";
import { createDb, SCHEMA } from "@/server/db";
import { typeIdToUuid } from "@/lib/typeid";

export async function GET(req: Request): Promise<Response> {
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session?.session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userIdTypeid = session.user.id as `usr_${string}`;
  // Drizzle schema types expect typeid-prefixed strings; we already have one.
  const userIdForSchema = userIdTypeid;
  // uuid is only needed if we ever query via raw SQL; the drizzle path uses
  // the typeid string directly because `typeId` custom type serialises on write.
  void typeIdToUuid; // (kept imported in case we need raw pg later)

  const db = createDb(env.DATABASE_URL);

  const balanceRow = await db
    .select({
      frames: SCHEMA.credits.balanceFrames,
      commits: SCHEMA.credits.balanceCommits,
    })
    .from(SCHEMA.credits)
    .where(eq(SCHEMA.credits.userId, userIdForSchema))
    .limit(1);

  const balance = balanceRow[0] ?? { frames: 0, commits: 0 };

  // Sum |delta| per kind for "this month" and "lifetime $ spent".
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [monthFramesRow] = await db
    .select({ total: sum(SCHEMA.usageLedger.delta) })
    .from(SCHEMA.usageLedger)
    .where(
      and(
        eq(SCHEMA.usageLedger.userId, userIdForSchema),
        eq(SCHEMA.usageLedger.kind, "frame"),
        gte(SCHEMA.usageLedger.createdAt, monthStart),
      ),
    );

  const [spendRow] = await db
    .select({ total: sum(SCHEMA.usageLedger.amountUsd) })
    .from(SCHEMA.usageLedger)
    .where(
      and(
        eq(SCHEMA.usageLedger.userId, userIdForSchema),
        eq(SCHEMA.usageLedger.kind, "topup"),
      ),
    );

  const monthFrames = Math.abs(Number(monthFramesRow?.total ?? 0));
  const totalSpentUsd = Number(spendRow?.total ?? 0);

  return NextResponse.json({
    frames: balance.frames,
    commits: balance.commits,
    monthFrames,
    totalSpentUsd,
    lowBalance: balance.frames < 30,
  });
}
