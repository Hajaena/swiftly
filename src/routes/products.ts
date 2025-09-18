import { FastifyInstance } from 'fastify';
import { env } from '../env';
import fs from 'fs';
import { bumpVersion, readProductsCache, writeProductsCache } from '../lib/cache.js';
import path from 'path';

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

        const where: any = {}; // Filtrage à implémenter

        const take = Math.min(Number(page_size), 100);
        const skip = (Number(page) - 1) * take;

        const [items, total] = await app.prisma.$transaction([
            app.prisma.product.findMany({
                where,
                orderBy: { [sort]: order },
                skip, take,
                include: { category: true }
            }),
            app.prisma.product.count({ where })
        ]);

        const payload = { items, page, page_size: take, total, total_pages: Math.ceil(total / take) };

        if (env.CACHE_ENABLED) {
            const { key, ttl } = await readProductsCache(app, { q, category, min_price, max_price, sort, order, page, page_size }, env.CACHE_TTL_SECONDS);
            await writeProductsCache(app, key, payload, ttl);
            reply.header('x-cache', 'MISS');
        }

        return { ...payload, duration_ms: +(performance.now() - t0).toFixed(2), cached: false };
    });

    app.get('/products/:id', async (req) => {
        const { id } = req.params as any;
        return app.prisma.product.findUniqueOrThrow({ where: { id: Number(id) }, include: { category: true } });
    });

    app.addHook('preHandler', async (req, reply) => {
        if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
            const key = req.headers['x-api-key'];
            if (key !== env.API_KEY) return reply.code(401).send({ error: 'Unauthorized' });
        }
    });

    // CREATE simple
    app.post('/products', async (req) => {
        const body = req.body as any;

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
                imageurl: body.imageUrl,
                currency: body.currency ?? 'EUR',
                stock: body.stock ?? 0,
                categoryId: cat.id
            }
        });

        await bumpVersion(app);
        return product;
    });
    app.post('/products/upload', async (req, reply) => {
        try {
            const data = req.body as any;

            // Récupérer le fichier
            const file = data.image;
            if (!file || !file.filename) {
                return reply.status(400).send({ message: "Le fichier image est manquant." });
            }

            // Sauvegarder l'image sur le serveur
            const imagePath = `uploads/${Date.now()}-${file.filename}`;
            const dir = imagePath.split('/').slice(0, -1).join('/');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            await fs.promises.writeFile(imagePath, await file.toBuffer());

            // Construire un objet “plain” avec uniquement des scalaires
            const formData = {
                sku: data.sku?.value ?? String(data.sku),
                name: data.name?.value ?? String(data.name),
                description: data.description?.value ?? (data.description ? String(data.description) : null),
                price: parseFloat(data.price?.value ?? String(data.price)),
                currency: data.currency?.value ?? (data.currency ? String(data.currency) : 'EUR'),
                stock: Number(data.stock?.value ?? data.stock ?? 0),
                category: data.category?.value ?? (data.category ? String(data.category) : 'uncategorized')
            };

            // Vérifier si la catégorie existe
            let cat = await app.prisma.category.findUnique({
                where: { name: formData.category }
            });
            if (!cat) {
                cat = await app.prisma.category.create({
                    data: { name: formData.category }
                });
            }
            const publicImageUrl = `/uploads/${path.basename(imagePath)}`;
            // Créer le produit avec des scalaires
            const product = await app.prisma.product.create({
                data: {
                    sku: formData.sku,
                    name: formData.name,
                    description: formData.description,
                    price: formData.price,
                    currency: formData.currency,
                    stock: formData.stock,
                    imageurl: publicImageUrl,
                    categoryId: cat.id
                }
            });

            console.log("Produit créé avec succès :", product);
            await bumpVersion(app);
            return product;

        } catch (error) {
            console.error('Erreur lors de la création du produit :', error);
            return reply.status(500).send({ message: 'Erreur lors de l\'ajout du produit.' });
        }
    });



    // UPDATE
    app.put('/products/:id', async (req) => {
        const { id } = req.params as any;
        const body = req.body as any;
        let categoryId: number | undefined;

        if (body.category) {
            const cat = await app.prisma.category.upsert({
                where: { name: body.category },
                create: { name: body.category },
                update: {}
            });
            categoryId = cat.id;
        }

        const product = await app.prisma.product.update({
            where: { id: Number(id) },
            data: {
                sku: body.sku,
                name: body.name,
                description: body.description,
                price: body.price,
                imageurl: body.imageUrl,
                currency: body.currency,
                stock: body.stock,
                ...(categoryId ? { categoryId } : {})
            }
        });

        await bumpVersion(app);
        return product;
    });

    // DELETE
    app.delete('/products/:id', async (req) => {
        const { id } = req.params as any;
        await app.prisma.product.delete({ where: { id: Number(id) } });
        await bumpVersion(app);
        return { ok: true };
    });
}
