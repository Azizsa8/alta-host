-- Department is routing metadata; role is dashboard permission. They were
-- one column, which §3's role model makes untenable (a maintenance
-- MANAGER is not the department's routing target for every fault).
ALTER TABLE "StaffMember" ADD COLUMN "department" TEXT;
UPDATE "StaffMember" SET "department" = CASE
  WHEN "role" = 'maintenance_manager' THEN 'maintenance'
  WHEN "role" IN ('housekeeping','guest_service','maintenance','reception') THEN "role"
  WHEN "role" = 'technician' THEN 'maintenance'
  ELSE NULL END;
