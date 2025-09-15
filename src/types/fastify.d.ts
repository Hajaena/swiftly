import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

declare module 'fastify' {
    interface FastifyInstance {
        prisma: PrismaClient;
        redis: Redis;
    }
}
