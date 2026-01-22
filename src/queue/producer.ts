import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "./config";

export const executionQueue = new Queue("code-execution", {
  connection: getRedisConnectionOptions(),
});

export const addExecutionJob = async (executionId: string, language: string, code: string) => {
  await executionQueue.add("execute", {
    executionId,
    language,
    code,
  }, {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  });
};
