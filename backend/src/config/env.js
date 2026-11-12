import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z
    .string()
    .default('5000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => val > 0 && val < 65536, {
      message: 'PORT must be an integer between 1 and 65535',
    }),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
  AGENT_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  ENABLE_VIDEO_GENERATION: z
    .string()
    .default('true')
    .transform((val) => val.trim().toLowerCase() === 'true'),

  // Database (MongoDB)
  MONGODB_URI: z
    .string()
    .default('mongodb://adpilot_user:adpilot_password@localhost:27017/adpilot?authSource=adpilot'),

  // Redis (Job Queue & Cache)
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z
    .string()
    .default('6379')
    .transform((val) => parseInt(val, 10)),
  REDIS_PASSWORD: z.string().default('adpilot_redis_pass'),
  REDIS_URL: z
    .string()
    .default('redis://:adpilot_redis_pass@localhost:6379/0'),

  // Object Storage (MinIO / S3)
  STORAGE_ENDPOINT: z.string().default('http://localhost:9000'),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_ACCESS_KEY: z.string().default('adpilot_minio_user'),
  STORAGE_SECRET_KEY: z.string().default('adpilot_minio_secret_key'),
  STORAGE_BUCKET_CREATIVES: z.string().default('adpilot-creatives'),
  STORAGE_BUCKET_ASSETS: z.string().default('adpilot-assets'),
  STORAGE_BUCKET_TEMP: z.string().default('adpilot-temp'),
  STORAGE_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((val) => val === 'true'),

  // Meta Marketing API & Analytics
  META_GRAPH_API_VERSION: z.string().default('v27.0'),
  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  META_REDIRECT_URI: z.string().default('http://localhost:5000/api/meta/oauth/callback'),
  META_FRONTEND_CALLBACK_URL: z.string().default('http://localhost:5173/settings'),
  META_TOKEN_ENCRYPTION_KEY: z.string().default(''),
  META_INSIGHTS_DEFAULT_ATTRIBUTION_WINDOWS: z.string().default('7d_click,1d_view'),
  META_RATE_LIMIT_PAUSE_THRESHOLD: z
    .string()
    .default('80')
    .transform((val) => Math.min(100, Math.max(10, parseInt(val, 10) || 80))),
  META_ALLOW_FIXTURE_SYNC: z
    .string()
    .default('true')
    .transform((val) => val === 'true'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    '❌ Invalid environment configuration:',
    JSON.stringify(parsed.error.format(), null, 2)
  );
  process.exit(1);
}

export const env = parsed.data;
