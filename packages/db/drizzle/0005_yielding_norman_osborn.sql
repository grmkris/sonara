CREATE TABLE "frame_set" (
	"cover_frame_id" uuid,
	"deck_key" text,
	"frame_count" integer DEFAULT 0 NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"live_session_id" text,
	"name" text NOT NULL,
	"origin" text NOT NULL,
	"status" text DEFAULT 'final' NOT NULL,
	"user_id" uuid,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frame_set_frame" (
	"frame_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"set_id" uuid NOT NULL,
	"t_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "frame_set" ADD CONSTRAINT "frame_set_cover_frame_id_image_library_id_fk" FOREIGN KEY ("cover_frame_id") REFERENCES "public"."image_library"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_set" ADD CONSTRAINT "frame_set_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_set_frame" ADD CONSTRAINT "frame_set_frame_frame_id_image_library_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."image_library"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_set_frame" ADD CONSTRAINT "frame_set_frame_set_id_frame_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."frame_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "frame_set_user_created_idx" ON "frame_set" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "frame_set_live_session_idx" ON "frame_set" USING btree ("live_session_id") WHERE live_session_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "frame_set_deck_key_idx" ON "frame_set" USING btree ("deck_key") WHERE origin = 'builtin';--> statement-breakpoint
CREATE UNIQUE INDEX "frame_set_frame_set_position_idx" ON "frame_set_frame" USING btree ("set_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "frame_set_frame_set_frame_idx" ON "frame_set_frame" USING btree ("set_id","frame_id");--> statement-breakpoint
CREATE INDEX "frame_set_frame_set_idx" ON "frame_set_frame" USING btree ("set_id");