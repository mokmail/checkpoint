import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const eventSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  start: z.string().or(z.date()),
  end: z.string().or(z.date()),
  allDay: z.boolean().optional(),
  recurring: z.record(z.unknown()).optional(),
  attendees: z.array(z.string()).optional(),
  color: z.string().optional(),
  reminders: z.array(z.record(z.unknown())).optional(),
});

export async function calendarRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.auth.require);

  // GET /api/calendar/events — list events in a date range
  fastify.get('/calendar/events', async (req) => {
    const uid = req.user.id;
    const { from, to } = req.query as { from?: string; to?: string };
    const where = { userId: uid };
    if (from || to) {
      where['start' as keyof typeof where] = {} as never;
      if (from) (where as Record<string, unknown>).start = { gte: new Date(from) };
      if (to) {
        const startFilter = (where as Record<string, unknown>).start as Record<string, unknown> | undefined;
        if (startFilter) startFilter.lte = new Date(to);
        else (where as Record<string, unknown>).start = { lte: new Date(to) };
      }
    }
    const events = await prisma.calendarEvent.findMany({
      where: where as never,
      orderBy: { start: 'asc' },
    });
    return { events };
  });

  // POST /api/calendar/events
  fastify.post('/calendar/events', async (req, reply) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    const uid = req.user.id;
    const { title, description, start, end, allDay, recurring, attendees, color, reminders } = parsed.data;
    const event = await prisma.calendarEvent.create({
      data: {
        userId: uid,
        title,
        description,
        start: new Date(start),
        end: new Date(end),
        allDay: allDay ?? false,
        recurring: (recurring ?? null) as import('@prisma/client').Prisma.InputJsonValue,
        attendees: attendees ?? [],
        color: color ?? '#4f8cff',
        reminders: (reminders ?? null) as import('@prisma/client').Prisma.InputJsonValue,
      },
    });
    return reply.status(201).send({ event });
  });

  // GET /api/calendar/events/:id
  fastify.get('/calendar/events/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const event = await prisma.calendarEvent.findFirst({ where: { id, userId: uid } });
    if (!event) return reply.status(404).send({ error: 'Event not found' });
    return { event };
  });

  // PUT /api/calendar/events/:id
  fastify.put('/calendar/events/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const parsed = eventSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    const existing = await prisma.calendarEvent.findFirst({ where: { id, userId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Event not found' });
    const data = parsed.data;
    const event = await prisma.calendarEvent.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.start !== undefined && { start: new Date(data.start) }),
        ...(data.end !== undefined && { end: new Date(data.end) }),
        ...(data.allDay !== undefined && { allDay: data.allDay }),
        ...(data.recurring !== undefined && { recurring: data.recurring as import('@prisma/client').Prisma.InputJsonValue }),
        ...(data.attendees !== undefined && { attendees: data.attendees }),
        ...(data.color !== undefined && { color: data.color }),
        ...(data.reminders !== undefined && { reminders: data.reminders as import('@prisma/client').Prisma.InputJsonValue }),
      },
    });
    return { event };
  });

  // DELETE /api/calendar/events/:id
  fastify.delete('/calendar/events/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const existing = await prisma.calendarEvent.findFirst({ where: { id, userId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Event not found' });
    await prisma.calendarEvent.delete({ where: { id } });
    return reply.status(204).send();
  });

  // GET /api/calendar/sync — stub for external calendar sync (iCal)
  fastify.get('/calendar/sync', async (_req, _reply) => {
    return { note: 'External calendar sync not yet configured. Set CALDAV_URL or GOOGLE_CALENDAR_ID.' };
  });
}