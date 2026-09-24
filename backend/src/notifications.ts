import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from './auth';

const prisma = new PrismaClient();
const router = Router();
router.use(requireAuth);

router.get('/', async (request, response, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: request.user!.id }, orderBy: { createdAt: 'desc' }, take: 50,
    });
    response.json({ notifications });
  } catch (error) { next(error); }
});

router.patch('/:id/read', async (request, response, next) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { id: request.params.id, userId: request.user!.id }, data: { isRead: true },
    });
    if (result.count === 0) { response.status(404).json({ error: 'Уведомление не найдено' }); return; }
    response.json({ success: true });
  } catch (error) { next(error); }
});

export default router;
