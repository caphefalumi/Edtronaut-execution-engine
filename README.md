# Live Code Execution System (Edtronaut)

A robust backend system for executing user-submitted code in real-time, built with **Bun**, **ElysiaJS**, **BullMQ** (Redis), and **MySQL**.

## Features

- **Real-time Code Execution**: Supports Python and JavaScript/TypeScript.
- **Asynchronous Processing**: Uses BullMQ/Redis for non-blocking job queues.
- **Autosave**: Persists session state instantly.
- **Secure Isolation**: Runs code in ephemeral subprocesses with strict timeouts.
- **Persistence**: Stores full session and execution history in MySQL.
- **Dockerized**: Full environment (App, Redis, MySQL) orchestrated with Docker Compose.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh) (v1.1+)
- **API**: [ElysiaJS](https://elysiajs.com)
- **Queue**: [BullMQ](https://docs.bullmq.io) on Redis
- **Database**: MySQL (v8.0)
- **Container**: Docker (Multi-stage build) & Docker Compose

## Getting Started

### Prerequisites

- [Docker](https://www.docker.com/) & Docker Compose
- [Bun](https://bun.sh) (optional, if running locally outside Docker)

### Run with Docker (Recommended)

1. Start the services:
   ```bash
   docker-compose up --build -d
   ```
2. The API will be available at `http://localhost:1409`.

### Run Locally (Development)

If you prefer to run the app outside of Docker while keeping services containerized:

1. Start dependencies (Redis & MySQL):
   ```bash
   docker-compose up redis mysql -d
   ```
2. Install dependencies:
   ```bash
   bun install
   ```
3. Start the server:
   ```bash
   bun run src/index.ts
   ```
   *Note: The server will run on port 1409.*

## API Documentation

**Base URL:** `http://localhost:1409`

### 1. Create Session
**POST** `/code-sessions`
```json
{
  "language": "python",
  "source_code": "print('Hello')"
}
```

### 2. Autosave Code
**PATCH** `/code-sessions/:id`
```json
{
  "source_code": "print('Hello Updated')"
}
```

### 3. Run Code
**POST** `/code-sessions/:id/run`
Response:
```json
{
  "execution_id": "uuid...",
  "status": "QUEUED"
}
```

### 4. Get Result
**GET** `/executions/:id`
Response:
```json
{
  "execution_id": "uuid...",
  "status": "COMPLETED",
  "stdout": "Hello Updated\n",
  "stderr": "",
  "execution_time_ms": 42
}
```
