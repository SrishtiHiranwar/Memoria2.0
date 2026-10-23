import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

const MemorySimulation = lazy(() => import('./components/MemorySimulation.js').then((module) => ({
  default: module.MemorySimulation,
})));

type Role = 'DOCTOR' | 'PATIENT';
type User = { id: string; email: string; role: Role; patientId: string | null };
type Photo = { id: string; imageUrl: string; caption: string; createdAt: string };
type ExternalImage = {
  url: string;
  sourcePageUrl: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
};
type Scene = {
  photoId: string | null;
  imageSearchQuery?: string;
  externalImage?: ExternalImage;
  narration: string;
  recallQuestion: string;
  expectedAnswer: string;
  answerOptions: string[];
};
type Story = {
  id: string;
  patientId: string;
  createdAt: string;
  title: string;
  prompt: string;
  status: 'DRAFT' | 'APPROVED' | 'ASSIGNED' | 'COMPLETED';
  experienceMode: 'STORY' | '3D';
  scenes: Scene[];
  approvedAt: string | null;
  assignedAt: string | null;
};
type Patient = {
  id: string;
  name: string;
  user: { email: string } | null;
  photos: Photo[];
  stories: Story[];
};
type HistoryObservation = {
  recordedAt: string | null;
  category: 'measurement' | 'symptom' | 'medication' | 'diagnosis' | 'procedure' | 'other';
  label: string;
  detail: string;
  numericValue: number | null;
  unit: string;
  sourceExcerpt: string;
};
type MedicalRecord = {
  id: string;
  fileName: string;
  mimeType: string;
  evaluatedAt: string | null;
  createdAt: string;
  contentUrl: string;
  analysis: { summary: string; observations: HistoryObservation[] } | null;
};
type CareGoal = {
  id: string;
  title: string;
  measure: string;
  unit: string;
  baselineValue: number | null;
  targetValue: number | null;
  reviewDate: string | null;
  notes: string | null;
  createdAt: string;
  measurements: Array<{ id: string; value: number; measuredAt: string; note: string | null }>;
};
type Alert = {
  id: string;
  patientId: string;
  createdAt: string;
  acknowledgedAt: string | null;
  patient: { id: string; name: string };
};
type SessionRow = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  patient: { id: string; name: string };
  story: { id: string; title: string };
};
type ApiOptions = Omit<RequestInit, 'body'> & { body?: BodyInit | null };

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'memoria-token';
const USER_KEY = 'memoria-user';
const VOICE_LANGUAGE_KEY = 'memoria-voice-language';
const FALLBACK_MESSAGE = 'Your caregiver has been told. Please wait here, or ask someone nearby.';
const voiceLanguages = [
  { locale: 'en-US', label: 'English' },
  { locale: 'hi-IN', label: 'हिन्दी' },
];
const patientCopy = {
  'en-US': {
    signOut: 'Sign out', today: 'TODAY, AT YOUR PACE', myStories: 'My stories', scene: 'Scene',
    selected: 'Selected',
    storyVoice: 'Page language', loadingTranslation: 'Preparing the Hindi page and story…',
    translationFailed: 'Hindi translation could not be loaded. Switch to English or try again.',
    retry: 'Try again', genericError: 'Something went wrong. Please try again.',
    photoUnavailable: 'Photo unavailable', imageLabel: 'Image:',
    imageReview: 'Your doctor is reviewing the image for this scene.', listen: 'Listen',
    continue: 'Continue', question: 'A little question', listenChoices: 'Listen to question and choices',
    saving: 'Saving…', finish: 'Finish story', nextScene: 'Next scene', shared: 'A moment well shared',
    thankYou: 'Thank you for sharing.', quietMoment: 'You can take a quiet moment before choosing another story.',
    seeStories: 'See my stories', welcome: 'A quiet moment, just for you', shareStory: 'Shall we share a story?',
    takeTime: 'Take your time. Your stories will be here whenever you are ready.',
    caregiverHere: 'My caregiver is here with me.', enjoyTogether: 'We can enjoy a story together.',
    picked: 'Picked for you', yourStories: 'Your stories', story: 'story', stories: 'stories',
    noStories: 'There are no stories ready yet.', doctorAddStory: 'Your doctor will add a story for you.',
    resume: 'Resume story', start: 'Start story', called: 'Caregiver called', callCaregiver: 'Call my caregiver',
    alertSent: 'An alert has been sent. Please wait here.', alertStatus: 'Your request was sent. Please wait here.',
    alertSeen: 'Your caregiver has seen your request.', fallback: FALLBACK_MESSAGE,
    restartNotice: 'This story is starting again from scene one. Answers from the interrupted session were not saved.',
    voiceUnavailable: 'Voice playback is not available in this browser. You can read the story text on screen.',
    voiceMissing: 'A Hindi voice is not available on this device. Install a Hindi speech voice in device settings, or choose English.',
    explore3d: 'Explore a 3D place', close3d: 'Close 3D place',
    simulationIntro: 'A calm scene to look around together, at your own pace.',
  },
  'hi-IN': {
    signOut: 'साइन आउट', today: 'आज, आपकी अपनी गति से', myStories: 'मेरी कहानियाँ', scene: 'दृश्य',
    selected: 'चुना गया',
    storyVoice: 'पेज की भाषा', loadingTranslation: 'हिंदी पेज और कहानी तैयार हो रही है…',
    translationFailed: 'हिंदी अनुवाद नहीं मिल पाया। अंग्रेज़ी चुनें या फिर कोशिश करें।',
    retry: 'फिर कोशिश करें', genericError: 'कुछ गड़बड़ हुई। कृपया फिर कोशिश करें।',
    photoUnavailable: 'तस्वीर उपलब्ध नहीं है', imageLabel: 'तस्वीर:',
    imageReview: 'इस दृश्य की तस्वीर आपके डॉक्टर देख रहे हैं।', listen: 'सुनें',
    continue: 'आगे बढ़ें', question: 'एक छोटा-सा सवाल', listenChoices: 'सवाल और जवाब के विकल्प सुनें',
    saving: 'सहेजा जा रहा है…', finish: 'कहानी पूरी करें', nextScene: 'अगला दृश्य', shared: 'साथ बिताया एक प्यारा पल',
    thankYou: 'कहानी साझा करने के लिए धन्यवाद।', quietMoment: 'दूसरी कहानी चुनने से पहले थोड़ा आराम कर सकते हैं।',
    seeStories: 'मेरी कहानियाँ देखें', welcome: 'आपके लिए एक शांत पल', shareStory: 'क्या हम एक कहानी सुनें?',
    takeTime: 'आराम से समय लें। आपकी कहानियाँ यहीं रहेंगी।',
    caregiverHere: 'मेरे देखभालकर्ता मेरे साथ हैं।', enjoyTogether: 'हम साथ में कहानी का आनंद ले सकते हैं।',
    picked: 'आपके लिए', yourStories: 'आपकी कहानियाँ', story: 'कहानी', stories: 'कहानियाँ',
    noStories: 'अभी कोई कहानी तैयार नहीं है।', doctorAddStory: 'आपके डॉक्टर आपके लिए कहानी जोड़ेंगे।',
    resume: 'कहानी फिर शुरू करें', start: 'कहानी शुरू करें', called: 'देखभालकर्ता को बुलाया',
    callCaregiver: 'मेरे देखभालकर्ता को बुलाएँ', alertSent: 'सूचना भेज दी गई है। कृपया यहीं प्रतीक्षा करें।',
    alertStatus: 'आपकी सूचना भेज दी गई है। कृपया यहीं प्रतीक्षा करें।',
    alertSeen: 'आपके देखभालकर्ता ने आपका संदेश देख लिया है।',
    fallback: 'आपके देखभालकर्ता को सूचना दे दी गई है। कृपया यहीं प्रतीक्षा करें या पास में किसी से मदद माँगें।',
    restartNotice: 'कहानी पहले दृश्य से फिर शुरू होगी। बीच में रुकी कहानी के जवाब सहेजे नहीं गए थे।',
    voiceUnavailable: 'इस ब्राउज़र में आवाज़ उपलब्ध नहीं है। आप स्क्रीन पर कहानी पढ़ सकते हैं।',
    voiceMissing: 'इस डिवाइस पर हिंदी आवाज़ उपलब्ध नहीं है। डिवाइस की सेटिंग में हिंदी आवाज़ जोड़ें या अंग्रेज़ी चुनें।',
    explore3d: '3D जगह देखें', close3d: '3D दृश्य बंद करें',
    simulationIntro: 'साथ में, अपनी गति से देखने के लिए एक शांत दृश्य।',
  },
} as const;

async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error('Cannot reach the Memoria server. Check that it is running and try again.');
  }
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? 'The request could not be completed.');
  return payload as T;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function PhotoImage({ photo, alt, className, unavailableText }: { photo: Photo; alt: string; className?: string; unavailableText?: string }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (photo.imageUrl.startsWith('/placeholders/')) {
      setSrc(photo.imageUrl);
      setFailed(false);
      return;
    }

    const controller = new AbortController();
    let objectUrl = '';
    setSrc('');
    setFailed(false);
    fetch(`${API_URL}${photo.imageUrl}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ''}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Photo unavailable');
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.id, photo.imageUrl]);

  if (failed) return <span className={`photo-unavailable ${className ?? ''}`}>{unavailableText ?? 'Photo unavailable'}</span>;
  return <img className={className} src={src} alt={alt} />;
}

function ExternalImagePreview({ image, patientView = false, locale = 'en-US' }: { image: ExternalImage; patientView?: boolean; locale?: string }) {
  return (
    <figure className={patientView ? 'external-image-preview patient-image-preview' : 'external-image-preview'}>
      <img src={image.url} alt="Illustration suggested for this story scene" referrerPolicy="no-referrer" />
      <figcaption>
        {patientView && locale === 'hi-IN' ? 'तस्वीर:' : 'Image:'} <a href={image.sourcePageUrl} target="_blank" rel="noreferrer">{image.attribution}</a>
        {' · '}
        <a href={image.licenseUrl} target="_blank" rel="noreferrer">{image.licenseName}</a>
      </figcaption>
    </figure>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(() => {
    const cached = localStorage.getItem(USER_KEY);
    return cached ? JSON.parse(cached) as User : null;
  });
  const [booting, setBooting] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    api<{ user: User }>('/auth/me')
      .then(({ user: current }) => {
        setUser(current);
        localStorage.setItem(USER_KEY, JSON.stringify(current));
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setUser(null);
      })
      .finally(() => setBooting(false));
  }, []);

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }

  if (booting) return <div className="loading-screen">Opening Memoria…</div>;
  if (!user) return <Login onSignedIn={(nextUser) => setUser(nextUser)} />;
  if (user.role === 'DOCTOR') return <DoctorDashboard user={user} onSignOut={signOut} />;
  return <PatientExperience onSignOut={signOut} />;
}

function Login({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState('doctor@demo.local');
  const [password, setPassword] = useState('demo-doctor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem(TOKEN_KEY, result.token);
      localStorage.setItem(USER_KEY, JSON.stringify(result.user));
      onSignedIn(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <BrandMark />
        <p className="eyebrow">A story, shared gently</p>
        <h1>Welcome to Memoria</h1>
        <p className="muted">Sign in as a doctor or on the patient’s device with the patient login.</p>
        <form onSubmit={submit} className="stack-form">
          <label>
            Email
            <input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <button className="button button-primary button-wide" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="demo-access">
          <span className="muted">Fictional demo accounts</span>
          <div>
            <button className="text-button" onClick={() => { setEmail('doctor@demo.local'); setPassword('demo-doctor'); }}>Doctor</button>
            <button className="text-button" onClick={() => { setEmail('patient@demo.local'); setPassword('demo-patient'); }}>Patient</button>
          </div>
        </div>
        <p className="safety-note">Prototype only · Use fictional data · Not medical advice or care</p>
      </section>
    </main>
  );
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none">
        <path d="M7 10.5c5.1-.9 9.3.3 13 3.6v18c-3.7-3.3-7.9-4.5-13-3.6v-18Z" />
        <path d="M33 10.5c-5.1-.9-9.3.3-13 3.6v18c3.7-3.3 7.9-4.5 13-3.6v-18Z" />
        <path d="M20 14v17.8" />
        <path d="M12 17.5c2.5.1 4.4.9 6 2.3M28 17.5c-2.5.1-4.4.9-6 2.3" />
      </svg>
    </div>
  );
}

function DoctorDashboard({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [section, setSection] = useState<'patients' | 'alerts' | 'sessions' | 'simulation'>('patients');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? patients[0];

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [patientData, alertData, sessionData] = await Promise.all([
        api<{ patients: Patient[] }>('/patients'),
        api<{ alerts: Alert[] }>('/alerts'),
        api<{ sessions: SessionRow[] }>('/sessions'),
      ]);
      setPatients(patientData.patients);
      setAlerts(alertData.alerts);
      setSessions(sessionData.sessions);
      setSelectedPatientId((current) => current || patientData.patients[0]?.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load your dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refresh]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  }

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><BrandMark /><span>Memoria</span></div>
        <p className="sidebar-caption">DOCTOR WORKSPACE</p>
        <nav className="sidebar-nav" aria-label="Doctor dashboard">
          <button className={section === 'patients' ? 'nav-item active' : 'nav-item'} onClick={() => setSection('patients')}>
            <span aria-hidden="true">◉</span> Patients <span className="nav-count">{patients.length}</span>
          </button>
          <button className={section === 'alerts' ? 'nav-item active' : 'nav-item'} onClick={() => setSection('alerts')}>
            <span aria-hidden="true">♢</span> Alerts <span className="nav-count">{alerts.filter((alert) => !alert.acknowledgedAt).length}</span>
          </button>
          <button className={section === 'sessions' ? 'nav-item active' : 'nav-item'} onClick={() => setSection('sessions')}>
            <span aria-hidden="true">◷</span> Sessions
          </button>
          <button className={section === 'simulation' ? 'nav-item active' : 'nav-item'} onClick={() => setSection('simulation')}>
            <span aria-hidden="true">✦</span> 3D places
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="signed-in"><span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span><span><b>Doctor</b><small>{user.email}</small></span></div>
          <button className="nav-item signout" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{section === 'patients' ? 'A little care goes a long way' : section === 'alerts' ? 'Here when someone needs you' : section === 'sessions' ? 'Moments shared together' : 'A small world to explore'}</p>
            <h1>{section === 'patients' ? 'Good to see you.' : section === 'alerts' ? 'Caregiver notes' : section === 'sessions' ? 'Story visits' : '3D scene studio'}</h1>
            <p className="topbar-intro">{section === 'patients'
              ? 'Build a gentle moment of connection, one familiar detail at a time.'
              : section === 'alerts'
                ? 'Every note is a request for a little human company.'
                : section === 'sessions'
                  ? 'See the stories and moments shared in each visit.'
                  : 'Explore a few familiar places together. These scenes are for calm exploration, not medical treatment.'}</p>
          </div>
          <div className="topbar-actions">
            <span className="prototype-badge">FICTIONAL DEMO</span>
            <button className="button button-quiet" onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
          </div>
        </header>
        {notice && <div className="toast" role="status">{notice}</div>}
        {error && <div className="banner-error" role="alert">{error}</div>}
        {loading ? <div className="loading-card">Loading your workspace…</div> : (
          <>
            {section === 'patients' && (
              <DoctorPatients
                patients={patients}
                selectedPatient={selectedPatient}
                onSelectPatient={setSelectedPatientId}
                onRefresh={() => setRefresh((value) => value + 1)}
                onNotice={flash}
              />
            )}
            {section === 'alerts' && <DoctorAlerts alerts={alerts} onRefresh={() => setRefresh((value) => value + 1)} onNotice={flash} />}
            {section === 'sessions' && <DoctorSessions sessions={sessions} />}
            {section === 'simulation' && <Suspense fallback={<div className="loading-card">Opening the 3D scene…</div>}><MemorySimulation /></Suspense>}
          </>
        )}
        <footer className="dashboard-footer">Memoria is a support prototype, not a medical device. All sample data is fictional.</footer>
      </main>
    </div>
  );
}

function DoctorPatients({
  patients,
  selectedPatient,
  onSelectPatient,
  onRefresh,
  onNotice,
}: {
  patients: Patient[];
  selectedPatient: Patient | undefined;
  onSelectPatient: (id: string) => void;
  onRefresh: () => void;
  onNotice: (message: string) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  return (
    <div className="patient-layout">
      <section className="patient-list-card">
        <div className="card-title-row"><div><p className="eyebrow">Your care team</p><h2>Patients <span className="subtle-count">{patients.length}</span></h2></div>
          <button className="icon-button" aria-label="Add patient" onClick={() => setShowCreate((show) => !show)}>＋</button></div>
        {showCreate && <CreatePatient onCreated={(id) => { setShowCreate(false); onSelectPatient(id); onRefresh(); onNotice('Patient login created. Share credentials securely.'); }} />}
        {patients.length === 0 ? <div className="empty-state"><span>◉</span><p>No patient profiles yet.</p><button className="button button-secondary" onClick={() => setShowCreate(true)}>Add your first patient</button></div> :
          <div className="patient-list">{patients.map((patient) => (
            <button key={patient.id} className={selectedPatient?.id === patient.id ? 'patient-list-item selected' : 'patient-list-item'} onClick={() => onSelectPatient(patient.id)}>
              <span className="patient-avatar">{patient.name.trim().slice(0, 1).toUpperCase()}</span>
              <span className="patient-list-copy"><b>{patient.name}</b><small>{patient.photos.length} photos · {patient.stories.length} stories</small></span>
              <span className="chevron">›</span>
            </button>
          ))}</div>
        }
      </section>
      {selectedPatient ? <PatientDetail patient={selectedPatient} patients={patients} onRefresh={onRefresh} onNotice={onNotice} /> :
        <div className="welcome-card"><div className="welcome-art">M</div><h2>Start with a patient</h2><p>Create a patient profile to add photos and draft a story.</p><button className="button button-primary" onClick={() => setShowCreate(true)}>＋ Add patient</button></div>}
    </div>
  );
}

function CreatePatient({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await api<{ patient: { id: string } }>('/patients', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      onCreated(response.patient.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the patient.');
    } finally { setBusy(false); }
  }

  return <form className="create-patient-form" onSubmit={submit}>
    <h3>New patient login</h3>
    <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label>
    <label>Login email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
    <label>Temporary password<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
    <p className="help-text">Share login credentials directly with the patient or caregiver.</p>
    {error && <p className="inline-error">{error}</p>}
    <button className="button button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create login'}</button>
  </form>;
}

function PatientDetail({
  patient,
  patients,
  onRefresh,
  onNotice,
}: {
  patient: Patient;
  patients: Patient[];
  onRefresh: () => void;
  onNotice: (message: string) => void;
}) {
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [storyError, setStoryError] = useState('');

  async function uploadPhoto(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setUploadError('');
    setUploading(true);
    const form = new FormData();
    form.set('photo', file);
    form.set('caption', caption);
    try {
      await api(`/patients/${patient.id}/photos`, { method: 'POST', body: form });
      setFile(null);
      setCaption('');
      (document.getElementById('photo-file') as HTMLInputElement | null)?.value && ((document.getElementById('photo-file') as HTMLInputElement).value = '');
      onRefresh();
      onNotice('Photo added to this patient’s approved collection.');
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : 'Could not upload this photo.');
    } finally { setUploading(false); }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    setStoryError('');
    setGenerating(true);
    try {
      await api(`/patients/${patient.id}/stories/generate`, { method: 'POST', body: JSON.stringify({ prompt }) });
      setPrompt('');
      onRefresh();
      onNotice('Draft created. Review each scene before approving.');
    } catch (reason) {
      setStoryError(reason instanceof Error ? reason.message : 'Could not draft a story.');
    } finally { setGenerating(false); }
  }

  return (
    <section className="patient-detail">
      <div className="patient-heading-card">
        <div className="patient-heading-avatar" aria-hidden="true">{patient.name.trim().slice(0, 1).toUpperCase()}</div>
        <div className="patient-heading-copy"><p className="eyebrow">A familiar face</p><h2>{patient.name}</h2><p>{patient.user?.email ?? 'Login not linked'}</p></div>
        <div className="patient-stats"><div><strong>{patient.photos.length}</strong><span>Photos</span></div><div><strong>{patient.stories.length}</strong><span>Stories</span></div></div>
      </div>

      <section className="content-card">
        <div className="section-heading"><div><p className="eyebrow">Little things worth remembering</p><h2>Photo collection</h2><p className="section-intro">Add familiar pictures and a few simple words about what is in them. They help shape a story that feels personal.</p></div><span className="count-pill">{patient.photos.length}</span></div>
        <form onSubmit={uploadPhoto} className="upload-form">
          <label className="upload-picker" htmlFor="photo-file"><span className="upload-symbol">＋</span><span><b>{file ? file.name : 'Choose a photo'}</b><small>JPEG, PNG, WebP, GIF · up to 5 MB</small></span><input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
          <label className="caption-input">Photo caption<input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Describe only what is visible…" required maxLength={500} /></label>
          {uploadError && <p className="inline-error full-width">{uploadError}</p>}
          <button className="button button-secondary" disabled={!file || uploading}>{uploading ? 'Uploading…' : 'Add photo'}</button>
        </form>
        {patient.photos.length === 0 ? <p className="muted empty-inline">Add a few photos before drafting a story.</p> :
          <div className="photo-grid">{patient.photos.map((photo) => <figure className="photo-tile" key={photo.id}><PhotoImage photo={photo} alt={photo.caption} /><figcaption>{photo.caption}</figcaption></figure>)}</div>}
      </section>

      <MedicalHistoryPanel patientId={patient.id} />

      <section className="content-card">
        <div className="section-heading"><div><p className="eyebrow">A new page each time</p><h2>Stories <span className="subtle-count">{patient.stories.length}</span></h2><p className="section-intro">Shape the story with your prompt. Read each scene, check every question, then approve it before it reaches your patient.</p></div></div>
        <form onSubmit={generate} className="story-prompt-form">
          <label htmlFor="story-prompt">Describe the story you want</label>
          <textarea id="story-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={'Example: Create 4 scenes about making a paper kite. Scene 1: fold yellow paper. Ask: “What shape is the paper?” Scene 2: tie on a blue ribbon. Ask: “What color is the ribbon?”'} minLength={5} maxLength={2000} required rows={4} />
          <p className="help-text">A topic alone (like “teacher”) is not enough. Add concrete scene details in order, say how many scenes you want, and put any must-use question in quotation marks. Memoria checks scene relevance and question specificity before saving the draft. Gemini gets only this prompt and photo captions. Image searches use generic visual terms only—never names or personal details.</p>
          {patient.photos.length === 0 && <p className="help-text">No patient photos are uploaded. Scenes can still be drafted with licensed image candidates.</p>}
          {storyError && <p className="inline-error">{storyError}</p>}
          <button className="button button-primary" disabled={generating}>{generating ? 'Drafting story…' : '✦ Draft story with AI'}</button>
        </form>
        {patient.stories.length === 0 ? <p className="muted empty-inline">No stories yet. Start with a short prompt above.</p> :
          <div className="story-list">{patient.stories.map((story) => <StoryEditor key={story.id} story={story} patient={patient} patients={patients} onRefresh={onRefresh} onNotice={onNotice} />)}</div>}
      </section>
    </section>
  );
}

function MedicalHistoryPanel({
  patientId,
  patientView = false,
  locale = 'en-US',
}: {
  patientId?: string;
  patientView?: boolean;
  locale?: string;
}) {
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [goals, setGoals] = useState<CareGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyRecord, setBusyRecord] = useState('');
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalMeasure, setGoalMeasure] = useState('');
  const [goalUnit, setGoalUnit] = useState('');
  const [goalBaseline, setGoalBaseline] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalReviewDate, setGoalReviewDate] = useState('');
  const [goalNotes, setGoalNotes] = useState('');
  const [measurementValues, setMeasurementValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const hindi = patientView && locale === 'hi-IN';
  const apiPath = patientView ? '/me/health-data' : `/patients/${patientId}/health-data`;
  const historyDate = useCallback((value: string) => new Intl.DateTimeFormat(hindi ? 'hi-IN' : 'en', { dateStyle: 'medium' }).format(new Date(value)), [hindi]);

  const loadHealthData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ records: MedicalRecord[]; careGoals: CareGoal[] }>(apiPath);
      setRecords(data.records);
      setGoals(data.careGoals);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load the health history.');
    } finally {
      setLoading(false);
    }
  }, [apiPath]);

  useEffect(() => { void loadHealthData(); }, [loadHealthData]);

  async function uploadHistory(event: FormEvent) {
    event.preventDefault();
    if (!file || !consent) return;
    setError('');
    setUploading(true);
    const form = new FormData();
    form.set('record', file);
    try {
      const path = patientView ? '/me/medical-records' : `/patients/${patientId}/medical-records`;
      await api(path, { method: 'POST', body: form });
      setFile(null);
      setConsent(false);
      const picker = document.getElementById(patientView ? 'patient-history-file' : `doctor-history-file-${patientId}`) as HTMLInputElement | null;
      if (picker) picker.value = '';
      await loadHealthData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not upload this record.');
    } finally {
      setUploading(false);
    }
  }

  async function evaluateRecord(id: string) {
    setBusyRecord(id);
    setError('');
    try {
      await api(`/medical-records/${id}/evaluate`, { method: 'POST', body: JSON.stringify({}) });
      await loadHealthData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not extract information from this record.');
    } finally {
      setBusyRecord('');
    }
  }

  async function downloadRecord(record: MedicalRecord) {
    setError('');
    try {
      const response = await fetch(`${API_URL}${record.contentUrl}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ''}` },
      });
      if (!response.ok) throw new Error('The original record could not be downloaded.');
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = record.fileName;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The original record could not be downloaded.');
    }
  }

  async function createGoal(event: FormEvent) {
    event.preventDefault();
    if (!patientId) return;
    setError('');
    try {
      await api(`/patients/${patientId}/care-goals`, {
        method: 'POST',
        body: JSON.stringify({
          title: goalTitle,
          measure: goalMeasure,
          unit: goalUnit,
          ...(goalBaseline ? { baselineValue: Number(goalBaseline) } : {}),
          ...(goalTarget ? { targetValue: Number(goalTarget) } : {}),
          ...(goalReviewDate ? { reviewDate: goalReviewDate } : {}),
          ...(goalNotes ? { notes: goalNotes } : {}),
        }),
      });
      setGoalTitle('');
      setGoalMeasure('');
      setGoalUnit('');
      setGoalBaseline('');
      setGoalTarget('');
      setGoalReviewDate('');
      setGoalNotes('');
      setShowGoalForm(false);
      await loadHealthData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this care goal.');
    }
  }

  async function addMeasurement(event: FormEvent, goal: CareGoal) {
    event.preventDefault();
    const value = measurementValues[goal.id];
    if (!value) return;
    setError('');
    try {
      await api(`/care-goals/${goal.id}/measurements`, {
        method: 'POST',
        body: JSON.stringify({ value: Number(value) }),
      });
      setMeasurementValues((current) => ({ ...current, [goal.id]: '' }));
      await loadHealthData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add this measurement.');
    }
  }

  const allObservations = records.flatMap((record) =>
    (record.analysis?.observations ?? []).map((observation) => ({ ...observation, recordId: record.id, fileName: record.fileName })));

  return (
    <section className="content-card health-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{hindi ? 'कहानियों से अलग' : 'Separate from stories'}</p>
          <h2>{hindi ? 'स्वास्थ्य इतिहास और देखभाल रूपरेखा' : 'Health history & care blueprint'}</h2>
          <p className="section-intro">{hindi
            ? 'पुराने रिकॉर्ड, स्रोत से जुड़ी जानकारी और डॉक्टर द्वारा तय किए गए लक्ष्य।'
            : 'Past records, source-linked extracted information, and clinician-authored goals.'}</p>
        </div>
        <span className="count-pill">{records.length} {hindi ? 'रिकॉर्ड' : records.length === 1 ? 'record' : 'records'}</span>
      </div>

      <div className="health-safety-note">
        <b>{hindi ? 'केवल काल्पनिक या पहचान हटाया हुआ डेटा' : 'Fictional or de-identified data only'}</b>
        <span>{hindi
          ? 'यह प्रोटोटाइप मूल फ़ाइल सर्वर पर रखता है। AI निष्कर्ष के समय दस्तावेज़ Google Gemini को भेजा जाता है। इसका उपयोग वास्तविक रोगी डेटा के साथ न करें।'
          : 'This prototype stores the original file on its server. If you request AI extraction, the document is sent to Google Gemini. Do not use real patient data.'}</span>
      </div>

      <form className="history-upload-form" onSubmit={(event) => void uploadHistory(event)}>
        <label className="upload-picker" htmlFor={patientView ? 'patient-history-file' : `doctor-history-file-${patientId}`}>
          <span className="upload-symbol">＋</span>
          <span><b>{file?.name ?? (hindi ? 'पुराना मेडिकल रिकॉर्ड चुनें' : 'Choose an old medical record')}</b><small>PDF, JPEG, PNG, WebP · up to 10 MB</small></span>
          <input
            id={patientView ? 'patient-history-file' : `doctor-history-file-${patientId}`}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label className="health-consent">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>{hindi
            ? 'मैं पुष्टि करता/करती हूँ कि यह काल्पनिक/पहचान-रहित डेटा है और AI निष्कर्ष के लिए Gemini को भेजा जा सकता है।'
            : 'I confirm this is fictional/de-identified data and may be sent to Gemini if I request AI extraction.'}</span>
        </label>
        <button className="button button-secondary" disabled={!file || !consent || uploading}>
          {uploading ? (hindi ? 'अपलोड हो रहा है…' : 'Uploading…') : (hindi ? 'इतिहास जोड़ें' : 'Add history')}
        </button>
      </form>

      <p className="health-disclaimer">
        {hindi
          ? 'AI केवल दस्तावेज़ में लिखी बातों को निकालने की कोशिश करता है; यह निदान या उपचार सलाह नहीं देता। उपयोग से पहले मूल रिकॉर्ड से जाँचें।'
          : 'AI only attempts to extract what the document says; it does not diagnose or recommend treatment. Verify every item against the original record.'}
      </p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {loading ? <p className="muted">Loading health history…</p> : records.length === 0
        ? <p className="muted empty-inline">{hindi ? 'अभी कोई मेडिकल रिकॉर्ड नहीं है।' : 'No medical records have been added yet.'}</p>
        : <div className="medical-record-list">
          {records.map((record) => (
            <article className="medical-record-card" key={record.id}>
              <div className="medical-record-header">
                <div><b>{record.fileName}</b><small>{record.mimeType} · {hindi ? 'जोड़ा गया' : 'Added'} {historyDate(record.createdAt)}</small></div>
                <div className="medical-record-actions">
                  <button type="button" className="text-button" onClick={() => void downloadRecord(record)}>{hindi ? 'मूल फ़ाइल' : 'Original file'}</button>
                  <button type="button" className="button button-secondary" disabled={busyRecord === record.id} onClick={() => void evaluateRecord(record.id)}>
                    {busyRecord === record.id ? (hindi ? 'जाँच हो रही है…' : 'Extracting…') : record.analysis ? (hindi ? 'फिर से निकालें' : 'Re-extract') : (hindi ? 'AI से जानकारी निकालें' : 'Extract with AI')}
                  </button>
                </div>
              </div>
              {record.analysis && <div className="record-analysis">
                <div className="ai-review-label">{hindi ? 'AI से निकाली जानकारी · मूल रिकॉर्ड से जाँचें' : 'AI-extracted · verify against source'} · {record.evaluatedAt ? historyDate(record.evaluatedAt) : ''}</div>
                <p>{record.analysis.summary}</p>
                {record.analysis.observations.length > 0
                  ? <ul className="observation-list">{record.analysis.observations.map((item, index) =>
                    <li key={`${item.label}-${index}`}>
                      <span className="observation-tag">{formatObservationCategory(item.category, hindi)}</span>
                      <b>{item.label}</b>
                      <span>{item.detail}{item.numericValue !== null ? ` · ${item.numericValue}${item.unit ? ` ${item.unit}` : ''}` : ''}</span>
                      {item.recordedAt && <small>{item.recordedAt}</small>}
                      {item.sourceExcerpt && <blockquote>“{item.sourceExcerpt}”</blockquote>}
                    </li>)}</ul>
                  : <p className="muted">No extractable observations were returned. Review the source document.</p>}
              </div>}
            </article>
          ))}
        </div>}

      {allObservations.length > 0 && <div className="health-analytics">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{hindi ? 'दस्तावेज़ों से निकला सार' : 'Source-derived overview'}</p><h3>{hindi ? 'इतिहास के पैटर्न' : 'History patterns'}</h3></div></div>
        <div className="health-chart-grid">
          <CategoryBarChart observations={allObservations} hindi={hindi} />
          <CategoryPieChart observations={allObservations} hindi={hindi} />
        </div>
        <div className="history-trend-grid">
          {buildObservationSeries(allObservations).map((series) => (
            <TrendChart key={series.label} title={series.label} unit={series.unit} points={series.points} hindi={hindi} />
          ))}
        </div>
        <p className="health-disclaimer">{hindi
          ? 'ये चार्ट केवल रिकॉर्ड से निकली तारीखों और मानों को दिखाते हैं। ये चिकित्सीय सुधार या गिरावट साबित नहीं करते।'
          : 'These charts count and plot only dates and values extracted from uploaded records. They do not establish clinical improvement or decline.'}</p>
      </div>}

      <div className="care-blueprint">
        <div className="section-heading compact-heading">
          <div><p className="eyebrow">{hindi ? 'डॉक्टर द्वारा तय' : 'Clinician-authored'}</p><h3>{hindi ? 'देखभाल के लक्ष्य' : 'Care goals'}</h3></div>
          {!patientView && <button className="button button-secondary" type="button" onClick={() => setShowGoalForm((value) => !value)}>{showGoalForm ? 'Close' : '＋ Add goal'}</button>}
        </div>
        {showGoalForm && <form className="goal-form" onSubmit={(event) => void createGoal(event)}>
          <label>Goal title<input value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} required maxLength={160} placeholder="A goal agreed by the clinician and patient" /></label>
          <label>Measure<input value={goalMeasure} onChange={(event) => setGoalMeasure(event.target.value)} required maxLength={100} placeholder="What will be measured?" /></label>
          <label>Unit<input value={goalUnit} onChange={(event) => setGoalUnit(event.target.value)} required maxLength={40} placeholder="e.g. visits per week" /></label>
          <label>Baseline<input type="number" step="any" value={goalBaseline} onChange={(event) => setGoalBaseline(event.target.value)} /></label>
          <label>Target<input type="number" step="any" value={goalTarget} onChange={(event) => setGoalTarget(event.target.value)} /></label>
          <label>Review date<input type="date" value={goalReviewDate} onChange={(event) => setGoalReviewDate(event.target.value)} /></label>
          <label className="goal-notes-field">Notes<textarea value={goalNotes} onChange={(event) => setGoalNotes(event.target.value)} maxLength={600} rows={2} /></label>
          <button className="button button-primary">Save clinician goal</button>
        </form>}
        {goals.length === 0 ? <p className="muted empty-inline">{patientView ? (hindi ? 'अभी देखभाल के लक्ष्य साझा नहीं किए गए हैं।' : 'No care goals have been shared yet.') : 'No clinician-authored goals yet.'}</p> :
          <div className="care-goal-list">{goals.map((goal) => {
            const lastMeasurement = goal.measurements.at(-1);
            return <article className="care-goal-card" key={goal.id}>
              <div className="care-goal-heading"><div><h4>{goal.title}</h4><p>{goal.measure} · {goal.unit}</p></div>              {goal.reviewDate && <span className="count-pill">{hindi ? 'समीक्षा' : 'Review'} {historyDate(goal.reviewDate)}</span>}</div>
              <div className="goal-metrics">
                {goal.baselineValue !== null && <span>Baseline <b>{goal.baselineValue} {goal.unit}</b></span>}
                {goal.targetValue !== null && <span>Target <b>{goal.targetValue} {goal.unit}</b></span>}
                {lastMeasurement && <span>{hindi ? 'नवीनतम' : 'Latest'} <b>{lastMeasurement.value} {goal.unit}</b> · {historyDate(lastMeasurement.measuredAt)}</span>}
              </div>
              {goal.notes && <p>{goal.notes}</p>}
              {goal.measurements.length > 0 && <TrendChart title={`${goal.measure} · ${goal.title}`} unit={goal.unit} points={goal.measurements.map((measurement) => ({ date: measurement.measuredAt, value: measurement.value }))} baseline={goal.baselineValue ?? undefined} target={goal.targetValue ?? undefined} hindi={hindi} />}
              {!patientView && <form className="measurement-form" onSubmit={(event) => void addMeasurement(event, goal)}>
                <label>Record a measurement<input type="number" step="any" value={measurementValues[goal.id] ?? ''} onChange={(event) => setMeasurementValues((current) => ({ ...current, [goal.id]: event.target.value }))} required /></label>
                <button className="button button-secondary">Add measurement</button>
              </form>}
            </article>;
          })}</div>}
      </div>

      <KnowledgeMap observations={allObservations} records={records} goals={goals} hindi={hindi} />
    </section>
  );
}

type ChartPoint = { date: string; value: number };

function TrendChart({ title, unit, points, baseline, target, hindi = false }: { title: string; unit: string; points: ChartPoint[]; baseline?: number; target?: number; hindi?: boolean }) {
  const sorted = [...points].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (sorted.length === 0) return null;
  const values = [...sorted.map((point) => point.value), ...(baseline === undefined ? [] : [baseline]), ...(target === undefined ? [] : [target])];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const chartPoints = sorted.map((point, index) => ({
    x: sorted.length === 1 ? 150 : 22 + (index / (sorted.length - 1)) * 256,
    y: 104 - ((point.value - min) / range) * 78,
    ...point,
  }));
  const lineY = (value: number) => 104 - ((value - min) / range) * 78;
  return <div className="trend-chart">
    <h4>{title}</h4>
    <svg viewBox="0 0 300 138" role="img" aria-label={`${title} trend chart`}>
      <line x1="22" y1="104" x2="278" y2="104" className="chart-axis" />
      {baseline !== undefined && <line x1="22" y1={lineY(baseline)} x2="278" y2={lineY(baseline)} className="chart-baseline" />}
      {target !== undefined && <line x1="22" y1={lineY(target)} x2="278" y2={lineY(target)} className="chart-target" />}
      {chartPoints.length > 1 && <polyline points={chartPoints.map((point) => `${point.x},${point.y}`).join(' ')} className="chart-line" />}
      {chartPoints.map((point, index) => <g key={`${point.date}-${index}`}><circle cx={point.x} cy={point.y} r="4" className="chart-point"><title>{point.value} {unit} · {new Date(point.date).toLocaleDateString()}</title></circle></g>)}
      <text x="22" y="126" className="chart-label">{new Date(sorted[0].date).toLocaleDateString(hindi ? 'hi-IN' : 'en')}</text>
      <text x="278" y="126" textAnchor="end" className="chart-label">{new Date(sorted.at(-1)!.date).toLocaleDateString(hindi ? 'hi-IN' : 'en')}</text>
    </svg>
    <p className="chart-latest">{chartPoints.at(-1)?.value} {unit} · {chartPoints.length} {hindi ? 'दर्ज मान' : chartPoints.length === 1 ? 'recorded value' : 'recorded values'}</p>
    <ul className="trend-values">{sorted.map((point, index) => <li key={`${point.date}-${index}`}>{new Date(point.date).toLocaleDateString(hindi ? 'hi-IN' : 'en')}: <b>{point.value} {unit}</b></li>)}</ul>
  </div>;
}

const categoryColors = ['#55836e', '#d58c62', '#7c83ab', '#d7ae52', '#78a5a4', '#a57975'];
const hindiCategories: Record<HistoryObservation['category'], string> = {
  measurement: 'माप',
  symptom: 'लक्षण',
  medication: 'दवा',
  diagnosis: 'निदान',
  procedure: 'प्रक्रिया',
  other: 'अन्य',
};

function formatObservationCategory(category: HistoryObservation['category'], hindi: boolean) {
  return hindi ? hindiCategories[category] : category;
}

function CategoryBarChart({ observations, hindi = false }: { observations: HistoryObservation[]; hindi?: boolean }) {
  const categories: HistoryObservation['category'][] = ['measurement', 'symptom', 'medication', 'diagnosis', 'procedure', 'other'];
  const counts = categories.map((category) => ({ category, count: observations.filter((item) => item.category === category).length }));
  const max = Math.max(1, ...counts.map((item) => item.count));
  return <div className="category-chart"><h4>{hindi ? 'प्रकार के अनुसार दर्ज जानकारी' : 'Extracted entries by type'}</h4>{counts.filter((item) => item.count > 0).map((item) => {
    const color = categoryColors[categories.indexOf(item.category)];
    return <div className="bar-row" key={item.category}><span>{formatObservationCategory(item.category, hindi)}</span><span className="bar-track"><span style={{ width: `${(item.count / max) * 100}%`, backgroundColor: color }} /></span><b>{item.count}</b></div>;
  })}</div>;
}

function CategoryPieChart({ observations, hindi = false }: { observations: HistoryObservation[]; hindi?: boolean }) {
  const categories: HistoryObservation['category'][] = ['measurement', 'symptom', 'medication', 'diagnosis', 'procedure', 'other'];
  const counts = categories.map((category, index) => ({
    category,
    color: categoryColors[index],
    count: observations.filter((item) => item.category === category).length,
  })).filter((item) => item.count > 0);
  const total = observations.length;
  let offset = 0;
  return <div className="pie-chart-card"><h4>{hindi ? 'दर्ज जानकारी का अनुपात' : 'Share of extracted entries'}</h4><div className="pie-chart-layout">
    <svg viewBox="0 0 42 42" role="img" aria-label="Pie chart showing extracted entries by type">
      <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="#ecebe4" strokeWidth="8" />
      {counts.map((item) => {
        const portion = (item.count / total) * 100;
        const currentOffset = offset;
        offset += portion;
        return <circle key={item.category} cx="21" cy="21" r="15.9" fill="transparent" stroke={item.color} strokeWidth="8" strokeDasharray={`${portion} ${100 - portion}`} strokeDashoffset={-currentOffset} transform="rotate(-90 21 21)" />;
      })}
      <text x="21" y="22.5" textAnchor="middle" className="pie-total">{total}</text>
    </svg>
    <ul>{counts.map((item) => <li key={item.category}><span style={{ backgroundColor: item.color }} />{formatObservationCategory(item.category, hindi)} <b>{item.count}</b></li>)}</ul>
  </div></div>;
}

function buildObservationSeries(observations: Array<HistoryObservation & { recordId: string; fileName: string }>) {
  const series = new Map<string, ChartPoint[]>();
  observations.forEach((item) => {
    if (item.category !== 'measurement' || item.numericValue === null || !item.recordedAt) return;
    const key = `${item.label} (${item.unit || 'value'})`;
    series.set(key, [...(series.get(key) ?? []), { date: item.recordedAt, value: item.numericValue }]);
  });
  return [...series.entries()]
    .filter(([, points]) => points.length > 1)
    .slice(0, 4)
    .map(([label, points]) => ({ label, unit: '', points }));
}

function KnowledgeMap({ observations, records, goals, hindi = false }: { observations: Array<HistoryObservation & { recordId: string; fileName: string }>; records: MedicalRecord[]; goals: CareGoal[]; hindi?: boolean }) {
  const visibleObservations = observations.slice(0, 7);
  const visibleGoals = goals.slice(0, 4);
  const height = Math.max(190, 58 + Math.max(records.length, visibleObservations.length, visibleGoals.length) * 54);
  const sourceY = (recordId: string) => {
    const index = Math.max(0, records.findIndex((record) => record.id === recordId));
    return 35 + Math.min(index, Math.max(0, records.length - 1)) * 54;
  };
  const evidenceY = (index: number) => 35 + index * 54;
  const goalY = (index: number) => 35 + index * 54;
  const normalized = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  const overlaps = (observation: HistoryObservation, goal: CareGoal) => {
    const observationWords = normalized(`${observation.label} ${observation.detail}`);
    const goalWords = normalized(`${goal.title} ${goal.measure}`);
    return [...observationWords].some((word) => goalWords.has(word));
  };
  return <div className="knowledge-map">
    <div className="section-heading compact-heading"><div><p className="eyebrow">K-map · {hindi ? 'ज्ञान मानचित्र' : 'knowledge map'}</p><h3>{hindi ? 'स्रोत, निकाली जानकारी और डॉक्टर के लक्ष्य' : 'Sources, extracted facts & clinician goals'}</h3></div></div>
    <p className="health-disclaimer">{hindi
      ? 'तथ्यों और लक्ष्यों के बीच की रेखाएँ केवल साझा शब्द दिखाती हैं; वे चिकित्सीय संबंध या कारण नहीं बतातीं। हर तथ्य को मूल दस्तावेज़ से जाँचें।'
      : 'Lines from facts to goals indicate shared words only; they do not imply medical relevance or causation. Select a source document to verify each fact.'}</p>
    {visibleObservations.length === 0 && visibleGoals.length === 0
      ? <p className="muted empty-inline">{hindi ? 'मानचित्र बनाने के लिए रिकॉर्ड जोड़कर जानकारी निकालें या डॉक्टर का लक्ष्य जोड़ें।' : 'Upload and extract a record, or add a clinician goal, to build this map.'}</p>
      : <div className="knowledge-map-scroll"><svg viewBox={`0 0 920 ${height}`} role="img" aria-label="Knowledge map linking uploaded source documents, extracted facts, and clinician-authored goals">
        <text x="16" y="18" className="map-column-label">{hindi ? 'मूल रिकॉर्ड' : 'SOURCE RECORDS'}</text>
        <text x="320" y="18" className="map-column-label">{hindi ? 'निकाली जानकारी' : 'EXTRACTED FACTS'}</text>
        <text x="638" y="18" className="map-column-label">{hindi ? 'देखभाल लक्ष्य' : 'CARE GOALS'}</text>
        {visibleObservations.map((observation, index) => {
          const recordIndex = records.findIndex((record) => record.id === observation.recordId);
          const leftY = sourceY(observation.recordId);
          const centerY = evidenceY(index);
          return <g key={`${observation.recordId}-${observation.label}-${index}`}>
            <line x1="240" y1={leftY} x2="316" y2={centerY} className="map-edge" />
            {visibleGoals.map((goal, goalIndex) => overlaps(observation, goal)
              ? <line key={`${goal.id}-${index}`} x1="605" y1={centerY} x2="638" y2={goalY(goalIndex)} className="map-edge map-edge-shared" />
              : null)}
            <rect x="8" y={leftY - 18} width="232" height="36" rx="10" className="map-source" />
            <text x="20" y={leftY + 4} className="map-node-text">{records[recordIndex]?.fileName.slice(0, 30) ?? 'Source record'}</text>
            <rect x="316" y={centerY - 18} width="289" height="36" rx="10" className="map-fact" />
            <text x="328" y={centerY + 4} className="map-node-text">{`${observation.label}: ${observation.detail}`.slice(0, 39)}</text>
          </g>;
        })}
        {visibleGoals.map((goal, index) => <g key={goal.id}>
          <rect x="638" y={goalY(index) - 18} width="270" height="36" rx="10" className="map-goal" />
          <text x="650" y={goalY(index) + 4} className="map-node-text">{`${goal.title} · ${goal.measure}`.slice(0, 37)}</text>
        </g>)}
      </svg></div>}
  </div>;
}

function StoryEditor({
  story,
  patient,
  patients,
  onRefresh,
  onNotice,
}: {
  story: Story;
  patient: Patient;
  patients: Patient[];
  onRefresh: () => void;
  onNotice: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(story.status === 'DRAFT');
  const [title, setTitle] = useState(story.title);
  const [prompt, setPrompt] = useState(story.prompt);
  const [scenes, setScenes] = useState<Scene[]>(story.scenes);
  const [experienceMode, setExperienceMode] = useState<Story['experienceMode']>(story.experienceMode ?? 'STORY');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(story.patientId);

  useEffect(() => {
    setTitle(story.title);
    setPrompt(story.prompt);
    setScenes(story.scenes);
    setExperienceMode(story.experienceMode ?? 'STORY');
    setSelectedPatient(story.patientId);
  }, [story]);

  function updateScene(index: number, field: keyof Scene, value: string) {
    setScenes((current) => current.map((scene, sceneIndex) => {
      if (sceneIndex !== index) return scene;
      if (field === 'answerOptions') return { ...scene, answerOptions: value.split('\n').map((option) => option.trim()).filter(Boolean) };
      return { ...scene, [field]: value };
    }));
  }

  function removeSuggestedImage(index: number) {
    setScenes((current) => current.map((scene, sceneIndex) => {
      if (sceneIndex !== index) return scene;
      const remainingScene = { ...scene };
      delete remainingScene.externalImage;
      return remainingScene;
    }));
  }

  async function action(path: string, bodyValue?: unknown, success?: string) {
    setBusy(true);
    setError('');
    try {
      await api(path, { method: 'POST', ...(bodyValue ? { body: JSON.stringify(bodyValue) } : {}) });
      onNotice(success ?? 'Story updated.');
      onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The story could not be updated.');
    } finally { setBusy(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/stories/${story.id}`, { method: 'PATCH', body: JSON.stringify({ title, prompt, scenes, experienceMode }) });
      onNotice('Draft changes saved.');
      onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The story could not be saved.');
    } finally { setBusy(false); }
  }

  const editable = story.status === 'DRAFT';

  return (
    <article className="story-card">
      <button className="story-summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span className="story-summary-icon">▤</span>
        <span className="story-summary-copy"><b>{story.title}</b><small>{story.scenes.length} scenes · Created {formatDate(story.createdAt)}</small>{story.experienceMode === '3D' && <span className="draft-review-label">3D companion story</span>}{story.status === 'DRAFT' && <span className="draft-review-label">AI-generated · for doctor review</span>}</span>
        <span className={`status-badge status-${story.status.toLowerCase()}`}>{story.status}</span>
        <span className="chevron">{expanded ? '⌄' : '›'}</span>
      </button>
      {expanded && <div className="story-editor">
        {story.status === 'DRAFT' && <div className="ai-review-label">✦ AI-generated, for doctor review</div>}
        {editable ? <form onSubmit={save} className="editor-form">
          <label>Story title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required /></label>
          <label>Original prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={2} maxLength={2000} required /></label>
          <label className="story-experience-toggle">
            <input type="checkbox" checked={experienceMode === '3D'} onChange={(event) => setExperienceMode(event.target.checked ? '3D' : 'STORY')} />
            <span><b>Add Mira’s 3D garden to this story</b><small>The patient will hear the scene, meet Mira in the garden, and answer your question with her.</small></span>
          </label>
          {scenes.map((scene, index) => {
            const photo = patient.photos.find((item) => item.id === scene.photoId);
            return <div className="scene-editor" key={`${scene.photoId}-${index}`}>
              <div className="scene-editor-heading"><span>SCENE {index + 1}</span>{photo ? <span>Patient photo</span> : scene.externalImage ? <span>Suggested web image</span> : <span>No image suggestion</span>}</div>
              {photo && <PhotoImage photo={photo} alt={photo.caption} className="scene-patient-photo" />}
              {!photo && !scene.externalImage && <div className="image-search-help">
                <a href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(scene.imageSearchQuery || scene.narration)}`} target="_blank" rel="noreferrer">Search Google Images for this scene ↗</a>
                <span>Results open separately and are not added automatically. Upload only an image you have permission to use.</span>
              </div>}
              {scene.externalImage && <div className="suggested-image-review">
                <div className="suggested-image-heading"><b>Suggested web image</b><span>Check the actual picture, not just its title. Remove it if it does not fit.</span><button type="button" className="button button-quiet" disabled={busy} onClick={() => removeSuggestedImage(index)}>Remove image</button></div>
                <ExternalImagePreview image={scene.externalImage} />
              </div>}
              <label>Narration<textarea value={scene.narration} onChange={(event) => updateScene(index, 'narration', event.target.value)} rows={2} maxLength={600} required /></label>
              <label>Recall question<input value={scene.recallQuestion} onChange={(event) => updateScene(index, 'recallQuestion', event.target.value)} maxLength={240} required /></label>
              <label>Expected answer<input value={scene.expectedAnswer} onChange={(event) => updateScene(index, 'expectedAnswer', event.target.value)} maxLength={200} required /></label>
              <label>Answer options <small>One option per line; include the expected answer.</small><textarea value={scene.answerOptions.join('\n')} onChange={(event) => updateScene(index, 'answerOptions', event.target.value)} rows={3} required /></label>
            </div>;
          })}
          {error && <p className="inline-error">{error}</p>}
          <div className="editor-actions"><button className="button button-secondary" disabled={busy}>Save changes</button><button type="button" className="button button-primary" disabled={busy || experienceMode !== (story.experienceMode ?? 'STORY')} onClick={() => void action(`/stories/${story.id}/approve`, {}, 'Story approved. It can now be assigned.')}>Approve story</button>{experienceMode !== (story.experienceMode ?? 'STORY') && <small className="approval-save-hint">Save changes to keep the selected story experience.</small>}</div>
        </form> : <div className="scene-readonly-list">{story.scenes.map((scene, index) => {
          const photo = patient.photos.find((item) => item.id === scene.photoId);
          return <div className="scene-readonly" key={`${scene.photoId}-${index}`}><b>Scene {index + 1}</b>{photo ? <PhotoImage photo={photo} alt={photo.caption} /> : scene.externalImage && <ExternalImagePreview image={scene.externalImage} />}<p>{scene.narration}</p><small>{scene.recallQuestion}</small></div>;
        })}
          {error && <p className="inline-error">{error}</p>}
          {(story.status === 'APPROVED' || story.status === 'ASSIGNED') && <div className="editor-actions">
            <label className="assign-select">Assign to <select value={selectedPatient} disabled={story.status !== 'APPROVED' || busy} onChange={(event) => setSelectedPatient(event.target.value)}>{patients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <button className="button button-primary" disabled={story.status !== 'APPROVED' || busy} onClick={() => void action(`/stories/${story.id}/assign`, { patientId: selectedPatient }, 'Story assigned to the patient login.')}>Assign story</button>
            <button className="button button-quiet" disabled={busy} onClick={() => void action(`/stories/${story.id}/reset`, {}, 'Story returned to draft so it can be edited.')}>Reset to draft</button>
          </div>}
        </div>}
      </div>}
    </article>
  );
}

function DoctorAlerts({ alerts, onRefresh, onNotice }: { alerts: Alert[]; onRefresh: () => void; onNotice: (message: string) => void }) {
  const [error, setError] = useState('');
  async function acknowledge(id: string) {
    setError('');
    try {
      await api(`/alerts/${id}/acknowledge`, { method: 'POST', body: JSON.stringify({}) });
      onRefresh();
      onNotice('Alert acknowledged.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not acknowledge this alert.'); }
  }
  return <section className="content-card full-card">
    <div className="section-heading"><div><p className="eyebrow">Human follow-up</p><h2>Alerts from patients</h2></div><span className="count-pill">{alerts.filter((alert) => !alert.acknowledgedAt).length} open</span></div>
    {error && <p className="inline-error">{error}</p>}
    {alerts.length === 0 ? <div className="empty-state"><span>♢</span><p>No caregiver alerts. Patient requests for help appear here.</p></div> :
      <div className="alert-list">{alerts.map((alert) => <article className="alert-row" key={alert.id}>
        <span className={alert.acknowledgedAt ? 'alert-dot done' : 'alert-dot'} />
        <div className="alert-copy"><b>{alert.patient.name} asked for their caregiver</b><small>{formatDate(alert.createdAt)}{alert.acknowledgedAt ? ` · Acknowledged ${formatDate(alert.acknowledgedAt)}` : ' · Waiting for acknowledgement'}</small></div>
        {!alert.acknowledgedAt && <button className="button button-secondary" onClick={() => void acknowledge(alert.id)}>Acknowledge</button>}
      </article>)}</div>}
  </section>;
}

function DoctorSessions({ sessions }: { sessions: SessionRow[] }) {
  const [selectedSession, setSelectedSession] = useState('');
  const [summary, setSummary] = useState<{ label: string; summary: { summary: string; concerns: string[]; doctorReviewNote: string } } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function openSummary(id: string) {
    setSelectedSession(id);
    setSummary(null);
    setError('');
    setBusy(true);
    try {
      const result = await api<{ ai_generated: boolean; label: string; summary: { summary: string; concerns: string[]; doctorReviewNote: string } }>(`/sessions/${id}/summary`);
      setSummary(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load this summary.'); }
    finally { setBusy(false); }
  }
  return <div className="sessions-layout">
    <section className="content-card session-card">
      <div className="section-heading"><div><p className="eyebrow">Patient activity</p><h2>Sessions</h2></div><span className="count-pill">{sessions.length}</span></div>
      {sessions.length === 0 ? <div className="empty-state"><span>◷</span><p>Completed story sessions will appear here.</p></div> :
        <div className="session-list">{sessions.map((session) => <button className={selectedSession === session.id ? 'session-row selected' : 'session-row'} key={session.id} onClick={() => void openSummary(session.id)}>
          <span className="session-row-icon">◷</span><span><b>{session.patient.name}</b><small>{session.story.title} · {formatDate(session.startedAt)}</small></span><span className="chevron">›</span>
        </button>)}</div>}
    </section>
    <section className="content-card summary-card">
      <p className="eyebrow">Session summary</p>
      {!selectedSession ? <div className="summary-empty"><span>✦</span><p>Select a session to see its summary.</p></div> :
        busy ? <p className="muted">Loading session summary…</p> :
          error ? <p className="inline-error">{error}</p> :
            summary ? <><div className="ai-review-label">✦ {summary.label}</div><p className="summary-text">{summary.summary.summary}</p>
              {summary.summary.concerns.length > 0 && <div className="concerns"><b>For doctor review</b><ul>{summary.summary.concerns.map((concern) => <li key={concern}>{concern}</li>)}</ul></div>}
              <p className="help-text">{summary.summary.doctorReviewNote}</p></> : null}
    </section>
  </div>;
}

type ActiveGame = { story: Story; sessionId: string };
type ActivePatientSession = { id: string; storyId: string; startedAt: string; story: Story };
type LocalizedStory = Pick<Story, 'id' | 'title'> & {
  scenes: Array<Pick<Scene, 'narration' | 'recallQuestion' | 'expectedAnswer' | 'answerOptions'>>;
};

function PatientExperience({ onSignOut }: { onSignOut: () => void }) {
  const [stories, setStories] = useState<Story[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActivePatientSession[]>([]);
  const [checkedCaregiver, setCheckedCaregiver] = useState(false);
  const [activeGame, setActiveGame] = useState<ActiveGame | null>(null);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [questionVisible, setQuestionVisible] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeAlertId, setActiveAlertId] = useState('');
  const [alertAcknowledged, setAlertAcknowledged] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [finished, setFinished] = useState(false);
  const [voiceLocale, setVoiceLocale] = useState(() => {
    const savedLocale = localStorage.getItem(VOICE_LANGUAGE_KEY);
    return voiceLanguages.find((language) => language.locale === savedLocale)?.locale ?? 'en-US';
  });
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [translatedStories, setTranslatedStories] = useState<Record<string, LocalizedStory>>({});
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationError, setTranslationError] = useState(false);
  const [translationAttempt, setTranslationAttempt] = useState(0);
  const [showSimulation, setShowSimulation] = useState(false);
  const text = patientCopy[voiceLocale as keyof typeof patientCopy] ?? patientCopy['en-US'];

  const loadAssigned = useCallback(async () => {
    try {
      const [storyData, photoData, sessionData] = await Promise.all([
        api<{ stories: Story[] }>('/me/stories'),
        api<{ photos: Photo[] }>('/me/photos'),
        api<{ sessions: ActivePatientSession[] }>('/me/sessions/active'),
      ]);
      setStories(storyData.stories);
      setPhotos(photoData.photos);
      setActiveSessions(sessionData.sessions);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load your stories.');
    }
  }, []);

  useEffect(() => { void loadAssigned(); }, [loadAssigned]);

  useEffect(() => {
    if (voiceLocale === 'en-US') {
      setTranslatedStories({});
      setTranslationBusy(false);
      setTranslationError(false);
      return;
    }
    if (stories.length === 0) {
      setTranslatedStories({});
      setTranslationBusy(false);
      return;
    }
    let mounted = true;
    setTranslationBusy(true);
    setTranslationError(false);
    api<{ stories: LocalizedStory[] }>('/me/stories/translate', {
      method: 'POST',
      body: JSON.stringify({ storyIds: stories.map((story) => story.id), locale: voiceLocale }),
    })
      .then((result) => {
        if (!mounted) return;
        setTranslatedStories(Object.fromEntries(result.stories.map((story) => [story.id, story])));
      })
      .catch(() => {
        if (mounted) {
          setTranslationError(true);
          setTranslatedStories({});
        }
      })
      .finally(() => {
        if (mounted) setTranslationBusy(false);
      });
    return () => { mounted = false; };
  }, [stories, voiceLocale, translationAttempt]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const updateVoices = () => setAvailableVoices(window.speechSynthesis.getVoices());
    updateVoices();
    window.speechSynthesis.addEventListener('voiceschanged', updateVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', updateVoices);
  }, []);

  useEffect(() => {
    if (!activeAlertId) return;
    let mounted = true;
    const check = async () => {
      try {
        const result = await api<{ alert: Alert; showFallback: boolean }>(`/me/alerts/${activeAlertId}`);
        if (mounted) {
          setAlertAcknowledged(Boolean(result.alert.acknowledgedAt));
          setShowFallback(result.showFallback);
        }
      } catch {
        if (mounted) setNotice('The alert status could not be checked. Please wait here.');
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), 5000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, [activeAlertId]);

  const sourceActiveScene = activeGame?.story.scenes[sceneIndex];
  const localizedActiveStory = activeGame ? translatedStories[activeGame.story.id] : undefined;
  const activeScene = sourceActiveScene && (voiceLocale === 'en-US'
    ? sourceActiveScene
    : localizedActiveStory?.scenes[sceneIndex]);
  const activePhoto = useMemo(() => photos.find((photo) => photo.id === sourceActiveScene?.photoId), [photos, sourceActiveScene]);

  function speakNarration(narrationText: string) {
    if (!('speechSynthesis' in window)) {
      setNotice(text.voiceUnavailable);
      return;
    }
    const matchingVoice = availableVoices.find((voice) =>
      voice.lang.toLowerCase().replace('_', '-').toLowerCase() === voiceLocale.toLowerCase())
      ?? availableVoices.find((voice) =>
        voice.lang.toLowerCase().replace('_', '-').split('-')[0] === voiceLocale.split('-')[0]);
    if (!matchingVoice) {
      setNotice(text.voiceMissing);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(narrationText);
    utterance.lang = matchingVoice.lang;
    utterance.voice = matchingVoice;
    utterance.rate = 0.86;
    window.speechSynthesis.speak(utterance);
  }

  async function startStory(story: Story) {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ session: { id: string } }>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ storyId: story.id, caregiverPresent: checkedCaregiver }),
      });
      setActiveGame({ story, sessionId: result.session.id });
      setSceneIndex(0);
      setQuestionVisible(false);
      setAnswers({});
      setSelectedAnswer('');
      setFinished(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start the story.');
    } finally { setBusy(false); }
  }

  function resumeStory(session: ActivePatientSession) {
    setError('');
    setNotice(text.restartNotice);
    setActiveGame({ story: session.story, sessionId: session.id });
    setSceneIndex(0);
    setQuestionVisible(false);
    setAnswers({});
    setSelectedAnswer('');
    setFinished(false);
  }

  function answerQuestion(optionIndex: number) {
    const sourceAnswer = activeGame?.story.scenes[sceneIndex].answerOptions[optionIndex];
    if (typeof sourceAnswer !== 'string') return;
    setSelectedAnswer(sourceAnswer);
    setAnswers((current) => ({ ...current, [sceneIndex]: sourceAnswer }));
  }

  function changeLanguage(locale: string) {
    if (!voiceLanguages.some((language) => language.locale === locale)) return;
    window.speechSynthesis?.cancel();
    setVoiceLocale(locale);
    localStorage.setItem(VOICE_LANGUAGE_KEY, locale);
    setNotice('');
    setError('');
  }

  async function continueStory() {
    if (!activeGame) return;
    if (!questionVisible) {
      setQuestionVisible(true);
      return;
    }
    if (!selectedAnswer) return;
    if (sceneIndex < activeGame.story.scenes.length - 1) {
      setSceneIndex((value) => value + 1);
      setQuestionVisible(false);
      setSelectedAnswer('');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/sessions/${activeGame.sessionId}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          answers: Object.entries({ ...answers, [sceneIndex]: selectedAnswer }).map(([index, selected]) => ({
            sceneIndex: Number(index),
            selectedAnswer: selected,
          })),
        }),
      });
      setActiveGame(null);
      setFinished(true);
      setCheckedCaregiver(false);
      void loadAssigned();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this session.');
    } finally { setBusy(false); }
  }

  async function callCaregiver() {
    setError('');
    try {
      const result = await api<{ alert: Alert }>('/alerts', { method: 'POST', body: JSON.stringify({}) });
      setActiveAlertId(result.alert.id);
      setAlertAcknowledged(false);
      setShowFallback(false);
      setNotice(text.alertSent);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The caregiver alert could not be sent.');
    }
  }

  function leaveStory() {
    window.speechSynthesis?.cancel();
    setActiveGame(null);
    setError('');
  }

  return (
    <main className="patient-mode" lang={voiceLocale}>
      <header className="patient-header">
        <div className="sidebar-brand"><BrandMark /><span>Memoria</span></div>
        <div className="patient-header-actions">
          <label className="language-picker"><span className="sr-only">{text.storyVoice}</span><select aria-label={text.storyVoice} value={voiceLocale} onChange={(event) => changeLanguage(event.target.value)}>
            {voiceLanguages.map((language) => <option key={language.locale} value={language.locale}>{language.label}</option>)}
          </select></label>
          <button className="patient-signout" onClick={onSignOut}>{text.signOut}</button>
        </div>
      </header>
      <section className="patient-content">
        <p className="patient-eyebrow">{text.today}</p>
        {activeGame ? activeScene ? (
          <div className="game-card">
            <div className="game-topline"><button className="patient-back" onClick={leaveStory}><span aria-hidden="true">←</span> {text.myStories}</button><span className="scene-counter">{text.scene} <b>{sceneIndex + 1}</b> / {activeGame.story.scenes.length}</span></div>
            <div className="story-progress" aria-label={`${text.scene} ${sceneIndex + 1} / ${activeGame.story.scenes.length}`}>
              {activeGame.story.scenes.map((_scene, index) => <span key={index} className={index <= sceneIndex ? 'complete' : ''} />)}
            </div>
            {activePhoto ? <PhotoImage photo={activePhoto} className="game-photo" alt={activePhoto.caption} /> : activeGame.story.scenes[sceneIndex].externalImage ? <ExternalImagePreview image={activeGame.story.scenes[sceneIndex].externalImage!} patientView /> : <div className="game-image-missing">{text.imageReview}</div>}
            <h1 className="game-title">{localizedActiveStory?.title ?? activeGame.story.title}</h1>
            {!questionVisible ? <div className="narration-panel"><p>{activeScene.narration}</p><div className="story-controls"><button className="button patient-play" onClick={() => speakNarration(activeScene.narration)}><span aria-hidden="true">♫</span> {text.listen}</button><button className="button button-primary patient-next" onClick={() => setQuestionVisible(true)}>{text.continue} <span aria-hidden="true">→</span></button></div></div> :
              activeGame.story.experienceMode === '3D' ? <Suspense fallback={<div className="loading-card">Opening Mira’s garden…</div>}>
                <MemorySimulation
                  patientView
                  hindi={voiceLocale === 'hi-IN'}
                  guidedStory={{
                    question: activeScene.recallQuestion,
                    answerOptions: activeScene.answerOptions,
                    selectedIndex: activeGame.story.scenes[sceneIndex].answerOptions.indexOf(selectedAnswer),
                    expectedAnswer: activeScene.expectedAnswer,
                    onChoose: answerQuestion,
                    onContinue: () => void continueStory(),
                    continueLabel: sceneIndex === activeGame.story.scenes.length - 1 ? text.finish : text.nextScene,
                    busy,
                  }}
                />
              </Suspense> :
              <div className="question-panel"><p className="question-label"><span aria-hidden="true">✳</span> {text.question}</p><h2>{activeScene.recallQuestion}</h2><div className="answer-options">{activeScene.answerOptions.map((option, index) => <button className={selectedAnswer === activeGame.story.scenes[sceneIndex].answerOptions[index] ? 'answer-button chosen' : 'answer-button'} key={index} onClick={() => answerQuestion(index)}><span className="answer-letter">{String.fromCharCode(65 + index)}</span><span>{option}</span>{selectedAnswer === activeGame.story.scenes[sceneIndex].answerOptions[index] && <span className="answer-check" aria-label={text.selected}>✓</span>}</button>)}</div><div className="question-actions"><button className="button patient-play" onClick={() => speakNarration(`${activeScene.recallQuestion} ${activeScene.answerOptions.join('. ')}`)}><span aria-hidden="true">♫</span> {text.listenChoices}</button><button className="button button-primary patient-next" disabled={!selectedAnswer || busy} onClick={() => void continueStory()}>{busy ? text.saving : sceneIndex === activeGame.story.scenes.length - 1 ? text.finish : text.nextScene} <span aria-hidden="true">→</span></button></div></div>}
          </div>
        ) : <div className="translation-wait" role="status"><p>{translationError ? text.translationFailed : text.loadingTranslation}</p>{translationError && <button className="button button-secondary" onClick={() => setTranslationAttempt((attempt) => attempt + 1)}>{voiceLocale === 'hi-IN' ? 'फिर कोशिश करें' : 'Try again'}</button>}</div> : finished ? (
          <div className="patient-welcome finished-welcome"><div className="welcome-art" aria-hidden="true">✿</div><p className="patient-kicker">{text.shared}</p><h1>{text.thankYou}</h1><p>{text.quietMoment}</p><button className="button button-primary patient-next" onClick={() => setFinished(false)}>{text.seeStories} <span aria-hidden="true">→</span></button></div>
        ) : (
          <div className="patient-welcome">
            <div className="patient-home-hero">
              <div className="patient-home-copy">
                <p className="patient-kicker">{text.welcome}</p>
                <h1>{text.shareStory}</h1>
                <p>{text.takeTime}</p>
              </div>
              <svg className="storybook-art" viewBox="0 0 260 210" role="img" aria-label="An open storybook with a sunny garden">
                <circle cx="188" cy="56" r="33" fill="#E9B35F" />
                <path d="M155 154c15-31 36-44 67-42v51h-69l2-9Z" fill="#8EAD82" />
                <path d="M33 85c31-13 59-8 97 17 31-25 63-30 97-17v91c-33-12-65-7-97 17-37-23-68-29-97-17V85Z" fill="#FFFCF2" stroke="#315D4A" strokeWidth="5" strokeLinejoin="round" />
                <path d="M130 102v91M49 109c21-6 39-3 57 6M49 128c19-4 36 0 54 9M151 115c19-9 38-12 59-6M151 136c19-9 38-12 59-6" stroke="#B7C6A8" strokeWidth="5" strokeLinecap="round" />
                <path d="M83 79c0-12 9-21 21-21s21 9 21 21v14H83V79Z" fill="#D9876B" />
                <path d="M93 78c0-6 5-11 11-11s11 5 11 11" stroke="#FFF4E5" strokeWidth="4" strokeLinecap="round" />
                <path d="M218 48l5-7m-51 5-5-7m16 41c5 5 12 5 17 0" stroke="#D99B48" strokeWidth="4" strokeLinecap="round" />
              </svg>
            </div>
            <label className={checkedCaregiver ? 'caregiver-confirm confirmed' : 'caregiver-confirm'}><input type="checkbox" checked={checkedCaregiver} onChange={(event) => setCheckedCaregiver(event.target.checked)} /><span className="caregiver-check-art" aria-hidden="true">{checkedCaregiver ? '✓' : '♡'}</span><span><b>{text.caregiverHere}</b><small>{text.enjoyTogether}</small></span></label>
            <div className="story-shelf-heading"><div><p className="patient-kicker">{text.picked}</p><h2>{text.yourStories}</h2></div><span className="shelf-count">{stories.length} {voiceLocale === 'hi-IN' ? text.stories : stories.length === 1 ? text.story : text.stories}</span></div>
            {translationError && <div className="translation-wait translation-inline" role="alert"><p>{text.translationFailed}</p><button className="button button-secondary" onClick={() => setTranslationAttempt((attempt) => attempt + 1)}>{voiceLocale === 'hi-IN' ? 'फिर कोशिश करें' : 'Try again'}</button></div>}
            {stories.length === 0 ? <div className="no-stories"><p>{text.noStories}</p><small>{text.doctorAddStory}</small></div> :
              <div className="patient-story-list">{stories.map((story) => {
                const activeSession = activeSessions.find((session) => session.storyId === story.id);
                const firstScene = story.scenes[0];
                const coverPhoto = firstScene ? photos.find((photo) => photo.id === firstScene.photoId) : undefined;
                const localizedStory = translatedStories[story.id];
                const storyTitle = voiceLocale === 'en-US' ? story.title : localizedStory?.title ?? text.loadingTranslation;
                const sourcePreview = voiceLocale === 'en-US' ? firstScene?.narration : localizedStory?.scenes[0]?.narration;
                const preview = sourcePreview && sourcePreview.length > 96
                  ? `${sourcePreview.slice(0, 93).trimEnd()}…`
                  : sourcePreview ?? '';
                return <article className="patient-story-card" key={story.id}>
                  <span className="patient-story-art" aria-hidden="true">
                    {coverPhoto ? <PhotoImage photo={coverPhoto} alt="" className="patient-story-cover-image" /> :
                      firstScene?.externalImage ? <img className="patient-story-cover-image" src={firstScene.externalImage.url} alt="" referrerPolicy="no-referrer" /> :
                        <span className="cover-book">✦</span>}
                    <span className="cover-scene-count">{story.scenes.length} {story.scenes.length === 1 ? 'scene' : 'scenes'}</span>
                  </span>
                  <span className="patient-story-info"><b>{storyTitle}</b>{story.experienceMode === '3D' && <small className="patient-story-mode">{voiceLocale === 'hi-IN' ? 'मीरा के साथ 3D कहानी' : '3D story with Mira'}</small>}<small>{preview || text.loadingTranslation}</small></span>
                  {activeSession ? (
                    <button className="button button-primary" disabled={!checkedCaregiver || busy || translationBusy || (voiceLocale !== 'en-US' && !localizedStory)} onClick={() => resumeStory(activeSession)}>{text.resume}</button>
                  ) : (
                    <button className="button button-primary" disabled={!checkedCaregiver || busy || translationBusy || (voiceLocale !== 'en-US' && !localizedStory)} onClick={() => void startStory(story)}>{text.start}</button>
                  )}
                </article>;
              })}</div>}
          </div>
        )}
        {!activeGame && <>
          <MedicalHistoryPanel patientView locale={voiceLocale} />
          <section className="patient-simulation-launch">
            <div><p className="patient-kicker">{text.explore3d}</p><p>{text.simulationIntro}</p></div>
            <button className="button button-secondary" aria-expanded={showSimulation} onClick={() => setShowSimulation((value) => !value)}>
              {showSimulation ? text.close3d : text.explore3d}
            </button>
            {showSimulation && <Suspense fallback={<div className="loading-card">Opening the 3D scene…</div>}><MemorySimulation patientView hindi={voiceLocale === 'hi-IN'} /></Suspense>}
          </section>
        </>}
        {error && <p className="patient-notice patient-error" role="alert">{error}</p>}
        {notice && <p className="patient-notice" role="status">{notice}</p>}
        {activeAlertId && <div className={alertAcknowledged ? 'alert-status acknowledged' : 'alert-status'} role="status">
          <span className="alert-status-icon">{alertAcknowledged ? '✓' : '•'}</span>
            <p>{alertAcknowledged ? text.alertSeen : showFallback ? text.fallback : text.alertStatus}</p>
        </div>}
      </section>
      <button className="call-caregiver" disabled={Boolean(activeAlertId && !alertAcknowledged)} onClick={() => void callCaregiver()}><span aria-hidden="true">♡</span><span>{activeAlertId && !alertAcknowledged ? text.called : text.callCaregiver}</span></button>
    </main>
  );
}

export default App;
