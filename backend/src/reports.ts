import { PrismaClient, ReportStatus, Role } from '@prisma/client';
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { requireAuth, requireRoles } from './auth';

const prisma = new PrismaClient();
const router = Router();
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR ?? 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (_request, file, callback) => callback(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, [
    'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png',
  ].includes(file.mimetype)),
});

router.use(requireAuth);

router.get('/', async (request, response, next) => {
  try {
    const canReview = request.user!.role === Role.COORDINATOR || request.user!.role === Role.ADMIN;
    const reports = await prisma.report.findMany({
      where: canReview ? undefined : { userId: request.user!.id },
      include: { task: { select: { id: true, title: true } }, files: true },
      orderBy: { createdAt: 'desc' },
    });
    response.json({ reports });
  } catch (error) { next(error); }
});

router.post('/', async (request, response, next) => {
  try {
    const input = z.object({ taskId: z.string().min(1), content: z.string().trim().min(2), studentCount: z.coerce.number().int().min(0).max(100000).optional(), reportingPeriod: z.string().trim().max(100).optional(), submit: z.boolean().default(false) }).parse(request.body);
    const task = await prisma.task.findFirst({
      where: { id: input.taskId, OR: [{ targetScope: 'all' }, { assignments: { some: { userId: request.user!.id } } }] },
    });
    if (!task) { response.status(403).json({ error: 'Задание недоступно' }); return; }
    const previous = await prisma.report.findUnique({ where: { taskId_userId: { taskId: input.taskId, userId: request.user!.id } } });
    if (previous?.status === ReportStatus.REVIEWED) { response.status(409).json({ error: 'Проверенный отчёт нельзя изменить' }); return; }
    const report = await prisma.report.upsert({
      where: { taskId_userId: { taskId: input.taskId, userId: request.user!.id } },
      create: { taskId: input.taskId, userId: request.user!.id, content: input.content, studentCount: input.studentCount, reportingPeriod: input.reportingPeriod, status: input.submit ? ReportStatus.SUBMITTED : ReportStatus.DRAFT },
      update: { content: input.content, studentCount: input.studentCount, reportingPeriod: input.reportingPeriod, status: input.submit ? ReportStatus.SUBMITTED : ReportStatus.DRAFT },
    });
    await prisma.taskAssignment.upsert({
      where: { taskId_userId: { taskId: input.taskId, userId: request.user!.id } },
      create: { taskId: input.taskId, userId: request.user!.id, status: input.submit ? 'REVIEW' : 'IN_PROGRESS' },
      update: { status: input.submit ? 'REVIEW' : 'IN_PROGRESS' },
    });
    response.status(201).json({ report });
  } catch (error) { next(error); }
});

router.post('/:id/files', upload.array('files', 5), async (request, response, next) => {
  try {
    const reportId = String(request.params.id);
    const report = await prisma.report.findUnique({ where: { id: reportId } });
    if (!report) { response.status(404).json({ error: 'Отчёт не найден' }); return; }
    const canManage = request.user!.role === Role.COORDINATOR || request.user!.role === Role.ADMIN;
    if (report.userId !== request.user!.id && !canManage) { response.status(403).json({ error: 'Нет доступа к отчёту' }); return; }
    if (report.status === ReportStatus.REVIEWED) { response.status(409).json({ error: 'Проверенный отчёт нельзя изменить' }); return; }
    const files = (request.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) { response.status(400).json({ error: 'Добавьте хотя бы один файл поддерживаемого типа' }); return; }
    const records = await prisma.reportFile.createMany({ data: files.map((file) => ({ reportId: report.id, url: `/uploads/${file.filename}`, mimeType: file.mimetype, size: file.size })) });
    response.status(201).json({ count: records.count });
  } catch (error) { next(error); }
});

router.patch('/:id/status', requireRoles(Role.COORDINATOR, Role.ADMIN), async (request, response, next) => {
  try {
    const reportId = String(request.params.id);
    const input = z.object({ status: z.enum(['REVIEWED', 'DRAFT']) }).parse(request.body);
    const current = await prisma.report.findUnique({ where: { id: reportId } });
    if (!current) { response.status(404).json({ error: 'Отчёт не найден' }); return; }
    if (current.status !== ReportStatus.SUBMITTED) { response.status(409).json({ error: 'Отчёт не ожидает проверки' }); return; }
    const report = await prisma.report.update({
      where: { id: reportId },
      data: { status: input.status, reviewedBy: request.user!.id },
    });
    await prisma.taskAssignment.update({
      where: { taskId_userId: { taskId: current.taskId, userId: current.userId } },
      data: { status: input.status === 'REVIEWED' ? 'ACCEPTED' : 'REJECTED', completedAt: input.status === 'REVIEWED' ? new Date() : null },
    });
    await prisma.notification.create({ data: { userId: current.userId, type: 'REPORT_REVIEWED', payload: { reportId: report.id, status: report.status } } });
    response.json({ report });
  } catch (error) { next(error); }
});

export default router;
