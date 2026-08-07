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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
