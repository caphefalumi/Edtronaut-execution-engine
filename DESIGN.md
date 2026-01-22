# System Design & Architecture

## 1. Architecture Overview

The system follows an **Asynchronous Worker Pattern** to decouple API handling from the heavy lifting of code execution.

### High-Level Architecture

```
+--------+        +-----------------+        +------------------+
|        |        |                 |        |                  |
|  User  |------->|   API Gateway   |------->|    Redis Queue   |
|        | HTTP   |   (ElysiaJS)    |  Push  |     (BullMQ)     |
+--------+        +--------+--------+        +---------+--------+
     ^                     |                           |
     |                     | Read/Write                | Pull Job
     |                     v                           v
     |            +--------+--------+        +---------+--------+
     |            |                 |Update  |                  |
     +------------|  MySQL Database |<-------| Execution Worker |
       Poll       |                 | Status |                  |
       Result     +-----------------+        +------------------+
                                                       |
                                                       | Spawns
                                                       v
                                             +------------------+
                                             |   Isolated       |
                                             |   Subprocess     |
                                             | (Python/JS/TS)   |
                                             +------------------+
```

### Components
1.  **API Gateway (ElysiaJS)**: Handles HTTP requests, manages sessions in MySQL, and pushes execution jobs to Redis.
2.  **Message Broker (Redis)**: Acts as a buffer between the API and the worker, ensuring bursts of requests don't crash the executor.
3.  **Worker (BullMQ)**: Pulls jobs, writes code to disk, executes it via `Bun.spawn`, and updates the database with results.
4.  **Database (MySQL)**: Stores persistent state (Sessions & Executions). Replaced SQLite to support concurrency and remote access.

### Request Flow
1.  **User** submits code -> **API** saves to DB -> Returns `session_id`.
2.  **User** requests execution -> **API** creates `execution_id` (QUEUED) -> Pushes to **Redis**.
3.  **Worker** picks up job -> Writes file -> Spawns process -> Captures output -> Updates **DB**.
4.  **User** polls `/executions/:id` -> **API** reads from **DB** -> Returns result.

## 2. Reliability & Safety

-   **Timeouts**: Code execution is strictly limited to 5 seconds. If a process hangs (e.g., `while True:`), the worker kills the subprocess and marks the execution as `TIMEOUT`.
-   **Isolation**: Code runs in a subprocess. In a production environment, this would be further isolated using **Docker containers** (e.g., one container per run) or **Firecracker MicroVMs** to prevent filesystem access or fork bombs.
-   **Queue Persistence**: BullMQ ensures jobs are not lost if the worker crashes. Failed jobs are kept for inspection.

## 3. Scalability Considerations

-   **Horizontal Scaling**: The API is stateless. You can run multiple instances of the API server behind a load balancer.
-   **Worker Scaling**: The worker is decoupled. You can spin up 10, 100, or 1000 worker containers on different machines pointing to the same Redis instance to increase throughput.
-   **Database**: Migrated to **MySQL** (remote) to support multiple API/Worker nodes concurrently, removing the single-file limitation of SQLite.

## 4. Trade-offs

-   **Subprocess vs Docker**: I used `Bun.spawn` (subprocess) for speed and simplicity. Running `docker run` for every execution is safer but much slower (startup overhead) and complex to orchestrate inside a Dockerized app (Docker-in-Docker).
-   **Polling vs WebSockets**: The assignment spec uses polling (`GET /executions/:id`). WebSockets would provide a better UX (real-time push) but add complexity.
-   **Remote MySQL**: Adds network latency compared to local SQLite, but enables horizontal scaling and better data integrity.
