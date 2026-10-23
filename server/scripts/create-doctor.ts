import '../src/lib/env.js';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const email = process.env.INITIAL_DOCTOR_EMAIL?.trim().toLowerCase();
const password = process.env.INITIAL_DOCTOR_PASSWORD;

if (!email || !z.string().email().safeParse(email).success || !password || password.length < 12) {
  throw new Error(
    'Set INITIAL_DOCTOR_EMAIL to a valid email and INITIAL_DOCTOR_PASSWORD to a password of at least 12 characters.',
  );
}

const prisma = new PrismaClient();

try {
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new Error(`A user with email ${email} already exists; no account was changed.`);
  }

  await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'DOCTOR',
    },
  });

  console.log(`Created doctor account for ${email}.`);
} finally {
  await prisma.$disconnect();
}
