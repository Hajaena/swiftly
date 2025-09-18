import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import fastifyMultipart from '@fastify/multipart';
import { fileURLToPath } from 'url';
import { env } from './env';
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import healthRoute from './routes/health.js';
import productsRoute from './routes/products.js';
import fastifyStatic from '@fastify/static';
import path from 'path';

const app = Fastify({ logger: true });

await app.register(cors, {
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    preflightContinue: true, 
    optionsSuccessStatus: 200,
});
await app.register(helmet);
await app.register(rateLimit, { max: 500, timeWindow: '1 minute' });
await app.register(prismaPlugin);
await app.register(redisPlugin);

// Swagger
await app.register(swagger, {
    openapi: {
        info: { title: 'Ecom API (Fastify + Redis)', version: '1.0.0' },
        servers: [{ url: 'http://localhost:' + env.PORT }]
    }
});
await app.register(swaggerUI, { routePrefix: '/docs', staticCSP: true });

await app.register(fastifyMultipart, {
    attachFieldsToBody: true,
    limits: { fileSize: 10 * 1024 * 1024 }, 
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'uploads'),
    prefix: '/uploads/',
    setHeaders: (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
    }
});

await app.register(healthRoute);
await app.register(productsRoute);

app.listen({ port: env.PORT, host: '0.0.0.0' })
    .then(() => app.log.info(`API running on http://localhost:${env.PORT} | docs: /docs`))
    .catch((err) => { app.log.error(err); process.exit(1); });
