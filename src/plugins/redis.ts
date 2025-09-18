import fp from 'fastify-plugin'
import Redis from 'ioredis'
import { env } from '../env'
import { FastifyInstance } from 'fastify'

declare module 'fastify' {
    interface FastifyInstance {
        redis: Redis
    }
}

export default fp(async (app: FastifyInstance) => {
    const redis = new Redis(env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
    })

    try {
        await redis.connect()
        app.log.info('Redis connecté')
    } catch (err) {
        app.log.error(err as Error, 'Impossible de se connecter à Redis')
        throw err
    }

    app.decorate('redis', redis)

    app.addHook('onClose', async () => {
        await redis.quit()
        app.log.info('Redis déconnecté proprement')
    })
})
