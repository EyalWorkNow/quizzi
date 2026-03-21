# Quizzi: Predictive Pedagogical Telemetry & Cognitive Assessment Platform

## 🎓 Academic Thesis & Abstract
Quizzi is not merely a gamified assessment tool; it is a **Cognitive Behavioral Engine** designed to bridge the visibility gap between student performance and internal cognitive load. Conventional classroom response systems (CRSs) focus exclusively on **Correctness (Outcome-Based Assessment)**. Quizzi shifts the paradigm toward **Interaction (Process-Based Assessment)**.

By capturing micro-telemetry—such as decision latency, answer volatility (swaps), and focus patterns—Quizzi allows educators to differentiate between **Confident Mastery**, **Lucky Guesses**, and **Panic-Induced Error**. This platform utilizes a deterministic Python-based behavioral engine to translate raw interaction data into actionable pedagogical insights.

---

## 🏛️ System Architecture

### 1. The High-Signal Data Pipeline
The platform implements a unidirectional data flow from the client (Student interaction) to a centralized telemetry buffer, processed by a specialized analytics engine.

```mermaid
graph TD
    A[Student Interface] -->|Real-time Telemetry| B[Vite/Express Gateway]
    B -->|Interaction Streams| C[(SQLite/Postgres Datastore)]
    C -->|Batch Processing| D[Python Behavior Engine]
    D -->|Pedagogical Signals| E[Teacher Dashboard]
    D -->|Personalized Drill-down| F[Student Adaptive Portal]
    G[Gemini LLM] -->|Contextual Generation| B
```

### 2. Technical Stack (Elite Grade)
*   **Infrastructure**: Node.js 20+ Runtime, Express 4.x, Vite 6.0 (HMR Middleware).
*   **Intelligence Layer**: Google Gemini Generative AI (Material-to-Question Orchestration).
*   **Analytics Kernel**: Python 3.10+ (NumPy/Pandas potential) for deterministic scoring and stress-index calculation.
*   **Database**: Dual-strategy (SQLite for rapid edge deployments, Supabase/Postgres for scalable cloud infrastructure).
*   **UI/UX**: React 19, Motion (Framer), Tailwind CSS, Lucide-React.

---

## 🔬 Core Pedagogical Features

### I. Deterministic Interaction Telemetry
Unlike traditional quizzes, Quizzi monitors the **Behavioral Fingerprint** of every answer:
*   **Latency Analysis**: Measures "Time to First Insight" vs. "Time to Final Commitment".
*   **Volatility (Swaps)**: Tracks cognitive dissonance and certainty levels.
*   **Focus Attenuation**: Identifies external distractions (Blur/Idle tracking).

### II. The "Material Intel" Compression Strategy
To minimize LLM hallucination and maximize token efficiency, Quizzi implements a pre-generation synthesis layer:
*   **Source Profiling**: Deterministic extraction of key points and topic fingerprints.
*   **Prompt Optimization**: Narrow-scope generation focused only on processed material intel.

### III. Adaptive Feedback Loop
The loop is closed via **Automated Remastery Suggestions**:
1.  **Detection**: Identifying weak conceptual nodes via behavioral outliers.
2.  **Resolution**: Dynamically generating targeted practice sessions based on the student's specific "Stress-Mastery" intersection.

---

## 🛠️ Implementation & Deployment

### Local Orchestration
```bash
# 1. Dependency Synchronization
npm install

# 2. Environment Configuration
cp .env.example .env # Configure GEMINI_API_KEY, QUIZZI_AUTH_SECRET, and Firebase keys

# 3. Development Execution
npm run dev
```

### Production Readiness
The platform is designed for horizontal scaling. The backend handles session orchestration via **SSE (Server-Sent Events)** for low-latency host-to-student synchronization, while the persistence layer supports a phased migration from SQLite to hardened Cloud Postgres.

Before any production deploy, set a strong `QUIZZI_AUTH_SECRET` in the server environment. This secret signs teacher session cookies and scoped HMAC auth tokens, and it must be identical across all running instances. Example generation command:

```bash
openssl rand -base64 32
```

For Google teacher sign-in in production, also make sure:

```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

And in Firebase Console, add your deployed frontend domains (for example `quizzi-ivory.vercel.app`) to `Authentication -> Settings -> Authorized domains`.

---

## 🛡️ Security & Integrity Matrix
*   **Identity**: Hardened OAuth2 flows and signed `HttpOnly` session tokens.
*   **Safety**: Input sanitization via strict schema validation and rate-limiting protocols.
*   **Persistence**: Secure environment management for transition from local seeding to production deployments.

---

## 📄 License & Attribution
Quizzi is developed as a state-of-the-art educational framework.
**Author**: Eyal Atiya
**Version**: 2.4.0 (Pedagogical Telemetry Update)
