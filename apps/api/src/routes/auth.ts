import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../db.js';

const ACCESS_TTL = process.env.JWT_EXPIRES_IN || '15m';
// refresh token: 30 days in seconds
const REFRESH_TTL_SECONDS = Number(process.env.REFRESH_TOKEN_TTL_SECONDS || 60 * 60 * 24 * 30);

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(40),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const REFRESH_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/register
  fastify.post('/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { email, username, password } = parsed.data;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      return reply.status(409).send({ error: 'Email or username already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userRole = await prisma.role.findUnique({ where: { name: 'user' } });

    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        emailVerified: null,
        roles: userRole ? { create: [{ roleId: userRole.id }] } : undefined,
      },
      include: { roles: { include: { role: true } } },
    });

    const roles = user.roles.map((r) => r.role.name);
    const token = fastify.jwt.sign(
      { id: user.id, email: user.email, username: user.username, roles },
      { expiresIn: ACCESS_TTL },
    );
    const refresh = await issueRefreshToken(fastify, user.id);

    return reply.status(201).send({
      user: publicUser(user, roles),
      token,
      refreshToken: refresh,
    });
  });

  // POST /api/auth/login
  fastify.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.status(401).send({ error: 'Invalid credentials' });

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

    const roles = user.roles.map((r) => r.role.name);
    const token = fastify.jwt.sign(
      { id: user.id, email: user.email, username: user.username, roles },
      { expiresIn: ACCESS_TTL },
    );
    const refresh = await issueRefreshToken(fastify, user.id);

    return { user: publicUser(user, roles), token, refreshToken: refresh };
  });

  // POST /api/auth/logout
  fastify.post('/auth/logout', async (req, reply) => {
    const { refreshToken } = (req.body as { refreshToken?: string } | null) ?? {};
    if (refreshToken) {
      const hash = hashToken(refreshToken);
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hash, revoked: false },
        data: { revoked: true },
      });
    }
    return reply.status(204).send();
  });

  // POST /api/auth/refresh
  fastify.post('/auth/refresh', async (req, reply) => {
    const { refreshToken } = (req.body as { refreshToken?: string } | null) ?? {};
    if (!refreshToken) return reply.status(400).send({ error: 'refreshToken is required' });

    const hash = hashToken(refreshToken);
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });
    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }

    // rotate: revoke old, issue new
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
    const roles = stored.user.roles.map((r) => r.role.name);
    const token = fastify.jwt.sign(
      { id: stored.user.id, email: stored.user.email, username: stored.user.username, roles },
      { expiresIn: ACCESS_TTL },
    );
    const newRefresh = await issueRefreshToken(fastify, stored.user.id);

    return { token, refreshToken: newRefresh };
  });

  // GET /api/users/me  (auth required)
  fastify.get('/users/me', { preHandler: fastify.auth.require }, async (req, reply) => {
    const payload = req.user;
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      include: { roles: { include: { role: true } } },
    });
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return { user: publicUser(user, user.roles.map((r) => r.role.name)) };
  });

  // PUT /api/users/me  (auth required)
  fastify.put('/users/me', { preHandler: fastify.auth.require }, async (req, _reply) => {
    const payload = req.user;
    const body = (req.body as {
      username?: string;
      avatar?: string;
      settings?: unknown;
    } | null) ?? {};
    const user = await prisma.user.update({
      where: { id: payload.id },
      data: {
        ...(body.username !== undefined && { username: body.username }),
        ...(body.avatar !== undefined && { avatar: body.avatar }),
        ...(body.settings !== undefined && { settings: body.settings as object }),
      },
      include: { roles: { include: { role: true } } },
    });
    return { user: publicUser(user, user.roles.map((r) => r.role.name)) };
  });
}

// ─── helpers ───────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function issueRefreshToken(fastify: FastifyInstance, userId: string): Promise<string> {
  const token = randomBytes(48).toString('base64url');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + REFRESH_GRACE_MS),
    },
  });
  void fastify;
  return token;
}

function publicUser<T extends { id: string; email: string; username: string; avatar: string | null; createdAt: Date; lastLogin: Date | null }>(
  user: T,
  roles: string[],
) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    avatar: user.avatar,
    roles,
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
  };
}

void REFRESH_TTL_SECONDS;