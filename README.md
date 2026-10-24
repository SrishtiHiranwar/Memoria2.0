# Memoria

A doctor-approved photo and voice story game for people with dementia, with a caregiver present and a doctor in control of story content.

> **Fictional-data prototype only.** Memoria is a student hackathon prototype, not a medical device or emergency service. Do not use real patient information or photos.

## What it does

1. A doctor creates a patient login and adds photos with captions.
2. Gemini drafts a prompt-specific story; its scene count and recall questions follow the doctor's instructions rather than a fixed template.
3. Each scene uses a matching patient photo when available or searches Wikimedia Commons for an image candidate with an allowed license and attribution.
4. The doctor reviews the generated text and image candidates, edits and approves the draft, then assigns it to the patient.
5. A caregiver signs in on the patient's device, confirms they are present, and starts the story.
6. The patient listens to each scene, sees its photo or licensed illustration, and chooses an answer to one recall question. Doctors can also add Mira's 3D garden companion to a story; she asks the same doctor-reviewed question, offers a gentle learning response, and waits without a timer.
7. The session is saved and summarized for doctor review. The patient can send an alert to the doctor's dashboard.
8. Medical history is kept in a separate area from story sessions. Doctors and patients can add PDF/image records and request AI extraction of dated facts; both can review source-linked results, charts, and clinician-authored care goals.
9. Doctors and patients can explore three built-in Three.js environments: a garden, a seaside scene, and a sunny reading room. In the garden, patients can take a gentle, choice-based walk with Mira, a cartoon companion who asks light questions, waits without a timer, and responds warmly to each choice.

Stories follow a backend-enforced lifecycle: `DRAFT → APPROVED → ASSIGNED → COMPLETED`. A doctor must reset an approved or assigned story to draft before editing. Patient endpoints return only assigned stories and photos referenced by those stories.

## Roles

| Role | Account | Permissions |
|---|---|---|
| Doctor | Doctor login | Creates patients and logins, uploads photos and medical-history records, reviews AI-extracted history, writes care goals and measurements, drafts/edits/approves/assigns standard or Mira 3D companion stories, reviews sessions and acknowledges alerts |
| Patient | Login created by doctor | Reads assigned stories, starts a session only after confirming a caregiver is present, answers recall questions in the standard player or with Mira in the story's 3D garden, sends a caregiver alert, uploads/views their own history and views shared care goals |
| Caregiver | No separate account | Uses the patient login on the patient's device and confirms their presence before a story starts |

## Stack

- Client: React + TypeScript + Vite (`client/`)
- 3D scenes: Three.js with OrbitControls (`client/src/components/MemorySimulation.tsx`)
- API: Node.js + Express + TypeScript (`server/`)
- Validation: Zod for request bodies and Gemini output
- Database: SQLite via Prisma
- AI: Gemini via `@google/genai`; key is server-side only
- Narration: browser Web Speech API (`SpeechSynthesis`), English only

## Setup

**Prerequisites:** Node.js 20+ and npm. A Google AI Studio key is needed only for Gemini story drafting and summaries; the app and seed demo work without it.

1. Clone and install dependencies:

   ```bash
   git clone <your-repo-url> memoria
   cd memoria
   npm install
   ```

2. Optional: configure the server environment:

   ```bash
   cp .env.example server/.env
   ```

   Add your Google AI Studio key to `server/.env` as `GEMINI_API_KEY`. The key must never be put in the client or committed. The local database URL and client origin are already in `.env.example`. The server defaults to the local SQLite file when `DATABASE_URL` is not set, so this step is optional for a local demo. Without a Gemini key, sign-in and seeded stories still work, but new AI drafts and summaries are unavailable.

3. Create the SQLite database and demo logins:

   ```bash
   npm run db:generate
   npm run db:migrate --workspace @memoria/server -- --name init
   npm run db:seed
   ```

4. Start the API and Vite client together:

   ```bash
   npm run dev
   ```

   Open <http://localhost:5173>. The API health endpoint is <http://localhost:3000/health>.
   If the app says it cannot reach the server, make sure this command is still running and that both the client and API URLs are reachable from the browser.

5. Sign in with fictional demo accounts:

   - Doctor: `doctor@demo.local` / `demo-doctor`
   - Patient: `patient@demo.local` / `demo-patient`

The seed creates four simple placeholder photos and three stories (one each in DRAFT, APPROVED, and ASSIGNED status). The seed can be run repeatedly.

## Deployment

The checked-in deployment setup uses Vercel Hobby for the Vite client and Render's free web-service plan for the Express API. It deliberately has no paid persistent disk or paid add-ons. Render's free filesystem is ephemeral: the SQLite database and uploaded files can be erased whenever the service restarts, sleeps, or redeploys. Use only disposable fictional demo data, and do not upgrade plans or add paid resources if you need to avoid charges. This is not a production medical-records platform.

1. Deploy the API on Render by creating a Blueprint from this repository and selecting `render.yaml`. Confirm the service plan says **Free** and no disk or other paid resource is being added. The service applies production Prisma migrations at startup; its database and uploads stay on ephemeral storage.
2. In the Render service environment, set `CLIENT_ORIGIN` to the exact Vercel site origin (for example, `https://memoria-example.vercel.app`). Keep `JWT_SECRET` generated by Render. Leave `GEMINI_API_KEY` unset; AI features will be unavailable, and configuring a billing-enabled third-party API could incur separate charges.
3. Deploy the client on Vercel by importing this repository and setting the project root directory to `client`. Vercel detects Vite; add `VITE_API_URL` with the Render API URL (for example, `https://memoria-api.onrender.com`) and deploy.
4. Confirm the Render API health check responds at `<Render API URL>/health`.
5. Create the first doctor account without using public demo credentials: set `INITIAL_DOCTOR_EMAIL` and `INITIAL_DOCTOR_PASSWORD` in the Render service environment (use a unique password of at least 12 characters). On startup, migrations run first and the provisioning script creates this doctor only if the email is not already registered. It never overwrites an existing account. Keep these values configured so the initial doctor can be recreated if the free service's ephemeral database is lost; treat the password as a secret and change it before using the app with anything sensitive.

Only use fictional demo data. The free deployment does not provide durable storage, healthcare compliance, backup, retention, or disaster-recovery guarantees. Data may be lost at any time. Vercel Hobby and Render Free are configured to avoid paid resources, but check the provider's plan and billing screens yourself before confirming, and do not upgrade or enable paid add-ons.

## Doctor workflow

- Create a patient login from the Patients page.
- Upload JPEG, PNG, WebP, or GIF photos (maximum 5 MB) and add captions. Uploads are optional when a licensed Wikimedia image is available; if Commons is unavailable, story drafting still succeeds and the scene is left without an external image. For an image-free scene, the draft editor links to a Google Images search for manual review; results are not scraped or attached automatically.
- Enter a detailed prompt with a scene count and scene-by-scene details/questions; a topic alone is not enough. The generator creates 1–8 original scenes independently of the number of uploaded photos; the requested count and every question written in quotation marks are checked after generation. Generic questions and scenes that do not reuse a detail from the prompt or photo captions are rejected and retried rather than saved.
- Review and edit the DRAFT scenes and any Wikimedia image attribution/license before approving. Only APPROVED stories can be assigned.
- Reset an APPROVED or ASSIGNED story to DRAFT before editing it.
- In a draft story, enable **Add Mira's 3D garden to this story**, save the changes, then approve it. The patient experiences its narration and doctor-authored questions with Mira in the animated garden. This setting does not change its questions or session scoring.
- Review session summaries, acknowledge patient alerts, and preview the interactive 3D scenes from the dashboard.
- In the separate **Health history & care blueprint** area, upload a fictional or de-identified PDF/JPEG/PNG/WebP record (up to 10 MB). Request AI extraction on a saved record, then verify every extracted fact against its source. Add clinician-authored goals and dated measurements; charts show only those recorded values.

## Patient workflow

- Sign in on the patient's device with the patient login.
- Check the required caregiver-present confirmation before starting.
- View assigned stories one scene at a time. Use the listen button for browser narration, read the on-screen text, and select an answer to continue.
- If a browser closes mid-story, sign in again, confirm the caregiver is present, and choose **Resume story**. The story restarts at scene one because in-progress answers are not stored; the unfinished session is reused so the story can still be completed.
- Use the persistent **Call my caregiver** button to send an alert to the doctor's dashboard. If it is not acknowledged after two minutes, the patient screen displays: “Your caregiver has been told. Please wait here, or ask someone nearby.”
- Open **Health history & care blueprint** below the story shelf to add/view records, request extraction, view historical charts, and see goals shared by the doctor. Patients can view but cannot edit clinician-authored goals or their measurements.
- A story marked for Mira's 3D garden still plays one scene at a time: hear the narration, then answer the doctor's question with Mira. She gives gentle feedback that revisits the expected answer without penalizing a choice, and there is no response timer. The separate **Explore a 3D place** area remains available for free exploration and a standalone garden stroll; that simulation does not affect story progress.

The patient story player supports English, Hindi, Bengali, Tamil, Telugu, Spanish, and French speech when a matching voice is installed on the device/browser. The selected voice is remembered on that device. This changes speech voice only; story narration, questions, and choices remain in English and are not translated. If a language voice is missing, install it in the device's speech/accessibility settings or choose another available language.

## API overview

- Auth: `POST /auth/login`, `GET /auth/me`
- Doctor patient/photo/story flows: `GET|POST /patients`, `POST /patients/:id/photos`, `POST /patients/:id/stories/generate`, `PATCH /stories/:id`, `POST /stories/:id/reset`, `POST /stories/:id/approve`, `POST /stories/:id/assign`
- Doctor review: `GET /alerts`, `POST /alerts/:id/acknowledge`, `GET /sessions`, `GET /sessions/:id/summary`
- Separate health history: `POST /patients/:id/medical-records`, `POST /me/medical-records`, `GET /patients/:id/health-data`, `GET /me/health-data`, `GET /medical-records/:id/content`, `POST /medical-records/:id/evaluate`, `POST /patients/:id/care-goals`, `POST /care-goals/:id/measurements`
- Patient: `GET /me/stories`, `GET /me/photos`, `POST /sessions`, `POST /sessions/:id/complete`, `POST /alerts`, `GET /me/alerts/:id`

Request body parsing and Gemini responses are validated. The API applies Helmet, CORS restricted to the configured client origin, request rate limits, and a 100 KB JSON limit. Photo uploads are content-sniffed and limited to 5 MB; medical-history uploads accept PDF/JPEG/PNG/WebP content up to 10 MB and are only served through authenticated routes.

## Safety and limitations

- Use fictional patients, names, images, and captions only. Gemini requests contain the doctor's prompt and photo captions with fictional photo IDs; patient names and database IDs are not sent. Wikimedia searches receive only generic visual search terms, not names or patient IDs.
- The history-upload feature is only for fictional or properly de-identified test records. Uploaded originals are stored on the server; when AI extraction is explicitly requested, the document contents are sent to Google Gemini. Do not upload identifiable health information. This prototype does not provide production privacy, security, retention, or compliance controls.
- History extraction is a source-grounded indexing aid, not an AI medical evaluation. It may omit or misread facts; check the original document. It does not diagnose, recommend care, assess whether treatment is appropriate, or establish improvement or decline. Trend charts plot extracted or clinician-entered values without clinical interpretation.
- The care blueprint contains goals and measurements entered by the doctor. The K-map only links source records, extracted facts, and goals by source or shared words; a shared-word link does not mean a clinical relationship.
- Only Wikimedia Commons results marked CC0, CC BY, CC BY-SA, or public domain are attached. Candidates are screened by comparing the search terms with Commons titles and descriptions; this does not inspect the picture itself, so the doctor must visually review each image and remove any mismatch before assignment. If no licensed metadata match is found, the scene has no external image.
- Never use this prototype to diagnose, treat, or make medication decisions. It does not claim to treat, cure, or slow dementia.
- Doctor review is required before a generated story reaches a patient. Session summaries are labelled for doctor review.
- AI output is not a safety net. Patient alerts appear on the doctor's dashboard and are not emergency notifications. This prototype does not contact a caregiver directly.
- Demo passwords and local JWT configuration are for local development only. The app is not hardened for public deployment.
- Gemini free-tier policies and rate limits can change. Review Google's current terms before using the service; real patient data is out of scope.
- External image search uses Wikimedia Commons and is best-effort: if the service is unavailable or no suitable licensed image is found, the story is still drafted without that external image. External images can later move or be removed; their source and license links are retained for review.
- No caregiver accounts, story translation, weekly reports, direct email/WhatsApp notifications, daily-life monitoring, or VR headset mode are implemented. The built-in 3D scenes are browser simulations and are not medical treatment.
- The prototype has not been clinically validated and makes no claim of therapeutic benefit.

## Validation commands

```bash
npm test
npm run build
```

## License

To be decided by the team before public release.
