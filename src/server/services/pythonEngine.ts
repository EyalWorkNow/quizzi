import { spawn } from 'child_process';
import path from 'path';
import { createBoundedTaskGate, defaultTaskConcurrency, envTaskConcurrency } from './taskGate.js';

const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const ENGINE_CLI_PATH = path.resolve(process.cwd(), 'python', 'behavior_engine_cli.py');
const PYTHON_ENGINE_TIMEOUT_MS = envTaskConcurrency('QUIZZI_PYTHON_ENGINE_TIMEOUT_MS', 20_000);
const PYTHON_ENGINE_MAX_PAYLOAD_BYTES = envTaskConcurrency('QUIZZI_PYTHON_ENGINE_MAX_PAYLOAD_BYTES', 512_000);
const pythonEngineGate = createBoundedTaskGate({
  name: 'python-engine',
  concurrency: envTaskConcurrency('QUIZZI_PYTHON_ENGINE_CONCURRENCY', Math.max(2, defaultTaskConcurrency(2))),
  maxQueue: envTaskConcurrency('QUIZZI_PYTHON_ENGINE_MAX_QUEUE', 128),
});

export function runPythonEngine<T>(command: string, payload: unknown): Promise<T> {
  const serializedPayload = JSON.stringify(payload);
  if (Buffer.byteLength(serializedPayload, 'utf8') > PYTHON_ENGINE_MAX_PAYLOAD_BYTES) {
    return Promise.reject(new Error(`Python engine payload is too large for command "${command}".`));
  }

  return pythonEngineGate.run<T>(command, () =>
    new Promise((resolve, reject) => {
      const child = spawn(PYTHON_BIN, [ENGINE_CLI_PATH, command], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        callback();
      };

      const timeoutId = setTimeout(() => {
        child.kill('SIGKILL');
        finish(() => {
          reject(new Error(`Python engine timed out after ${PYTHON_ENGINE_TIMEOUT_MS}ms for "${command}".`));
        });
      }, PYTHON_ENGINE_TIMEOUT_MS);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        finish(() => reject(error));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          finish(() => reject(new Error(stderr.trim() || stdout.trim() || `Python engine exited with code ${code}`)));
          return;
        }

        finish(() => {
          try {
            resolve(JSON.parse(stdout) as T);
          } catch (error) {
            reject(
              new Error(
                `Python engine returned invalid JSON: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              ),
            );
          }
        });
      });

      child.stdin.write(serializedPayload);
      child.stdin.end();
    }),
  );
}
