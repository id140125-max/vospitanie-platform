import bcrypt from 'bcryptjs';
import { PrismaClient, Role, TaskStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters');
  await prisma.user.upsert({
    where: { email },
    update: { role: Role.ADMIN, isActive: true, fullName: process.env.ADMIN_NAME ?? 'Елена Юрьевна' },
    create: { email, passwordHash: await bcrypt.hash(password, 12), fullName: process.env.ADMIN_NAME ?? 'Администратор', role: Role.ADMIN },
  });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email } });
  if (!(await prisma.task.findFirst({ where: { title: 'Сбор данных о количестве детей в школе' } }))) {
    await prisma.task.create({ data: { title: 'Сбор данных о количестве детей в школе', description: 'Укажите фактическое количество обучающихся в образовательной организации на отчётную дату. В пояснении укажите источник данных и особенности подсчёта.', targetScope: 'all', priority: 1, status: TaskStatus.NEW, createdById: admin.id } });
  }
}

main().finally(() => prisma.$disconnect());
