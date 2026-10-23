import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({
  path: [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
  ],
});

process.env.DATABASE_URL ??= 'file:./dev.db';
