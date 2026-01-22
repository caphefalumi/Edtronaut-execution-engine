import { Worker, type Job } from "bullmq";
import { db } from "../db";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { getRedisConnectionOptions } from "./config";

const TEMP_DIR = join(process.cwd(), "temp_execution");
if (!existsSync(TEMP_DIR)) {
  await mkdir(TEMP_DIR);
}

interface ExecutionJob {
  executionId: string;
  language: string;
  code: string;
}

const EXECUTION_TIMEOUT_MS = 5000;

export const executionWorker = new Worker<ExecutionJob>(
  "code-execution",
  async (job: Job<ExecutionJob>) => {
    const { executionId, language, code } = job.data;
    const startTime = Date.now();

    console.log(`[Worker] Processing execution ${executionId} (${language})`);

    await db.updateExecutionStatus(executionId, "RUNNING", null, null, null);

    const fileName = `${executionId}.${language === "python" ? "py" : "js"}`;
    const filePath = join(TEMP_DIR, fileName);

    try {
      await writeFile(filePath, code);

      let cmd: string[];
      if (language === "python") {
        cmd = ["python3", filePath];
      } else if (language === "javascript" || language === "typescript") {
        cmd = ["bun", filePath];
      } else {
        throw new Error(`Unsupported language: ${language}`);
      }

      // Execute code
      const proc = Bun.spawn(cmd, {
        stdout: "pipe",
        stderr: "pipe",
      });

      const timeoutSignal = AbortSignal.timeout(EXECUTION_TIMEOUT_MS);
      
      const exited = await Promise.race([
        proc.exited,
        new Promise<number>((_, reject) => {
          timeoutSignal.onabort = () => {
             proc.kill();
             reject(new Error("Execution Timed Out"));
          };
        })
      ]);

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const duration = Date.now() - startTime;

      console.log(`[Worker] Finished ${executionId} in ${duration}ms`);
      
      await db.updateExecutionStatus(
        executionId, 
        "COMPLETED", 
        stdout, 
        stderr || null, 
        duration
      );

    } catch (error: any) {
      console.error(`[Worker] Failed ${executionId}: ${error.message}`);
      const duration = Date.now() - startTime;
      
      let status: "TIMEOUT" | "FAILED" = "FAILED";
      let errorMsg = error.message;

      if (error.message === "Execution Timed Out") {
        status = "TIMEOUT";
      }

      await db.updateExecutionStatus(
        executionId, 
        status, 
        null, 
        errorMsg, 
        duration
      );
    } finally {
      try {
        if (existsSync(filePath)) await unlink(filePath);
      } catch (e) {
        console.error("Failed to cleanup file", filePath);
      }
    }
  },
  {
    connection: getRedisConnectionOptions(),
    concurrency: 5,
  }
);

console.log("[Worker] Execution worker started");
