# Manus AI Agent Clone (Manus Remix)

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
- **UI Framework**: React 18, Tailwind CSS, Lucide Icons, Radix UI, Framer Motion
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