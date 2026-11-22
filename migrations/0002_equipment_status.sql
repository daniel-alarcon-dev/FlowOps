UPDATE "equipment" SET "status" = 'Working' WHERE "status" = 'OPERATIONAL';
--> statement-breakpoint
UPDATE "equipment" SET "status" = 'Attention' WHERE "status" = 'MAINTENANCE';
--> statement-breakpoint
UPDATE "equipment" SET "status" = 'Broken' WHERE "status" = 'BROKEN';
