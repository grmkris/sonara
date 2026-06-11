CREATE TABLE "reel" (
	"cover_frame_id" uuid,
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reel_frame" (
	"frame_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"reel_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reel" ADD CONSTRAINT "reel_cover_frame_id_image_library_id_fk" FOREIGN KEY ("cover_frame_id") REFERENCES "public"."image_library"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel" ADD CONSTRAINT "reel_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_frame" ADD CONSTRAINT "reel_frame_frame_id_image_library_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."image_library"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_frame" ADD CONSTRAINT "reel_frame_reel_id_reel_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reel_user_created_idx" ON "reel" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "reel_frame_reel_position_idx" ON "reel_frame" USING btree ("reel_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "reel_frame_reel_frame_idx" ON "reel_frame" USING btree ("reel_id","frame_id");--> statement-breakpoint
CREATE INDEX "reel_frame_reel_idx" ON "reel_frame" USING btree ("reel_id");