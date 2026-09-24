import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import authRouter from './auth';
import tasksRouter from './tasks';
import reportsRouter from './reports';
import adminRouter from './admin';
import chatsRouter from './chats';
import notificationsRouter from './notifications';
import path from 'node:path';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const httpServer = createServer(app);
const prisma = new PrismaClient();
const socketSecret = process.env.JWT_SECRET;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR ?? 'uploads')));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', service: 'vospitanie-backend' });
});

app.get('/api', (_request, response) => {
  response.json({ name: 'Воспитание.Про API', version: '0.1.0' });
});

app.use('/api/auth', authRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/notifications', notificationsRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({ error: 'Некорректные данные', details: error.flatten() });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    response.status(404).json({ error: 'Запись не найдена' });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    response.status(409).json({ error: 'Запись с такими данными уже существует' });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const io = new Server(httpServer, { cors: { origin: true, credentials: true } });

io.use(async (socket, next) => {
  try {
    if (!socketSecret) throw new Error('JWT_SECRET is required');
    const token = String(socket.handshake.auth?.token ?? '');
    const payload = jwt.verify(token, socketSecret) as { id?: string };
    if (!payload.id) throw new Error('Invalid token');
    const user = await prisma.user.findUnique({ where: { id: payload.id }, select: { id: true, isActive: true } });
    if (!user?.isActive) throw new Error('Inactive user');
    socket.data.userId = user.id;
    next();
  } catch { next(new Error('Unauthorized')); }
});

io.on('connection', (socket) => {
  socket.on('chat:join', async (chatId: string, callback?: (result: { ok: boolean; error?: string }) => void) => {
    const member = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId: socket.data.userId } } });
    if (!member) { callback?.({ ok: false, error: 'Нет доступа к чату' }); return; }
    await socket.join(`chat:${chatId}`);
    callback?.({ ok: true });
  });

  socket.on('chat:message', async (data: { chatId?: string; content?: string }, callback?: (result: { ok: boolean; message?: unknown; error?: string }) => void) => {
    try {
      const chatId = String(data?.chatId ?? '');
      const content = String(data?.content ?? '').trim();
      if (!chatId || !content || content.length > 4000) { callback?.({ ok: false, error: 'Некорректное сообщение' }); return; }
      const member = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId: socket.data.userId } } });
      if (!member) { callback?.({ ok: false, error: 'Нет доступа к чату' }); return; }
      const message = await prisma.message.create({ data: { chatId, senderId: socket.data.userId, content } });
      io.to(`chat:${chatId}`).emit('chat:message', message);
      callback?.({ ok: true, message });
    } catch { callback?.({ ok: false, error: 'Не удалось отправить сообщение' }); }
  });
});

httpServer.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
