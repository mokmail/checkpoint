import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';

export interface JwtPayload {
  id: string;
  email: string;
  username: string;
  roles: string[];
}

declare module 'fastify' {
  interface FastifyInstance {
    auth: {
      require: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
      optional: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export const authPlugin = fp(async (fastify: FastifyInstance) => {
  const secret = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
  await fastify.register(jwt, { secret });

  fastify.decorate('auth', {
    async require(req: FastifyRequest, reply: FastifyReply) {
      try {
        await req.jwtVerify();
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    },
    async optional(req: FastifyRequest, _reply: FastifyReply) {
      try {
        await req.jwtVerify();
      } catch {
        // no user — leave req.user undefined
      }
    },
  });
}, { name: 'auth-plugin' });