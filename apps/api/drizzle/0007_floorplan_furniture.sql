ALTER TABLE "floorplans" ADD COLUMN "furniture" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "floorplans" ADD COLUMN "furnished_from" uuid;--> statement-breakpoint
ALTER TABLE "floorplans" ADD CONSTRAINT "floorplans_furnished_from_layouts_id_fk" FOREIGN KEY ("furnished_from") REFERENCES "public"."layouts"("id") ON DELETE no action ON UPDATE no action;