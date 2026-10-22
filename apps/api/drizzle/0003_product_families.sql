ALTER TABLE "products" ADD COLUMN "family_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "options" jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "products_family_id_idx" ON "products" USING btree ("family_id");