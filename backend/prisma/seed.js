import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// "Fixed pickup" mode ke liye ek default jagah - baad me admin key se update kar sakte ho (PUT /api/shop-location)
await prisma.shopLocation.upsert({
  where: { id: 1 },
  update: {},
  create: { id: 1, name: 'Main Store', address: 'Set your shop address', lat: 22.5726, lng: 88.3639 },
});

console.log('Seeded default shop location. Update it via PUT /api/shop-location.');
await prisma.$disconnect();
