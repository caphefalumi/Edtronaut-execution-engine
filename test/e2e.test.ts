import { describe, expect, it } from "bun:test";

const BASE_URL = process.env.API_URL || "http://localhost:1409";

describe("E2E Live Code Execution System", () => {
  let sessionId: string;
  let executionId: string;

  console.log(`Running E2E tests against ${BASE_URL}`);

  it("1. Should create a new Python session", async () => {
    const res = await fetch(`${BASE_URL}/code-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: "python",
        source_code: "print('Hello from E2E Test')"
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty("session_id");
    sessionId = body.session_id;
    console.log("Session Created:", sessionId);
  });

  it("2. Should run the code", async () => {
    expect(sessionId).toBeDefined();
    
    const res = await fetch(`${BASE_URL}/code-sessions/${sessionId}/run`, {
      method: "POST"
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty("execution_id");
    expect(body.status).toBe("QUEUED");
    executionId = body.execution_id;
    console.log("Execution Queued:", executionId);
  });

  it("3. Should poll until execution is completed", async () => {
    expect(executionId).toBeDefined();

    let status = "QUEUED";
    let attempts = 0;
    const maxAttempts = 50; 

    while (["QUEUED", "RUNNING"].includes(status) && attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 200)); 
      
      const res = await fetch(`${BASE_URL}/executions/${executionId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      status = body.status;
      
      if (status === "COMPLETED") {
        expect(body.stdout).toBe("Hello from E2E Test\n");
        console.log("Execution Completed:", body.stdout.trim());
        return;
      }
      attempts++;
    }

    if (status !== "COMPLETED") {
        throw new Error(`Execution timed out or failed. Status: ${status}`);
    }
  }, 10000); 

  it("4. Should support code updates and re-execution", async () => {
    // Update code
    const updateRes = await fetch(`${BASE_URL}/code-sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_code: "print(2 + 2)"
      })
    });
    expect(updateRes.status).toBe(200);

    // Run again
    const runRes = await fetch(`${BASE_URL}/code-sessions/${sessionId}/run`, {
        method: "POST"
    });
    const runBody = await runRes.json() as any;
    const newExecId = runBody.execution_id;

    // Poll again
    let status = "QUEUED";
    let attempts = 0;
    while (status !== "COMPLETED" && attempts < 20) {
        await new Promise(r => setTimeout(r, 200));
        const res = await fetch(`${BASE_URL}/executions/${newExecId}`);
        const body = await res.json() as any;
        status = body.status;
        if (status === "COMPLETED") {
            expect(body.stdout).toBe("4\n");
            return;
        }
        attempts++;
    }
     if (status !== "COMPLETED") throw new Error("Update execution failed");
  });

  it("5. Should handle Syntax Errors (FAILURE)", async () => {
      // Create bad session
      const res = await fetch(`${BASE_URL}/code-sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              language: "python",
              source_code: "print('broken" // Syntax error
          })
      });
      const session = await res.json() as any;
      
      // Run
      const runRes = await fetch(`${BASE_URL}/code-sessions/${session.session_id}/run`, { method: "POST" });
      const runBody = await runRes.json() as any;
      
      // Poll
      let status = "QUEUED";
      let attempts = 0;
      while (["QUEUED", "RUNNING"].includes(status) && attempts < 20) {
          await new Promise(r => setTimeout(r, 200));
          const pollRes = await fetch(`${BASE_URL}/executions/${runBody.execution_id}`);
          const pollBody = await pollRes.json() as any;
          status = pollBody.status;
          
          if (status === "FAILED") {
              expect(pollBody.stderr).toBeDefined();
              console.log("Syntax Error Caught:", pollBody.stderr.split('\n')[0]);
              return;
          }
          attempts++;
      }
      if (status !== "FAILED") throw new Error(`Expected FAILED but got ${status}`);
  });

  it("6. Should handle Infinite Loops (TIMEOUT)", async () => {
      // Create infinite loop session
      const res = await fetch(`${BASE_URL}/code-sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              language: "python",
              source_code: "import time\ntime.sleep(6)" // Sleep longer than 5s timeout
          })
      });
      const session = await res.json() as any;
      
      // Run
      const runRes = await fetch(`${BASE_URL}/code-sessions/${session.session_id}/run`, { method: "POST" });
      const runBody = await runRes.json() as any;
      
      console.log("Waiting for TIMEOUT (approx 5s)...");
      
      // Poll (needs longer timeout)
      let status = "QUEUED";
      let attempts = 0;
      // 5s timeout + buffer -> wait up to 8s
      while (["QUEUED", "RUNNING"].includes(status) && attempts < 40) { 
          await new Promise(r => setTimeout(r, 250));
          const pollRes = await fetch(`${BASE_URL}/executions/${runBody.execution_id}`);
          const pollBody = await pollRes.json() as any;
          status = pollBody.status;
          
          if (status === "TIMEOUT") {
              expect(pollBody.stderr).toBe("Execution Timed Out");
              console.log("Timeout Caught Successfully");
              return;
          }
          attempts++;
      }
      if (status !== "TIMEOUT") throw new Error(`Expected TIMEOUT but got ${status}`);
  }, 10000); 
});
