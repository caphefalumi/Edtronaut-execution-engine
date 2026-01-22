import mysql from "mysql2/promise";

export type SessionStatus = "ACTIVE" | "ARCHIVED";
export type ExecutionStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT";

export interface CodeSession {
  id: string;
  language: string;
  source_code: string;
  status: SessionStatus;
  created_at: Date;
  updated_at: Date;
}

export interface Execution {
  id: string;
  session_id: string;
  status: ExecutionStatus;
  stdout: string | null;
  stderr: string | null;
  execution_time_ms: number | null;
  created_at: Date;
  updated_at: Date;
}

export class DB {
  private pool: mysql.Pool;

  constructor() {
    console.log("[DB] Initializing database connection...");
    
    if (!process.env.DATABASE_URL) {
        console.error("[DB] FATAL: DATABASE_URL is not set!");
    }

    let connectionUri = process.env.DATABASE_URL || "";
    
    const isCloudDB = connectionUri.includes("aivencloud.com") || 
                      connectionUri.includes("psdb.cloud") || 
                      connectionUri.includes("aws") ||
                      connectionUri.includes("ssl-mode");

    const dbConfig: any = {
        uri: connectionUri,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        connectTimeout: 20000 
    };

    if (isCloudDB || process.env.DATABASE_SSL === "true") {
        console.log("[DB] Detected Cloud/SSL Database. Enforcing SSL config.");
        dbConfig.ssl = { 
            rejectUnauthorized: false 
        };
    }

    this.pool = mysql.createPool(dbConfig);
    
    this.testConnection();
    this.init();
  }

  private async testConnection() {
      try {
          if (process.env.DATABASE_URL) {
            try {
                const url = new URL(process.env.DATABASE_URL);
                console.log(`[DB] Attempting connection to Host: ${url.hostname}, Port: ${url.port || 3306}`);
            } catch (e) {
                console.log("[DB] Could not parse DATABASE_URL for logging.");
            }
          }

          const conn = await this.pool.getConnection();
          console.log("[DB] ✅ Successfully connected to MySQL!");
          conn.release();
      } catch (err: any) {
          console.error(`[DB] ❌ Connection Failed: ${err.code} - ${err.message}`);
      }
  }

  private async init() {
    try {
      const connection = await this.pool.getConnection();
      try {
        await connection.query(`
          CREATE TABLE IF NOT EXISTS sessions (
            id VARCHAR(36) PRIMARY KEY,
            language TEXT NOT NULL,
            source_code LONGTEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          )
        `);

        // Migration: Check if 'language' column exists, if not add it
        // This fixes the ER_BAD_FIELD_ERROR if table exists from old schema
        try {
            await connection.query("SELECT language FROM sessions LIMIT 1");
        } catch (err: any) {
            if (err.code === 'ER_BAD_FIELD_ERROR') {
                console.log("[DB] Migrating: Adding missing 'language' column to sessions table...");
                await connection.query("ALTER TABLE sessions ADD COLUMN language TEXT NOT NULL AFTER id");
            }
        }

        await connection.query(`
          CREATE TABLE IF NOT EXISTS executions (
            id VARCHAR(36) PRIMARY KEY,
            session_id VARCHAR(36) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
            stdout LONGTEXT,
            stderr LONGTEXT,
            execution_time_ms INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
          )
        `);
      } finally {
        connection.release();
      }
    } catch (err) {
      console.error("[DB] Schema Init Failed:", err);
    }
  }

  async createSession(id: string, language: string, source_code: string): Promise<CodeSession> {
    const [result] = await this.pool.query(
      "INSERT INTO sessions (id, language, source_code) VALUES (?, ?, ?)",
      [id, language, source_code]
    );
    return this.getSession(id) as Promise<CodeSession>;
  }

  async getSession(id: string): Promise<CodeSession | null> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM sessions WHERE id = ?",
      [id]
    );
    return (rows[0] as CodeSession) || null;
  }

  async updateSessionCode(id: string, source_code: string): Promise<CodeSession | null> {
    await this.pool.query(
      "UPDATE sessions SET source_code = ? WHERE id = ?",
      [source_code, id]
    );
    return this.getSession(id);
  }

  async createExecution(id: string, session_id: string): Promise<Execution> {
    await this.pool.query(
      "INSERT INTO executions (id, session_id, status) VALUES (?, ?, 'QUEUED')",
      [id, session_id]
    );
    return this.getExecution(id) as Promise<Execution>;
  }

  async updateExecutionStatus(id: string, status: ExecutionStatus, stdout: string | null, stderr: string | null, timeMs: number | null): Promise<Execution | null> {
    await this.pool.query(
      "UPDATE executions SET status = ?, stdout = ?, stderr = ?, execution_time_ms = ? WHERE id = ?",
      [status, stdout, stderr, timeMs, id]
    );
    return this.getExecution(id);
  }

  async getExecution(id: string): Promise<Execution | null> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM executions WHERE id = ?",
      [id]
    );
    return (rows[0] as Execution) || null;
  }
}

export const db = new DB();
