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
    this.pool = mysql.createPool(process.env.DATABASE_URL!);
    this.init();
  }

  private async init() {
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
