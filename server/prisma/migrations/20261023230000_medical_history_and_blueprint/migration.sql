CREATE TABLE "MedicalRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "analysisJson" TEXT,
    "evaluatedAt" DATETIME,
    "uploadedByRole" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MedicalRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MedicalRecord_patientId_createdAt_idx" ON "MedicalRecord"("patientId", "createdAt");

CREATE TABLE "CareGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "measure" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "baselineValue" REAL,
    "targetValue" REAL,
    "reviewDate" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CareGoal_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CareGoal_patientId_createdAt_idx" ON "CareGoal"("patientId", "createdAt");

CREATE TABLE "CareMeasurement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "goalId" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "measuredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    CONSTRAINT "CareMeasurement_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "CareGoal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CareMeasurement_goalId_measuredAt_idx" ON "CareMeasurement"("goalId", "measuredAt");
