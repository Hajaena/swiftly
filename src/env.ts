import 'dotenv/config';

function required(name: string, def?: string) {
    const v = process.env[name] ?? def;
    if (v === undefined) throw new Error(`Missing env ${name}`);
    return v;
}

export const env = {
    PORT: Number(required('PORT', '3000')),
    DATABASE_URL: required('DATABASE_URL'),
    REDIS_URL: required('REDIS_URL'),
    API_KEY: required('API_KEY', 'dev-admin-key'),
    CACHE_ENABLED: (required('CACHE_ENABLED', '1') === '1'),
    CACHE_TTL_SECONDS: Number(required('CACHE_TTL_SECONDS', '60')),
    NODE_ENV: required('NODE_ENV', 'development')
} as const;
