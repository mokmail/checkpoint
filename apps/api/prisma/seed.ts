import { PrismaClient, AuthProvider } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Default roles
  const admin = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: {
      name: 'admin',
      description: 'Full access',
      permissions: {
        create: [
          { resource: '*', action: '*', scope: 'all' },
        ],
      },
    },
  });

  const user = await prisma.role.upsert({
    where: { name: 'user' },
    update: {},
    create: {
      name: 'user',
      description: 'Standard user',
      permissions: {
        create: [
          { resource: 'conversation', action: 'create', scope: 'own' },
          { resource: 'conversation', action: 'read', scope: 'own' },
          { resource: 'conversation', action: 'update', scope: 'own' },
          { resource: 'conversation', action: 'delete', scope: 'own' },
          { resource: 'memory', action: 'create', scope: 'own' },
          { resource: 'memory', action: 'read', scope: 'own' },
          { resource: 'memory', action: 'update', scope: 'own' },
          { resource: 'memory', action: 'delete', scope: 'own' },
          { resource: 'agent', action: 'create', scope: 'own' },
          { resource: 'agent', action: 'read', scope: 'all' },
          { resource: 'agent', action: 'update', scope: 'own' },
          { resource: 'agent', action: 'delete', scope: 'own' },
        ],
      },
    },
  });

  const guest = await prisma.role.upsert({
    where: { name: 'guest' },
    update: {},
    create: {
      name: 'guest',
      description: 'Read-only guest',
      permissions: {
        create: [
          { resource: 'conversation', action: 'read', scope: 'own' },
          { resource: 'agent', action: 'read', scope: 'all' },
        ],
      },
    },
  });

  // Demo admin user
  const passwordHash = await bcrypt.hash('changeme', 10);
  const demoAdmin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      username: 'admin',
      passwordHash,
      emailVerified: new Date(),
      roles: { create: [{ roleId: admin.id }] },
    },
  });

  console.log('Seeded roles:', admin.name, user.name, guest.name);
  console.log('Seeded demo admin:', demoAdmin.email, '(password: changeme)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });