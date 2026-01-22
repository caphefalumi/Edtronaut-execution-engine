import { Elysia, t } from "elysia";
import { v4 as uuidv4 } from "uuid";
import { db } from "./db";
import { addExecutionJob } from "./queue/producer";

const app = new Elysia()
  .onError(({ code, error, set }) => {
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: "Not Found" };
    }
    console.error(error);
    return { error: "Internal Server Error" };
  })

  .post("/code-sessions", async ({ body }) => {
    const id = uuidv4();
    const session = await db.createSession(id, body.language, body.source_code || "");
    return {
      session_id: session.id,
      status: session.status
    };
  }, {
    body: t.Object({
      language: t.String(),
      source_code: t.Optional(t.String())
    })
  })

  .patch("/code-sessions/:id", async ({ params: { id }, body, set }) => {
    const session = await db.updateSessionCode(id, body.source_code);
    if (!session) {
      set.status = 404;
      return { error: "Session not found" };
    }
    return {
      session_id: session.id,
      status: session.status
    };
  }, {
    body: t.Object({
      language: t.Optional(t.String()),
      source_code: t.String()
    })
  })

  .post("/code-sessions/:id/run", async ({ params: { id }, set }) => {
    const session = await db.getSession(id);
    if (!session) {
      set.status = 404;
      return { error: "Session not found" };
    }

    const executionId = uuidv4();
    
    await db.createExecution(executionId, session.id);

    await addExecutionJob(executionId, session.language, session.source_code);

    return {
      execution_id: executionId,
      status: "QUEUED"
    };
  })

  .get("/executions/:id", async ({ params: { id }, set }) => {
    const execution = await db.getExecution(id);
    if (!execution) {
      set.status = 404;
      return { error: "Execution not found" };
    }
    
    if (execution.status === "COMPLETED" || execution.status === "FAILED" || execution.status === "TIMEOUT") {
      return {
        execution_id: execution.id,
        status: execution.status,
        stdout: execution.stdout || "",
        stderr: execution.stderr || "",
        execution_time_ms: execution.execution_time_ms
      };
    }

    return {
      execution_id: execution.id,
      status: execution.status
    };
  });

export { app };

export default app;

if (import.meta.main) {
    await import("./queue/worker");
    
    app.listen(1409);
    console.log(
      `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
    );
}
