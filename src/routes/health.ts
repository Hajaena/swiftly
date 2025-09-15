import { FastifyInstance } from 'fastify';
export default async function (app: FastifyInstance) {
    app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));
}
