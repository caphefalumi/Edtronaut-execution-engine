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
    
    // Parse the URL to verify it's being read
    if (!process.env.DATABASE_URL) {
        console.error("[DB] FATAL: DATABASE_URL is not set!");
    }

    // Explicitly configure SSL if using a cloud provider that might need it
    // Most cloud URLs look like: mysql://user:pass@host:port/db?ssl-mode=REQUIRED
    // We strip parameters that mysql2 might not like and handle SSL explicitly
    
    const dbConfig: any = {
        uri: process.env.DATABASE_URL,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    };

    // Auto-detect SSL requirement from URL or Env
    const useSSL = process.env.DATABASE_URL?.includes("ssl-mode") || 
                   process.env.DATABASE_URL?.includes("ssl=") ||
                   process.env.DATABASE_SSL === "true";

    if (useSSL) {
        console.log("[DB] Enabling SSL for database connection");
        dbConfig.ssl = { rejectUnauthorized: false }; // Allow self-signed certs common in some cloud providers
    }

    this.pool = mysql.createPool(dbConfig);
    
    // Test connection immediately to fail fast
    this.testConnection();
    this.init();
  }

  private async testConnection() {
      try {
          const conn = await this.pool.getConnection();
          console.log("[DB] Successfully connected to MySQL!");
          conn.release();
      } catch (err: any) {
          console.error(`[DB] Connection Failed: ${err.code} - ${err.message}`);
          // Don't log full URL to avoid leaking passwords, but log the host
          const sanitizedHost = process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || "unknown";
          console.error(`[DB] Host: ${sanitizedHost}`); 
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
