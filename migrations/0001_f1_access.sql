ALTER TABLE "ingredients" DROP CONSTRAINT "ingredients_inventory_item_id_inventory_id_fk";
--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_menu_item_id_menu_items_id_fk";
--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "inventory_logs" ADD COLUMN "inventory_item_id" varchar;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_inventory_item_id_inventory_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_logs" ADD CONSTRAINT "inventory_logs_inventory_item_id_inventory_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_establishment_idx" ON "equipment" USING btree ("establishment");--> statement-breakpoint
CREATE INDEX "inventory_establishment_idx" ON "inventory" USING btree ("establishment");--> statement-breakpoint
CREATE INDEX "inventory_logs_establishment_idx" ON "inventory_logs" USING btree ("establishment");--> statement-breakpoint
CREATE INDEX "sales_establishment_idx" ON "sales" USING btree ("establishment");--> statement-breakpoint
CREATE INDEX "sales_date_idx" ON "sales" USING btree ("date");--> statement-breakpoint
CREATE INDEX "users_establishment_idx" ON "users" USING btree ("establishment");