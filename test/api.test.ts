import { describe, expect, it, mock, afterAll, beforeAll } from "bun:test";
import { unlink } from "node:fs/promises";

// Mock BullMQ to avoid Redis connection
mock.module("bullmq", () => {
  return {
    Queue: class {
      add = mock(() => Promise.resolve());
    },
    Worker: class {
      constructor() {}
      on() {}
      close() { return Promise.resolve(); }
    }
  };
});

const TEST_DB_FILE = "test_live_code.sqlite";

// Mock DB to use a test file
mock.module("../src/db", () => {
    const { Database } = require("bun:sqlite");
    
    // Re-implementing DB class to avoid importing the original which might trigger side effects or circular deps when mocking
    class DB {
        public db: any;
        constructor(filename = TEST_DB_FILE) {
             this.db = new Database(filename, { create: true });
             this.init();
        }
        init() {
            this.db.exec("PRAGMA journal_mode = WAL;");
            this.db.exec(`CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                language TEXT NOT NULL,
                source_code TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`);
            this.db.exec(`CREATE TABLE IF NOT EXISTS executions (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'QUEUED',
                stdout TEXT,
                stderr TEXT,
                execution_time_ms INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )`);
        }
        createSession(id: string, language: string, source_code: string) {
            const query = this.db.query(`INSERT INTO sessions (id, language, source_code) VALUES ($id, $language, $source_code) RETURNING *`);
            return query.get({ $id: id, $language: language, $source_code: source_code });
        }
        getSession(id: string) {
            return this.db.query("SELECT * FROM sessions WHERE id = $id").get({ $id: id });
        }
        updateSessionCode(id: string, source_code: string) {
            const query = this.db.query(`UPDATE sessions SET source_code = $source_code, updated_at = CURRENT_TIMESTAMP WHERE id = $id RETURNING *`);
            return query.get({ $id: id, $source_code: source_code });
        }
        createExecution(id: string, session_id: string) {
            const query = this.db.query(`INSERT INTO executions (id, session_id, status) VALUES ($id, $session_id, 'QUEUED') RETURNING *`);
            return query.get({ $id: id, $session_id: session_id });
        }
        updateExecutionStatus(id: string, status: string, stdout: string | null, stderr: string | null, timeMs: number | null) {
             const query = this.db.query(`UPDATE executions SET status = $status, stdout = $stdout, stderr = $stderr, execution_time_ms = $timeMs, updated_at = CURRENT_TIMESTAMP WHERE id = $id RETURNING *`);
             return query.get({ $id: id, $status: status, $stdout: stdout, $stderr: stderr, $timeMs: timeMs });
        }
        getExecution(id: string) {
            return this.db.query("SELECT * FROM executions WHERE id = $id").get({ $id: id });
        }
    }
    
    return {
        DB,
        db: new DB(TEST_DB_FILE)
    };
});

// Import app dynamically to ensure mocks are applied first
// import { app } from "../src/index"; 

describe("Live Code Executor API", () => {
    let app: any;
    let sessionId: string;
    let executionId: string;

    beforeAll(async () => {
        const mod = await import("../src/index");
        app = mod.app;
    });

    afterAll(async () => {
        try {
            const { db } = await import("../src/db");
            if (db && (db as any).db) {
                (db as any).db.close();
            }
        } catch (e) { console.error("Error closing DB", e); }
        
        try {
            await unlink(TEST_DB_FILE);
            await unlink(TEST_DB_FILE + "-shm");
            await unlink(TEST_DB_FILE + "-wal");
        } catch {}
    });

    it("POST /code-sessions creates a session", async () => {
        const response = await app.handle(new Request("http://localhost/code-sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ language: "python", source_code: "print('hello')" })
        }));
        
        expect(response.status).toBe(200);
        const body = await response.json() as any;
        expect(body).toHaveProperty("session_id");
        expect(body.status).toBe("ACTIVE");
        sessionId = body.session_id;
    });

    it("PATCH /code-sessions/:id should update session code", async () => {
        const response = await app.handle(new Request(`http://localhost/code-sessions/${sessionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source_code: "print('updated')" })
        }));

        expect(response.status).toBe(200);
        const body = await response.json() as any;
        expect(body.session_id).toBe(sessionId);
        expect(body.status).toBe("ACTIVE");
    });

    it("POST /code-sessions/:id/run should queue execution", async () => {
        const response = await app.handle(new Request(`http://localhost/code-sessions/${sessionId}/run`, {
            method: "POST"
        }));

        expect(response.status).toBe(200);
        const body = await response.json() as any;
        expect(body).toHaveProperty("execution_id");
        expect(body.status).toBe("QUEUED");
        executionId = body.execution_id;
    });

    it("GET /executions/:id should return execution status", async () => {
        const response = await app.handle(new Request(`http://localhost/executions/${executionId}`, {
            method: "GET"
        }));

        expect(response.status).toBe(200);
        const body = await response.json() as any;
        expect(body.execution_id).toBe(executionId);
        expect(body.status).toBe("QUEUED"); // Still queued because worker is mocked/not running
    });
    
    it("should return 404 for non-existent session", async () => {
        const response = await app.handle(new Request("http://localhost/code-sessions/fake-id/run", {
            method: "POST"
        }));
        expect(response.status).toBe(404);
    });
});
