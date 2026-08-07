import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const property = await prisma.property.upsert({
    where: { id: "demo-property" },
    update: {},
    create: { id: "demo-property", name: "Riyadh Boulevard Hotel (Pilot)", pmsType: "mock" },
  });

  const guest = await prisma.guest.upsert({
    where: { whatsappId: "9665xxxxxxxx" },
    update: {},
    create: {
      propertyId: property.id,
      whatsappId: "9665xxxxxxxx",
      name: "Demo Guest",
      preferredDialect: "saudi",
    },
  });

  const now = new Date();
  const checkIn = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const checkOut = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  await prisma.reservation.upsert({
    where: { id: "demo-reservation" },
    update: {},
    create: {
      id: "demo-reservation",
      guestId: guest.id,
      propertyId: property.id,
      roomNumber: "412",
      checkIn,
      checkOut,
      status: "confirmed",
    },
  });

  const staffRoles: Array<{ name: string; role: string }> = [
    { name: "Fahad (Reception)", role: "reception" },
    { name: "Noura (Housekeeping)", role: "housekeeping" },
    { name: "Salem (Maintenance)", role: "maintenance" },
    { name: "Layla (Guest Service)", role: "guest_service" },
  ];

  for (const s of staffRoles) {
    const existing = await prisma.staffMember.findFirst({ where: { propertyId: property.id, name: s.name } });
    if (!existing) {
      await prisma.staffMember.create({
        data: { propertyId: property.id, name: s.name, role: s.role, onShift: true },
      });
    }
  }

  console.log("Seeded:", { property: property.name, guest: guest.whatsappId, room: "412" });

  // Second property — exists purely to give multi-tenant isolation
  // something real to verify against (see scripts/verify-tenant-isolation.ts).
  // Structurally parallel to the property above but under a distinct
  // propertyId, guest, room, and staff roster so cross-tenant leakage would
  // be observable rather than accidentally masked by shared data.
  const property2 = await prisma.property.upsert({
    where: { id: "demo-property-2" },
    update: {},
    create: { id: "demo-property-2", name: "Jeddah Corniche Suites (Pilot)", pmsType: "mock" },
  });

  const guest2 = await prisma.guest.upsert({
    where: { whatsappId: "9665yyyyyyyy" },
    update: {},
    create: {
      propertyId: property2.id,
      whatsappId: "9665yyyyyyyy",
      name: "Demo Guest 2",
      preferredDialect: "hijazi",
    },
  });

  const checkIn2 = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const checkOut2 = new Date(now.getTime() + 12 * 60 * 60 * 1000);

  await prisma.reservation.upsert({
    where: { id: "demo-reservation-2" },
    update: {},
    create: {
      id: "demo-reservation-2",
      guestId: guest2.id,
      propertyId: property2.id,
      roomNumber: "215",
      checkIn: checkIn2,
      checkOut: checkOut2,
      status: "confirmed",
    },
  });

  const staffRoles2: Array<{ name: string; role: string }> = [
    { name: "Khalid (Reception)", role: "reception" },
    { name: "Mona (Housekeeping)", role: "housekeeping" },
    { name: "Yousef (Maintenance)", role: "maintenance" },
    { name: "Huda (Guest Service)", role: "guest_service" },
  ];

  for (const s of staffRoles2) {
    const existing = await prisma.staffMember.findFirst({ where: { propertyId: property2.id, name: s.name } });
    if (!existing) {
      await prisma.staffMember.create({
        data: { propertyId: property2.id, name: s.name, role: s.role, onShift: true },
      });
    }
  }

  console.log("Seeded:", { property: property2.name, guest: guest2.whatsappId, room: "215" });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
