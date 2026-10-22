CREATE TABLE "floorplans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"image" jsonb,
	"walls" jsonb NOT NULL,
	"openings" jsonb NOT NULL,
	"rooms" jsonb NOT NULL,
	"obstacles" jsonb NOT NULL,
	"labels" jsonb NOT NULL,
	"scale" jsonb,
	"ceiling_height" real NOT NULL,
	"ceiling_height_source" text NOT NULL,
	"materials" jsonb NOT NULL,
	"reading" jsonb,
	"edit_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "floorplans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "layouts" ADD COLUMN "floorplan_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_floorplan_id_floorplans_id_fk" FOREIGN KEY ("floorplan_id") REFERENCES "public"."floorplans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "layouts_floorplan_id_idx" ON "layouts" USING btree ("floorplan_id");