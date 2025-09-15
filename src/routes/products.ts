import { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { bumpVersion, readProductsCache, writeProductsCache } from '../lib/cache.js';

export default async function (app: FastifyInstance) {

    // Schéma OpenAPI (Swagger) pour /products
    const listSchema = {
        description: 'Recherche produits (cache avec Redis)',
        querystring: {
            type: 'object',
            properties: {
                q: { type: 'string' },
                category: { type: 'string' },
                min_price: { type: 'number' },
                max_price: { type: 'number' },
                sort: { type: 'string', enum: ['price', 'createdAt'] },
                order: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
                page: { type: 'integer', minimum: 1, default: 1 },
                page_size: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
            }
        },
        response: {
            200: {
                type: 'object',
                properties: {
                    items: { type: 'array' },
                    page: { type: 'integer' },
                    page_size: { type: 'integer' },
                    total: { type: 'integer' },
                    total_pages: { type: 'integer' },
                    duration_ms: { type: 'number' },
                    cached: { type: 'boolean' }
                }
            }
        }
    };

    app.get('/products', { schema: listSchema }, async (req, reply) => {
        const t0 = performance.now();
        const { q, category, min_price, max_price, sort = 'createdAt', order = 'asc', page = 1, page_size = 20 } = req.query as any;

        const where: any = {};
        if (category) {
            const cat = await app.prisma.category.findUnique({ where: { name: String(category) } });
            where.categoryId = cat?.id ?? '__no_cat__'; // renvoie vide si cat inconnue
        }
        if (q) {
            where.OR = [
                { name: { contains: String(q), mode: 'insensitive' } },
                { description: { contains: String(q), mode: 'insensitive' } }
            ];
        }
        if (min_price || max_price) {
            where.price = {};
            if (min_price) where.price.gte = Number(min_price);
            if (max_price) where.price.lte = Number(max_price);
        }

        const queryForCache = { q, category, min_price, max_price, sort, order, page, page_size };

        if (env.CACHE_ENABLED) {
            const { key, cached, ttl } = await readProductsCache(app, queryForCache, env.CACHE_TTL_SECONDS);
            if (cached) {
                reply.header('x-cache', 'HIT');
                return { ...cached, duration_ms: +(performance.now() - t0).toFixed(2), cached: true };
            }
        }

        const take = Math.min(Number(page_size), 100);
        const skip = (Number(page) - 1) * take;

        const [items, total] = await app.prisma.$transaction([
            app.prisma.product.findMany({
                where,
                orderBy: { [sort]: order },
                skip, take,
                include: {
                    category: true
                }

            }),
            app.prisma.product.count({ where })
        ]);

        const payload = {
            items, page, page_size: take,
            total,
            total_pages: Math.ceil(total / take)
        };

        if (env.CACHE_ENABLED) {
            const { key, ttl } = await readProductsCache(app, queryForCache, env.CACHE_TTL_SECONDS);
            await writeProductsCache(app, key, payload, ttl);
            reply.header('x-cache', 'MISS');
        }

        return { ...payload, duration_ms: +(performance.now() - t0).toFixed(2), cached: false };
    });

    // Get by id (non-caché pour simplicité)
    app.get('/products/:id', async (req) => {
        const { id } = req.params as any;
        return app.prisma.product.findUniqueOrThrow({ where: { id } });
    });

    // Middleware API key pour mutations
    app.addHook('preHandler', async (req, reply) => {
        if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
            const key = req.headers['x-api-key'];
            if (key !== env.API_KEY) return reply.code(401).send({ error: 'Unauthorized' });
        }
    });

    // CREATE
    app.post('/products', async (req) => {
        const body = req.body as any;
        // cat par name
        const cat = await app.prisma.category.upsert({
            where: { name: body.category ?? 'uncategorized' },
            create: { name: body.category ?? 'uncategorized' },
            update: {}
        });
        const product = await app.prisma.product.create({
            data: {
                sku: body.sku,
                name: body.name,
                description: body.description,
                price: body.price,
                currency: body.currency ?? 'EUR',
                stock: body.stock ?? 0,
                categoryId: cat.id
            }
        });
        await bumpVersion(app);
        return product;
    });

    // UPDATE
    app.put('/products/:id', async (req) => {
        const { id } = req.params as any;
        const body = req.body as any;
        let categoryId: string | undefined;
        if (body.category) {
            const cat = await app.prisma.category.upsert({
                where: { name: body.category },
                create: { name: body.category },
                update: {}
            });
            categoryId = cat.id;
        }
        const product = await app.prisma.product.update({
            where: { id },
            data: {
                sku: body.sku,
                name: body.name,
                description: body.description,
                price: body.price,
                currency: body.currency,
                stock: body.stock,
                ...(categoryId ? { categoryId } : {})
            }
        });
        await bumpVersion(app); // invalider listes
        return product;
    });

    // DELETE
    app.delete('/products/:id', async (req) => {
        const { id } = req.params as any;
        await app.prisma.product.delete({ where: { id } });
        await bumpVersion(app);
        return { ok: true };
    });
}
