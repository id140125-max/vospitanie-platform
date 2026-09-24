import { PrismaClient, Role } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRoles } from './auth';

const prisma = new PrismaClient();
const router = Router();

router.use(requireAuth, requireRoles(Role.ADMIN));

router.get('/users', async (request, response, next) => {
  try {
    const query = z.object({ search: z.string().optional() }).parse(request.query);
    const users = await prisma.user.findMany({
      where: query.search ? { OR: [{ fullName: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }] } : undefined,
      select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true, regionId: true, organizationId: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    response.json({ users });
  } catch (error) { next(error); }
});

router.patch('/users/:id', async (request, response, next) => {
  try {
    const input = z.object({ role: z.nativeEnum(Role).optional(), isActive: z.boolean().optional() }).refine((value) => value.role !== undefined || value.isActive !== undefined).parse(request.body);
    if (request.params.id === request.user!.id && (input.isActive === false || (input.role !== undefined && input.role !== Role.ADMIN))) {
      response.status(400).json({ error: 'Нельзя заблокировать себя или снять собственную роль администратора' });
      return;
    }
    const user = await prisma.user.update({ where: { id: request.params.id }, data: input, select: { id: true, email: true, fullName: true, role: true, isActive: true } });
    await prisma.auditLog.create({ data: { userId: request.user!.id, action: 'USER_UPDATED', entity: 'User', entityId: user.id } });
    response.json({ user });
  } catch (error) { next(error); }
});

router.get('/stats', async (_request, response, next) => {
  try {
    const [users, activeUsers, tasks, reports, submittedReports] = await Promise.all([
      prisma.user.count(), prisma.user.count({ where: { isActive: true } }), prisma.task.count(), prisma.report.count(), prisma.report.count({ where: { status: 'SUBMITTED' } }),
    ]);
    response.json({ users, activeUsers, tasks, reports, submittedReports });
  } catch (error) { next(error); }
});

router.get('/audit', async (_request, response, next) => {
  try { response.json({ events: await prisma.auditLog.findMany({ orderBy: { timestamp: 'desc' }, take: 200 }) }); }
  catch (error) { next(error); }
});

export default router;
