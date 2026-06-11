-- Retire the legacy reel tables — COPY THEN DROP, in one migration. The boot
-- converger has done this copy on every dev boot since 0005, but production
-- promotes straight from pre-sets code: when it runs 0005+0006 back-to-back
-- the converger hasn't executed yet, so the copy MUST live here or the drop
-- destroys prod's reels. uuid identity (curated set id = reel id, junction id
-- = reel_frame id) makes the copy pure SQL and the whole file idempotent.
INSERT INTO "frame_set"
  (id, cover_frame_id, name, origin, status, user_id, visibility, created_at)
SELECT r.id, r.cover_frame_id, r.name, 'curated', 'final', r.user_id,
       'private', r.created_at
FROM "reel" r
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
INSERT INTO "frame_set_frame"
  (id, set_id, frame_id, position, t_ms, created_at)
SELECT rf.id, rf.reel_id, rf.frame_id, rf.position, NULL, rf.created_at
FROM "reel_frame" rf
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "frame_set" fs SET frame_count = c.n
FROM (SELECT set_id, count(*)::int AS n
      FROM "frame_set_frame" GROUP BY set_id) c
WHERE c.set_id = fs.id AND fs.frame_count <> c.n;--> statement-breakpoint
DROP TABLE "reel" CASCADE;--> statement-breakpoint
DROP TABLE "reel_frame" CASCADE;
