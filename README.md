# Deku AI

A powerful autonomous AI agent workspace built with React, Vite, TypeScript, and Tailwind CSS. Features multi-step reasoning, real-time research, data analysis, interactive previews, multimodal capabilities, and an integrated tool execution framework.

## Core Features

- **Multi-Step Autonomous Agent**: Autonomous problem solving with structured thinking, step-by-step reasoning, tool approvals, and real-time execution tracking.
- **Rich Chat & Reasoning Interface**: Contextual thought processes, markdown rendering with syntax highlighting, source citations, and charts.
- **Website Builder & Live Previews**: Built-in website generator with live interactive iframe preview and code view.
- **Voice & Multimodal Support**: High-fidelity Web Speech API voice synthesis and speech recognition, 3D interactive avatar (Three.js), and camera integration.
- **Connectors & Tools**: Integrations for web search (Firecrawl / Agent Reach), Google Maps, Google Drive, and public data APIs.
- **Task Management & History**: IndexedDB and Firebase Firestore persistence for chat sessions, checkpoints, and task history.
- **Modern Responsive Design**: Accessible Shadcn UI primitives, Tailwind styling, smooth dark/light theme switching, and keyboard navigation.

## Tech Stack

- **Runtime & Build**: Node.js, Vite, TypeScript
- **UI Framework**: React 18, Tailwind CSS, Lucide and PulsoIcon icons, Radix UI, Framer Motion
- **3D Graphics & Audio**: Three.js, React Three Fiber, Web Speech API, Web Audio API
- **Persistence & Cloud**: Firebase (Firestore, Auth), IndexedDB
- **Data Visualization**: Recharts

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

The application runs on `http://localhost:3000`.

### Building for Production

```bash
npm run build
```

### Running Tests

```bash
npm test
```

### Production security configuration

Configure `TOKEN_ENCRYPTION_SECRET` and `POLICY_GATEWAY_SECRET` as independent server-only random secrets of at least 32 characters. Do not expose them through `VITE_*` variables. Production AI and web-search endpoints also require `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for atomic per-user rate limits across serverless instances; without the shared limiter, those endpoints fail closed. Configure `VITE_GOOGLE_MAPS_API_KEY` only with a Google Maps key restricted to the app's allowed domains and required APIs.

### Third-party icon notice

Animated interface icons use `pulsoicon-react` (PulsoIcon 6.2.0). The full upstream license and third-party notices are included in [`THIRD_PARTY_NOTICES/PulsoIcon-LICENSE.txt`](THIRD_PARTY_NOTICES/PulsoIcon-LICENSE.txt).
