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
