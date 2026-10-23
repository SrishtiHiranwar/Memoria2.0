import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { z, ZodError, type ZodType } from 'zod';
import { authenticate, issueToken, requireRole } from './lib/auth.js';
import { AIServiceError, HttpError } from './lib/errors.js';
import { prisma } from './lib/prisma.js';
import {
  alertFallbackSchema,
  assignStorySchema,
  careGoalCreateSchema,
  careMeasurementSchema,
  captionSchema,
  emptyBodySchema,
  idSchema,
  loginSchema,
  medicalRecordAnalysisSchema,
  patientCreateSchema,
  patientStoryTranslateSchema,
  sceneSchema,
  sessionCompleteSchema,
  sessionCreateSchema,
  storyDraftUpdateSchema,
  storyGenerateSchema,
} from './lib/schemas.js';
import { analyzeMedicalRecord, draftStory, summarizeSession, translatePatientStories } from './services/gemini.js';
import { requireStoryTransition } from './services/story-status.js';
import { addLicensedImages } from './services/wikimedia.js';

const app = express();
const uploadsDirectory = process.env.UPLOADS_DIRECTORY
  ? path.resolve(process.env.UPLOADS_DIRECTORY)
  : fileURLToPath(new URL('../uploads/', import.meta.url));
const medicalRecordsDirectory = path.join(uploadsDirectory, 'medical-records');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
const medicalRecordUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait and try again.' },
});
const generationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many story drafts were requested. Please wait before trying again.' },
});
const translationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many translation requests. Please wait before trying again.' },
});
const medicalRecordLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many medical record evaluations. Please wait before trying again.' },
});
const medicalUploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many medical records were uploaded. Please wait before trying again.' },
});

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '100kb' }));

function body<T>(schema: ZodType<T>, request: Request): T {
  return schema.parse(request.body);
}

function routeId(value: string | string[] | undefined) {
  if (typeof value !== 'string') throw new HttpError(400, 'A valid resource ID is required.');
  return idSchema.parse(value);
}

function doctorId(request: Request) {
  if (!request.auth || request.auth.role !== 'DOCTOR') throw new HttpError(403, 'Doctor access is required.');
  return request.auth.sub;
}

function patientId(request: Request) {
  if (!request.auth || request.auth.role !== 'PATIENT' || !request.auth.patientId) {
    throw new HttpError(403, 'Patient access is required.');
  }
  return request.auth.patientId;
}

async function ownedPatient(id: string, ownerId: string) {
  const patient = await prisma.patient.findFirst({ where: { id, createdByDoctorId: ownerId } });
  if (!patient) throw new HttpError(404, 'Patient not found.');
  return patient;
}

async function ownedStory(id: string, ownerId: string) {
  const story = await prisma.story.findFirst({
    where: { id, patient: { createdByDoctorId: ownerId } },
  });
  if (!story) throw new HttpError(404, 'Story not found.');
  return story;
}

function serializedStory<T extends { scenesJson: string }>(story: T) {
  return { ...story, scenes: JSON.parse(story.scenesJson) as unknown, scenesJson: undefined };
}

function serializedMedicalRecord<T extends {
  id: string;
  patientId: string;
  fileName: string;
  mimeType: string;
  analysisJson: string | null;
  evaluatedAt: Date | null;
  uploadedByRole: string;
  createdAt: Date;
}>(record: T) {
  return {
    id: record.id,
    patientId: record.patientId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    evaluatedAt: record.evaluatedAt,
    uploadedByRole: record.uploadedByRole,
    createdAt: record.createdAt,
    contentUrl: `/medical-records/${record.id}/content`,
    analysis: record.analysisJson ? medicalRecordAnalysisSchema.parse(JSON.parse(record.analysisJson) as unknown) : null,
  };
}

async function accessibleMedicalRecord(id: string, request: Request) {
  const record = await prisma.medicalRecord.findUnique({ where: { id }, include: { patient: true } });
  if (!record) throw new HttpError(404, 'Medical record not found.');
  if (request.auth?.role === 'DOCTOR') {
    await ownedPatient(record.patientId, request.auth.sub);
  } else if (request.auth?.role !== 'PATIENT' || request.auth.patientId !== record.patientId) {
    throw new HttpError(404, 'Medical record not found.');
  }
  return record;
}

async function storeMedicalRecord(request: Request, patientRecord: { id: string }) {
  const file = request.file;
  if (!file) throw new HttpError(400, 'Choose a PDF or image record to upload.');
  const detected = await fileTypeFromBuffer(file.buffer);
  const allowedTypes = new Map([
    ['application/pdf', 'pdf'],
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ]);
  const extension = detected ? allowedTypes.get(detected.mime) : undefined;
  if (!detected || !extension) {
    throw new HttpError(400, 'Upload a valid PDF, JPEG, PNG, or WebP medical record.');
  }
  const filename = `${randomUUID()}.${extension}`;
  const filePath = path.join(medicalRecordsDirectory, filename);
  await mkdir(medicalRecordsDirectory, { recursive: true, mode: 0o700 });
  await writeFile(filePath, file.buffer, { flag: 'wx', mode: 0o600 });
  try {
    const uploadedName = path.basename(file.originalname).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) || 'Medical record';
    const record = await prisma.medicalRecord.create({
      data: {
        patientId: patientRecord.id,
        fileName: uploadedName,
        mimeType: detected.mime,
        filePath: filename,
        uploadedByRole: request.auth!.role,
      },
    });
    return serializedMedicalRecord(record);
  } catch (error) {
    try {
      await unlink(filePath);
    } catch (cleanupError) {
      console.error('Could not remove medical record file after save failure:', cleanupError);
    }
    throw error;
  }
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<unknown>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response))
      .then((result) => {
        if (!response.headersSent) response.json(result);
      })
      .catch(next);
  };
}

app.get('/health', (_request, response) => response.json({ status: 'ok' }));

app.get('/photos/:id/content', authenticate, asyncRoute(async (request, response) => {
  const id = routeId(request.params.id);
  const photo = await prisma.photo.findUnique({ where: { id } });
  if (!photo) throw new HttpError(404, 'Photo not found.');
  if (request.auth!.role === 'DOCTOR') {
    await ownedPatient(photo.patientId, request.auth!.sub);
  } else {
    const stories = await prisma.story.findMany({
      where: {
        patientId: patientId(request),
        status: 'ASSIGNED',
      },
      select: { scenesJson: true },
    });
    const referenced = stories.some((story) => {
      const parsedScenes = sceneSchema.array().safeParse(JSON.parse(story.scenesJson) as unknown);
      return parsedScenes.success && parsedScenes.data.some((scene) => scene.photoId === photo.id);
    });
    if (!referenced) throw new HttpError(404, 'Photo not found.');
  }

  const filename = path.basename(photo.imageUrl);
  const filePath = path.join(uploadsDirectory, filename);
  let contents: Buffer;
  try {
    contents = await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Photo file not found.');
    throw error;
  }
  const extension = path.extname(filename).toLowerCase();
  const contentType = ({
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  } as Record<string, string>)[extension];
  if (!contentType) throw new HttpError(404, 'Photo file not found.');
  response.type(contentType).setHeader('Cache-Control', 'private, max-age=300').send(contents);
}));

app.post('/auth/login', loginLimiter, asyncRoute(async (request, response) => {
  const input = body(loginSchema, request);
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  const role = z.enum(['DOCTOR', 'PATIENT']).parse(user.role);
  const token = issueToken({ sub: user.id, role, patientId: user.patientId });
  return { token, user: { id: user.id, email: user.email, role, patientId: user.patientId } };
}));

app.get('/auth/me', authenticate, asyncRoute(async (request) => {
  const user = await prisma.user.findUnique({
    where: { id: request.auth!.sub },
    select: { id: true, email: true, role: true, patientId: true },
  });
  if (!user) throw new HttpError(401, 'Your account could not be found. Please sign in again.');
  return { user };
}));

app.post('/patients', authenticate, requireRole('DOCTOR'), asyncRoute(async (request) => {
  const input = body(patientCreateSchema, request);
  const ownerId = doctorId(request);
  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, 'That email is already in use.');
  const passwordHash = await bcrypt.hash(input.password, 10);
  const patient = await prisma.$transaction(async (transaction) => {
    const created = await transaction.patient.create({
      data: { name: input.name, createdByDoctorId: ownerId },
    });
    await transaction.user.create({
      data: {
        email,
        passwordHash,
        role: 'PATIENT',
        patientId: created.id,
      },
    });
    return created;
  });
  return { patient };
}));

app.get('/patients', authenticate, requireRole('DOCTOR'), asyncRoute(async (request) => {
  const patients = await prisma.patient.findMany({
    where: { createdByDoctorId: doctorId(request) },
    orderBy: { name: 'asc' },
    include: {
      user: { select: { id: true, email: true } },
      photos: { orderBy: { createdAt: 'desc' } },
      stories: { orderBy: { createdAt: 'desc' } },
      medicalRecords: { orderBy: { createdAt: 'desc' } },
      careGoals: { include: { measurements: { orderBy: { measuredAt: 'asc' } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  return {
    patients: patients.map((patient) => ({
      ...patient,
      photos: patient.photos.map((photo) => ({
        ...photo,
        imageUrl: photo.imageUrl.startsWith('/uploads/') ? `/photos/${photo.id}/content` : photo.imageUrl,
      })),
      stories: patient.stories.map(serializedStory),
      medicalRecords: patient.medicalRecords.map(serializedMedicalRecord),
    })),
  };
}));

app.post(
  '/patients/:id/medical-records',
  authenticate,
  requireRole('DOCTOR'),
  medicalUploadLimiter,
  medicalRecordUpload.single('record'),
  asyncRoute(async (request) => {
    const patient = await ownedPatient(routeId(request.params.id), doctorId(request));
    const record = await storeMedicalRecord(request, patient);
    return { record };
  }),
);

app.post(
  '/me/medical-records',
  authenticate,
  requireRole('PATIENT'),
  medicalUploadLimiter,
  medicalRecordUpload.single('record'),
  asyncRoute(async (request) => {
    const patient = await prisma.patient.findUnique({ where: { id: patientId(request) }, select: { id: true } });
    if (!patient) throw new HttpError(404, 'Patient not found.');
    const record = await storeMedicalRecord(request, patient);
    return { record };
  }),
);

app.get('/medical-records/:id/content', authenticate, asyncRoute(async (request, response) => {
  const record = await accessibleMedicalRecord(routeId(request.params.id), request);
  const safePath = path.join(medicalRecordsDirectory, path.basename(record.filePath));
  let contents: Buffer;
  try {
    contents = await readFile(safePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Medical record file not found.');
    throw error;
  }
  const safeName = record.fileName.replace(/["\\\r\n]/g, '_');
  response
    .type(record.mimeType)
    .setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName.replace(/[^A-Za-z0-9._ -]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(record.fileName)}`,
    )
    .setHeader('Cache-Control', 'private, no-store')
    .setHeader('X-Content-Type-Options', 'nosniff')
    .send(contents);
}));

app.post('/medical-records/:id/evaluate', authenticate, medicalRecordLimiter, asyncRoute(async (request) => {
  const record = await accessibleMedicalRecord(routeId(request.params.id), request);
  const filePath = path.join(medicalRecordsDirectory, path.basename(record.filePath));
  let contents: Buffer;
  try {
    contents = await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Medical record file not found.');
    throw error;
  }
  const analysis = await analyzeMedicalRecord(contents, record.mimeType);
  const evaluatedAt = new Date();
  const updated = await prisma.medicalRecord.update({
    where: { id: record.id },
    data: { analysisJson: JSON.stringify(analysis), evaluatedAt },
  });
  return { record: serializedMedicalRecord(updated), ai_generated: true, label: 'AI-extracted information · verify against the original record' };
}));

app.post('/patients/:id/care-goals', authenticate, requireRole('DOCTOR'), asyncRoute(async (request) => {
  const patient = await ownedPatient(routeId(request.params.id), doctorId(request));
  const input = body(careGoalCreateSchema, request);
  const goal = await prisma.careGoal.create({
    data: {
      patientId: patient.id,
      title: input.title,
      measure: input.measure,
      unit: input.unit,
      baselineValue: input.baselineValue,
      targetValue: input.targetValue,
      reviewDate: input.reviewDate ? new Date(`${input.reviewDate}T00:00:00.000Z`) : undefined,
      notes: input.notes || null,
    },
    include: { measurements: { orderBy: { measuredAt: 'asc' } } },
  });
  return { goal };
}));

app.post('/care-goals/:id/measurements', authenticate, requireRole('DOCTOR'), asyncRoute(async (request) => {
  const goalId = routeId(request.params.id);
  const goal = await prisma.careGoal.findFirst({
    where: { id: goalId, patient: { createdByDoctorId: doctorId(request) } },
  });
  if (!goal) throw new HttpError(404, 'Care goal not found.');
  const input = body(careMeasurementSchema, request);
  const measurement = await prisma.careMeasurement.create({
    data: {
      goalId: goal.id,
      value: input.value,
      measuredAt: input.measuredAt ? new Date(input.measuredAt) : undefined,
      note: input.note || null,
    },
  });
  return { measurement };
}));

app.get('/patients/:id/health-data', authenticate, requireRole('DOCTOR'), asyncRoute(async (request) => {
  const patient = await ownedPatient(routeId(request.params.id), doctorId(request));
  const [records, careGoals] = await Promise.all([
    prisma.medicalRecord.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: 'desc' } }),
    prisma.careGoal.findMany({
      where: { patientId: patient.id },
      include: { measurements: { orderBy: { measuredAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return { records: records.map(serializedMedicalRecord), careGoals };
}));

app.get('/me/health-data', authenticate, requireRole('PATIENT'), asyncRoute(async (request) => {
  const id = patientId(request);
  const [records, careGoals] = await Promise.all([
    prisma.medicalRecord.findMany({ where: { patientId: id }, orderBy: { createdAt: 'desc' } }),
    prisma.careGoal.findMany({
      where: { patientId: id },
      include: { measurements: { orderBy: { measuredAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return { records: records.map(serializedMedicalRecord), careGoals };
}));

app.post(
  '/patients/:id/photos',
  authenticate,
  requireRole('DOCTOR'),
  upload.single('photo'),
  asyncRoute(async (request) => {
    const ownerId = doctorId(request);
    const id = routeId(request.params.id);
    const patient = await ownedPatient(id, ownerId);
    const { caption } = captionSchema.parse(request.body);
    const file = request.file;
    if (!file) throw new HttpError(400, 'Choose an image to upload.');
    const detected = await fileTypeFromBuffer(file.buffer);
    const extensions = new Map([
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
      ['image/gif', 'gif'],
    ]);
    const extension = detected ? extensions.get(detected.mime) : undefined;
    if (!extension) throw new HttpError(400, 'Upload a valid JPEG, PNG, WebP, or GIF image.');
    const filename = `${randomUUID()}.${extension}`;
    await mkdir(uploadsDirectory, { recursive: true });
    await writeFile(path.join(uploadsDirectory, filename), file.buffer, { flag: 'wx' });
    const photo = await prisma.photo.create({
      data: { patientId: patient.id, imageUrl: `/uploads/${filename}`, caption },
    });
    return { photo: { ...photo, imageUrl: `/photos/${photo.id}/content` } };
  }),
);

app.post('/patients/:id/stories/generate', authenticate, requireRole('DOCTOR'), generationLimiter, asyncRoute(async (request) => {
  const patient = await ownedPatient(routeId(request.params.id), doctorId(request));
  const { prompt } = body(storyGenerateSchema, request);
  const photos = await prisma.photo.findMany({
    where: { patientId: patient.id },
    select: { id: true, caption: true },
    orderBy: { createdAt: 'asc' },
  });
  const generated = await draftStory(prompt, photos);
  const parsedScenes = await addLicensedImages(generated.scenes.map((scene) => sceneSchema.parse(scene)));
  const referencedPhotoIds = new Set(photos.map((photo) => photo.id));
  if (parsedScenes.some((scene) => scene.photoId !== null && !referencedPhotoIds.has(scene.photoId))) {
    throw new HttpError(502, 'The story draft referred to a photo that is not available for this patient.');
  }
  const story = await prisma.story.create({
    data: {
      patientId: patient.id,
      title: generated.title,
      prompt,
      status: 'DRAFT',
      scenesJson: JSON.stringify(parsedScenes),
    },
  });
  return { story: serializedStory(story), ai_generated: true };
}));

app.patch('/stories/:id', authenticate, requireRole('DOCTOR'), asyncRoute(async (request) => {
  const story = await ownedStory(routeId(request.params.id), doctorId(request));
  if (story.status !== 'DRAFT') throw new HttpError(409, 'Reset this story to DRAFT before editing it.');
  const input = body(storyDraftUpdateSchema, request);
  const patientPhotoIds = new Set((await prisma.photo.findMany({
    where: { patientId: story.patientId },
    select: { id: true },
  })).map((photo) => photo.id));
  const scenes = input.scenes.map((scene) => sceneSchema.parse(scene));
  if (scenes.some((scene) => scene.photoId !== null && !patientPhotoIds.has(scene.photoId))) {
    throw new HttpError(400, 'Every story scene must use a photo belonging to this patient.');
  }
  if (scenes.some((scene) => !scene.answerOptions.includes(scene.expectedAnswer))) {
    throw new HttpError(400, 'Each scene must include its expected answer as an answer choice.');
  }
  const updated = await prisma.story.update({
    where: { id: story.id },
    data: {
      title: input.title,
      prompt: input.prompt,
      scenesJson: JSON.stringify(scenes),
      experienceMode: input.experienceMode,
    },
  });
  return { story: serializedStory(updated) };
}));

app.post('/stories/:id/reset', authenticate, requireRole('DOCTOR'), asyncRoute(async (request) => {
  body(emptyBodySchema, request);
  const story = await ownedStory(routeId(request.params.id), doctorId(request));
  if (story.status !== 'APPROVED' && story.status !== 'ASSIGNED') {
    throw new HttpError(409, 'Only an APPROVED or ASSIGNED story can be reset.');
  }
  const activeSession = await prisma.session.findFirst({
    where: { storyId: story.id, endedAt: null },
  });
  if (activeSession) {
    throw new HttpError(409, 'A patient session for this story is still open. Sign in to the patient account and resume and finish the story before resetting it.');
  }
  const updated = await prisma.story.update({
    where: { id: story.id },
    data: { status: 'DRAFT', approvedAt: null, assignedAt: null },
  });
  return { story: serializedStory(updated) };
}));

app.post('/stories/:id/approve', authenticate, requireRole('DOCTOR'), asyncRoute(async (request) => {
  body(emptyBodySchema, request);
  const story = await ownedStory(routeId(request.params.id), doctorId(request));
  requireStoryTransition(story.status, 'APPROVED');
  const updated = await prisma.story.update({
    where: { id: story.id },
    data: { status: 'APPROVED', approvedAt: new Date() },
  });
  return { story: serializedStory(updated) };
}));

app.post('/stories/:id/assign', authenticate, requireRole('DOCTOR'), asyncRoute(async (request) => {
  const story = await ownedStory(routeId(request.params.id), doctorId(request));
  requireStoryTransition(story.status, 'ASSIGNED');
  const { patientId: targetPatientId } = body(assignStorySchema, request);
  const target = await ownedPatient(targetPatientId, doctorId(request));
  if (story.patientId !== target.id) {
    throw new HttpError(409, 'This story uses photos for a different patient and cannot be reassigned.');
  }
  const updated = await prisma.story.update({
    where: { id: story.id },
    data: { status: 'ASSIGNED', assignedAt: new Date() },
  });
  return { story: serializedStory(updated) };
}));

app.get('/alerts', authenticate, requireRole('DOCTOR'), asyncRoute(async (request) => {
  const alerts = await prisma.alert.findMany({
    where: { patient: { createdByDoctorId: doctorId(request) } },
    include: { patient: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return { alerts };
}));

app.post('/alerts/:id/acknowledge', authenticate, requireRole('DOCTOR'), asyncRoute(async (request) => {
  body(emptyBodySchema, request);
  const id = routeId(request.params.id);
  const alert = await prisma.alert.findFirst({
    where: { id, patient: { createdByDoctorId: doctorId(request) } },
  });
  if (!alert) throw new HttpError(404, 'Alert not found.');
  const updated = await prisma.alert.update({
    where: { id },
    data: { acknowledgedAt: alert.acknowledgedAt ?? new Date() },
  });
  return { alert: updated };
}));

app.get('/sessions/:id/summary', authenticate, requireRole('DOCTOR'), asyncRoute(async (request) => {
  const session = await prisma.session.findFirst({
    where: { id: routeId(request.params.id), patient: { createdByDoctorId: doctorId(request) } },
  });
  if (!session) throw new HttpError(404, 'Session not found.');
  if (!session.endedAt || !session.resultsJson) throw new HttpError(409, 'This session is not complete yet.');
  const summary = session.summaryJson
    ? JSON.parse(session.summaryJson) as unknown
    : await summarizeSession(JSON.parse(session.resultsJson) as unknown);
  if (!session.summaryJson) {
    await prisma.session.update({ where: { id: session.id }, data: { summaryJson: JSON.stringify(summary) } });
  }
  return { ai_generated: true, label: 'AI-generated, for doctor review', summary };
}));

app.get('/sessions', authenticate, requireRole('DOCTOR'), asyncRoute(async (request) => {
  const sessions = await prisma.session.findMany({
    where: { patient: { createdByDoctorId: doctorId(request) } },
    include: {
      patient: { select: { id: true, name: true } },
      story: { select: { id: true, title: true } },
    },
    orderBy: { startedAt: 'desc' },
  });
  return { sessions };
}));

app.get('/me/stories', authenticate, requireRole('PATIENT'), asyncRoute(async (request) => {
  const stories = await prisma.story.findMany({
    where: { patientId: patientId(request), status: 'ASSIGNED' },
    orderBy: { assignedAt: 'desc' },
  });
  return { stories: stories.map(serializedStory) };
}));

app.post('/me/stories/translate', authenticate, requireRole('PATIENT'), translationLimiter, asyncRoute(async (request) => {
  const input = body(patientStoryTranslateSchema, request);
  const stories = await prisma.story.findMany({
    where: {
      id: { in: input.storyIds },
      patientId: patientId(request),
      status: 'ASSIGNED',
    },
    orderBy: { assignedAt: 'desc' },
  });
  if (stories.length !== input.storyIds.length) throw new HttpError(404, 'One or more assigned stories could not be found.');
  const translations = await translatePatientStories(stories.map((story) => ({
    id: story.id,
    title: story.title,
    scenes: JSON.parse(story.scenesJson) as Array<{
      narration: string;
      recallQuestion: string;
      expectedAnswer: string;
      answerOptions: string[];
    }>,
  })));
  return translations;
}));

app.get('/me/sessions/active', authenticate, requireRole('PATIENT'), asyncRoute(async (request) => {
  const sessions = await prisma.session.findMany({
    where: {
      patientId: patientId(request),
      endedAt: null,
      story: { status: 'ASSIGNED' },
    },
    include: { story: true },
    orderBy: { startedAt: 'desc' },
  });
  return {
    sessions: sessions.map((session) => ({
      id: session.id,
      storyId: session.storyId,
      startedAt: session.startedAt,
      story: serializedStory(session.story),
    })),
  };
}));

app.get('/me/photos', authenticate, requireRole('PATIENT'), asyncRoute(async (request) => {
  const stories = await prisma.story.findMany({
    where: { patientId: patientId(request), status: 'ASSIGNED' },
    select: { scenesJson: true },
  });
  const photoIds = new Set<string>();
  for (const story of stories) {
    for (const scene of sceneSchema.array().parse(JSON.parse(story.scenesJson))) {
      if (scene.photoId !== null) photoIds.add(scene.photoId);
    }
  }
  const photos = await prisma.photo.findMany({
    where: { patientId: patientId(request), id: { in: [...photoIds] } },
  });
  return {
    photos: photos.map((photo) => ({
      ...photo,
      imageUrl: photo.imageUrl.startsWith('/uploads/') ? `/photos/${photo.id}/content` : photo.imageUrl,
    })),
  };
}));

app.post('/sessions', authenticate, requireRole('PATIENT'), asyncRoute(async (request) => {
  const { storyId } = body(sessionCreateSchema, request);
  const assignedStory = await prisma.story.findFirst({
    where: { id: storyId, patientId: patientId(request), status: 'ASSIGNED' },
  });
  if (!assignedStory) throw new HttpError(404, 'That story is not assigned to this patient.');
  const activeSession = await prisma.session.findFirst({
    where: { storyId: assignedStory.id, endedAt: null },
  });
  if (activeSession) throw new HttpError(409, 'This story is already open in another session.');
  const session = await prisma.session.create({
    data: { storyId, patientId: patientId(request), caregiverPresent: true },
  });
  return { session };
}));

app.post('/sessions/:id/complete', authenticate, requireRole('PATIENT'), asyncRoute(async (request) => {
  const session = await prisma.session.findFirst({
    where: { id: routeId(request.params.id), patientId: patientId(request) },
    include: { story: true },
  });
  if (!session) throw new HttpError(404, 'Session not found.');
  if (session.endedAt) throw new HttpError(409, 'This session has already been completed.');
  requireStoryTransition(session.story.status, 'COMPLETED');
  const input = body(sessionCompleteSchema, request);
  const scenes = sceneSchema.array().parse(JSON.parse(session.story.scenesJson));
  if (input.answers.length !== scenes.length) throw new HttpError(400, 'Please answer each story question before finishing.');
  const indexes = new Set(input.answers.map((answer) => answer.sceneIndex));
  if (indexes.size !== scenes.length || scenes.some((_scene, index) => !indexes.has(index))) {
    throw new HttpError(400, 'Each story question must have exactly one answer.');
  }
  const results = input.answers.map((answer) => {
    const scene = scenes[answer.sceneIndex];
    if (!scene.answerOptions.includes(answer.selectedAnswer)) {
      throw new HttpError(400, 'An answer does not match the choices for that question.');
    }
    return {
      sceneIndex: answer.sceneIndex,
      question: scene.recallQuestion,
      selectedAnswer: answer.selectedAnswer,
      isCorrect: answer.selectedAnswer === scene.expectedAnswer,
    };
  });
  const completedAt = new Date();
  await prisma.$transaction([
    prisma.session.update({
      where: { id: session.id },
      data: { endedAt: completedAt, resultsJson: JSON.stringify(results) },
    }),
    prisma.story.update({
      where: { id: session.storyId },
      data: { status: 'COMPLETED' },
    }),
  ]);

  let summary: unknown = null;
  let summaryError: string | null = null;
  try {
    summary = await summarizeSession(results);
    await prisma.session.update({
      where: { id: session.id },
      data: { summaryJson: JSON.stringify(summary) },
    });
  } catch (error) {
    if (!(error instanceof AIServiceError)) throw error;
    summaryError = error.message;
  }
  return {
    session: { id: session.id, endedAt: completedAt },
    ai_generated: summary !== null,
    label: summary ? 'AI-generated, for doctor review' : null,
    summary,
    summaryError,
  };
}));

app.post('/alerts', authenticate, requireRole('PATIENT'), asyncRoute(async (request) => {
  body(z.object({}).strict(), request);
  const alert = await prisma.alert.create({ data: { patientId: patientId(request) } });
  return { alert };
}));

app.get('/me/alerts/:id', authenticate, requireRole('PATIENT'), asyncRoute(async (request) => {
  const id = routeId(request.params.id);
  const alert = await prisma.alert.findFirst({ where: { id, patientId: patientId(request) } });
  if (!alert) throw new HttpError(404, 'Alert not found.');
  const shouldShowFallback = !alert.acknowledgedAt && Date.now() - alert.createdAt.getTime() >= 2 * 60 * 1000;
  const updated = shouldShowFallback && !alert.fallbackShownAt
    ? await prisma.alert.update({ where: { id }, data: { fallbackShownAt: new Date() } })
    : alert;
  return {
    alert: updated,
    showFallback: Boolean(updated.fallbackShownAt && !updated.acknowledgedAt),
    fallbackMessage: updated.fallbackShownAt && !updated.acknowledgedAt
      ? 'Your caregiver has been told. Please wait here, or ask someone nearby.'
      : null,
  };
}));

app.post('/me/alerts/:id/fallback', authenticate, requireRole('PATIENT'), asyncRoute(async (request) => {
  body(alertFallbackSchema, request);
  const id = routeId(request.params.id);
  const alert = await prisma.alert.findFirst({ where: { id, patientId: patientId(request) } });
  if (!alert) throw new HttpError(404, 'Alert not found.');
  if (Date.now() - alert.createdAt.getTime() < 2 * 60 * 1000) {
    throw new HttpError(409, 'The caregiver has not had time to respond yet.');
  }
  const updated = alert.fallbackShownAt
    ? alert
    : await prisma.alert.update({ where: { id }, data: { fallbackShownAt: new Date() } });
  return {
    alert: updated,
    message: 'Your caregiver has been told. Please wait here, or ask someone nearby.',
  };
}));

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (response.headersSent) return;
  if (error instanceof ZodError) {
    response.status(400).json({ error: 'Please check the information and try again.', details: error.issues });
    return;
  }
  if (error instanceof multer.MulterError) {
    response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: error.code === 'LIMIT_FILE_SIZE' ? 'Images must be 5 MB or smaller.' : 'The image upload could not be processed.',
    });
    return;
  }
  if (error instanceof HttpError || error instanceof AIServiceError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error('Request failed:', error);
  response.status(500).json({ error: 'Something went wrong. Please try again.' });
});

export { app };
