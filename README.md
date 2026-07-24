# AI Chat Interface Application

A modern, scalable AI chat interface inspired by Open-WebUI, built with extensibility and future growth in mind.

## 📋 Overview

This application provides a comprehensive AI chat interface with support for multiple model providers, RAG capabilities, collaboration features, and a plugin system for extensibility.

## 🚀 Quick Start (Docker Compose)

### Prerequisites
- Docker
- Docker Compose

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd finetuning

# Setup environment
cp .env.example .env
# Edit .env with your configuration (optional for basic setup)

# Start all services (infrastructure + applications)
docker compose up -d --build
```

The application will be available at:
- Web UI: http://localhost:3500
- API: http://localhost:3001
- RAG Service: http://localhost:3002
- MinIO Console: http://localhost:9001

### Development Mode

For local development with hot reload:

```bash
# Start infrastructure only
docker compose up -d postgres redis chromadb minio

# Install dependencies
npm install

# Setup environment
cp .env.example .env

# Setup database
npm run db:setup

# Start development servers
npm run dev
```

## 📁 Project Structure

```
.
├── apps/
│   ├── web/              # Frontend React application
│   ├── api/              # Backend API service
│   ├── rag/              # RAG microservice
│   └── worker/           # Background job processor
├── packages/
│   ├── shared/           # Shared utilities and types
│   ├── ui/               # Shared UI components
│   └── config/           # Shared configuration
├── docs/                 # Documentation
├── SPECIFICATION.md      # Master specification document
└── docker-compose.yml    # Local development setup
```

## 🔧 Technology Stack

- **Frontend**: React 18+, TypeScript, TailwindCSS, shadcn/ui
- **Backend**: Node.js/Bun, Fastify/Elysia, TypeScript
- **Database**: PostgreSQL, Redis, ChromaDB/Qdrant
- **Infrastructure**: Docker, Kubernetes

## 📖 Documentation

See [SPECIFICATION.md](./SPECIFICATION.md) for the complete feature specification and architecture details.

## 🧩 Features

- Multi-model support (OpenAI, Ollama, LM Studio, etc.)
- Advanced RAG with vector databases
- Plugin system for extensibility
- Real-time collaboration (channels, notes)
- Voice and video capabilities
- Image generation
- Workflow automation
- Usage analytics

## 🗺️ Roadmap

See [SPECIFICATION.md](./SPECIFICATION.md#4-implementation-phases) for the implementation roadmap.

## 📄 License

MIT
# checkpoint
