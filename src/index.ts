import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';

import { env } from './env.js';
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import healthRoute from './routes/health.js';
import productsRoute from './routes/products.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(helmet);
await app.register(rateLimit, { max: 500, timeWindow: '1 minute' });
await app.register(prismaPlugin);
await app.register(redisPlugin);

await app.register(swagger, {
    openapi: {
        info: { title: 'Ecom API (Fastify + Redis)', version: '1.0.0' },
        servers: [{ url: 'http://localhost:' + env.PORT }]
    }
});
await app.register(swaggerUI, { routePrefix: '/docs', staticCSP: true });

await app.register(healthRoute);
await app.register(productsRoute);

app.listen({ port: env.PORT, host: '0.0.0.0' })
    .then(() => app.log.info(`API running on http://localhost:${env.PORT} | docs: /docs`))
    .catch((err) => { app.log.error(err); process.exit(1); });
