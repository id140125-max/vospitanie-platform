import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from './auth';

const prisma = new PrismaClient();
const router = Router();
router.use(requireAuth);

router.get('/', async (request, response, next) => {
  try {
    const chats = await prisma.chat.findMany({
      where: { members: { some: { userId: request.user!.id } } },
      include: { members: { include: { user: { select: { id: true, fullName: true } } } }, messages: { take: 1, orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    response.json({ chats });
  } catch (error) { next(error); }
});

router.post('/', async (request, response, next) => {
  try {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(request.body);
    if (userId === request.user!.id) { response.status(400).json({ error: 'Выберите другого участника' }); return; }
    const recipient = await prisma.user.findFirst({ where: { id: userId, isActive: true } });
    if (!recipient) { response.status(404).json({ error: 'Пользователь не найден' }); return; }
    const existing = await prisma.chat.findFirst({ where: { type: 'private', AND: [
      { members: { some: { userId: request.user!.id } } },
      { members: { some: { userId } } },
    ] }, include: { members: true } });
    if (existing?.members.length === 2) { response.json({ chat: existing }); return; }
    const chat = await prisma.chat.create({ data: { members: { create: [{ userId: request.user!.id }, { userId }] } }, include: { members: true } });
    response.status(201).json({ chat });
  } catch (error) { next(error); }
});

router.get('/:id/messages', async (request, response, next) => {
  try {
    const member = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: request.params.id, userId: request.user!.id } } });
    if (!member) { response.status(404).json({ error: 'Чат не найден' }); return; }
    const messages = await prisma.message.findMany({ where: { chatId: request.params.id, isDeleted: false }, orderBy: { createdAt: 'desc' }, take: 100 });
    response.json({ messages: messages.reverse() });
  } catch (error) { next(error); }
});

router.post('/:id/messages', async (request, response, next) => {
  try {
    const { content } = z.object({ content: z.string().trim().min(1).max(4000) }).parse(request.body);
    const member = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: request.params.id, userId: request.user!.id } } });
    if (!member) { response.status(404).json({ error: 'Чат не найден' }); return; }
    const message = await prisma.message.create({ data: { chatId: request.params.id, senderId: request.user!.id, content } });
    const otherMembers = await prisma.chatMember.findMany({ where: { chatId: request.params.id, userId: { not: request.user!.id } }, select: { userId: true } });
    if (otherMembers.length) {
      await prisma.notification.createMany({ data: otherMembers.map((member) => ({ userId: member.userId, type: 'NEW_MESSAGE', payload: { chatId: request.params.id, messageId: message.id } })) });
    }
    response.status(201).json({ message });
  } catch (error) { next(error); }
});

export default router;
