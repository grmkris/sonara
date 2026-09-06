CREATE TABLE "performance_take" (
	"client_id" uuid NOT NULL,
	"manifest" jsonb,
	"set_id" uuid PRIMARY KEY NOT NULL,
	CONSTRAINT "performance_take_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "performance_take_chunk" (
	"bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	"digest" text NOT NULL,
	"index" integer NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"set_id" uuid NOT NULL,
	CONSTRAINT "performance_take_chunk_set_id_kind_index_pk" PRIMARY KEY("set_id","kind","index")
);
--> statement-breakpoint
ALTER TABLE "performance_take" ADD CONSTRAINT "performance_take_set_id_frame_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."frame_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_take_chunk" ADD CONSTRAINT "performance_take_chunk_set_id_performance_take_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."performance_take"("set_id") ON DELETE cascade ON UPDATE no action;