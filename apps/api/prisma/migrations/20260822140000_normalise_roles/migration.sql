-- §3 role model: rename legacy login roles in place. housekeeping and
-- guest_service stay as department markers on non-login staff (their
-- dashboard access maps to reception at token time).
UPDATE "StaffMember" SET "role" = 'hotel_manager'       WHERE "role" = 'manager';
UPDATE "StaffMember" SET "role" = 'maintenance_manager' WHERE "role" = 'maintenance' AND "username" IS NOT NULL;
