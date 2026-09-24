import { Request, Response, Router } from 'express';
import { PrismaClient, Role, TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, requireRoles } from './auth';

const prisma = new PrismaClient();
const router = Router();

const taskInput = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(2),
  deadline: z.string().datetime().optional(),
  priority: z.number().int().min(0).max(3).default(0),
  targetScope: z.string().trim().min(1).default('all'),
});

router.use(requireAuth);

router.get('/', async (request, response, next) => {
  try {
    const elevated = request.user!.role !== Role.USER;
    const tasks = await prisma.task.findMany({
      where: elevated ? undefined : { OR: [{ targetScope: 'all' }, { assignments: { some: { userId: request.user!.id } } }] },
      orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
      include: { assignments: elevated ? true : { where: { userId: request.user!.id } } },
    });
    response.json({ tasks });
  } catch (error) { next(error); }
});

router.get('/:id', async (request, response, next) => {
  try {
    const taskId = String(request.params.id);
    const elevated = request.user!.role !== Role.USER;
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        ...(elevated ? {} : { OR: [{ targetScope: 'all' }, { assignments: { some: { userId: request.user!.id } } }] }),
      },
      include: { assignments: elevated ? true : { where: { userId: request.user!.id } } },
    });
    if (!task) { response.status(404).json({ error: 'Задание не найдено' }); return; }
    response.json({ task });
  } catch (error) { next(error); }
});

router.post('/', requireRoles(Role.COORDINATOR, Role.ADMIN), async (request, response, next) => {
  try {
    const input = taskInput.parse(request.body);
    const task = await prisma.task.create({
      data: { ...input, deadline: input.deadline ? new Date(input.deadline) : undefined, createdById: request.user!.id },
    });
    response.status(201).json({ task });
  } catch (error) { next(error); }
});

router.patch('/:id', requireRoles(Role.COORDINATOR, Role.ADMIN), async (request, response, next) => {
  try {
    const taskId = String(request.params.id);
    const input = taskInput.partial().extend({ status: z.nativeEnum(TaskStatus).optional() }).parse(request.body);
    const task = await prisma.task.update({
      where: { id: taskId },
      data: { ...input, deadline: input.deadline ? new Date(input.deadline) : undefined },
    });
    response.json({ task });
  } catch (error) { next(error); }
});

router.delete('/:id', requireRoles(Role.COORDINATOR, Role.ADMIN), async (request, response, next) => {
  try {
    await prisma.task.delete({ where: { id: String(request.params.id) } });
    response.status(204).send();
  } catch (error) { next(error); }
});

router.post('/:id/assign', requireRoles(Role.COORDINATOR, Role.ADMIN), async (request, response, next) => {
  try {
    const taskId = String(request.params.id);
    const input = z.object({ userId: z.string().min(1) }).parse(request.body);
    const assignment = await prisma.taskAssignment.upsert({
      where: { taskId_userId: { taskId, userId: input.userId } },
      update: {},
      create: { taskId, userId: input.userId },
    });
    await prisma.notification.create({ data: { userId: input.userId, type: 'TASK_ASSIGNED', payload: { taskId } } });
    response.status(201).json({ assignment });
  } catch (error) { next(error); }
});

router.patch('/:id/status', async (request: Request, response: Response, next) => {
  try {
    const taskId = String(request.params.id);
    const input = z.object({ status: z.nativeEnum(TaskStatus) }).parse(request.body);
    const canManage = request.user!.role === Role.COORDINATOR || request.user!.role === Role.ADMIN;
    if (canManage) {
      const task = await prisma.task.update({ where: { id: taskId }, data: { status: input.status } });
      response.json({ task });
      return;
    }
    const [task, assignment] = await Promise.all([
      prisma.task.findUnique({ where: { id: taskId } }),
      prisma.taskAssignment.findUnique({ where: { taskId_userId: { taskId, userId: request.user!.id } } }),
    ]);
    if (!task) { response.status(404).json({ error: 'Задание не найдено' }); return; }
    if (!assignment && task.targetScope !== 'all') {
      response.status(403).json({ error: 'Задание не назначено пользователю' });
      return;
    }
    if (input.status !== TaskStatus.IN_PROGRESS) {
      response.status(403).json({ error: 'Советник может только взять задание в работу; для отправки на проверку отправьте отчёт' });
      return;
    }
    const updatedAssignment = await prisma.taskAssignment.upsert({
      where: { taskId_userId: { taskId, userId: request.user!.id } },
      create: { taskId, userId: request.user!.id, status: input.status },
      update: {
        status: input.status,
        completedAt: null,
      },
    });
    response.json({ assignment: updatedAssignment });
  } catch (error) { next(error); }
});

export default router;
