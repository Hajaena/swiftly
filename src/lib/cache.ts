import { FastifyInstance } from 'fastify';
import { sha1 } from './hash.js';

const VERSION_KEY = 'cache:products:version';

export async function getVersion(app: FastifyInstance) {
    const v = await app.redis.get(VERSION_KEY);
    return v ?? '1';
}
export async function bumpVersion(app: FastifyInstance) {
    await app.redis.incr(VERSION_KEY);
}

export function normalizeQuery(q: Record<string, any>) {
    // tri stable des clés pour une clé de cache déterministe
    const sorted = Object.keys(q).sort().reduce((acc, k) => {
        acc[k] = q[k];
        return acc;
    }, {} as Record<string, any>);
    return JSON.stringify(sorted);
}

export async function readProductsCache(app: FastifyInstance, query: Record<string, any>, ttl: number) {
    const version = await getVersion(app);
    const key = `products:v${version}:${sha1(normalizeQuery(query))}`;
    const cached = await app.redis.get(key);
    return { key, cached: cached ? JSON.parse(cached) : null, ttl };
}

export async function writeProductsCache(app: FastifyInstance, key: string, payload: any, ttl: number) {
    await app.redis.setex(key, ttl, JSON.stringify(payload));
}
