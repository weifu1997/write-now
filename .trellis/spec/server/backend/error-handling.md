# Error Handling Guidelines

> Error classification, gate contracts, and recoverable waiting semantics for the backend director runtime.

---

## Scenario: Director Runtime Gate vs Fatal Failure

### 1. Scope / Trigger
- **Trigger**: Any background orchestration step that depends on asynchronous or out-of-band facts (such as chapter state commits, continuity snapshots, or external worker jobs) whose completion cannot be guaranteed within a synchronous execution window.
- **Problem Prevented**: Preventing temporary asynchronous lag from turning into unrecoverable `task.failed` statuses that stop an otherwise completed book or pipeline.

### 2. Signatures
- **Error Class**:
  ```typescript
  export class DirectorRuntimeGateError extends AppError {
    constructor(message: string) {
      super(message, 400, "DIRECTOR_RUNTIME_GATE_ERROR");
      this.name = "DirectorRuntimeGateError";
    }
  }
  export function isDirectorRuntimeGateError(error: unknown): boolean;
  ```
- **Projection Waiter Signature**:
  ```typescript
  private async waitForProjectionFacts(input: {
    module: WorkflowStepModuleDescriptor;
    taskId: string;
    novelId: string;
    targetId?: string | null;
  }): Promise<{ artifacts: DirectorArtifactRef[]; factsReady: boolean }>;
  ```

### 3. Contracts
- **Outer Scheduler Contract**:
  - If a background job throws `DirectorRuntimeGateError` or `WorkflowTaskCancelledError`, the scheduler catches and returns normally (no `markTaskFailed`).
  - Any plain `Error` reaching the scheduler causes `workflowService.markTaskFailed(taskId, message)`.
- **Projection Tail Gate Contract**:
  - `factsReady: false` on background fact-only modules (`BACKGROUND_ARTIFACT_PROJECTION_STEP_IDS`) must trigger a gate throw rather than proceeding to module execution.
  - The gate handler must call `stateCommitter.markRuntimeWaitingGate` and optionally `markTaskWaitingApproval` before throwing `DirectorRuntimeGateError`.

### 4. Validation & Error Matrix
| Scenario | Condition | Resulting Behavior | Task Status |
|----------|-----------|--------------------|-------------|
| Normal execution | Facts land within timeout | Execute module → commit artifacts | `running` → `completed` |
| Async lag timeout | Timeout expires, facts incomplete | Throw `DirectorRuntimeGateError` | `waiting_approval` (recoverable) |
| Hard execution defect | Module throws in runner/execute | Catch in runner → rethrow plain `Error` | `failed` (terminal) |
| User cancellation | Cancel token received | Throw `WorkflowTaskCancelledError` | `cancelled` |

### 5. Good/Base/Bad Cases
- **Good**: Tail node waits 120s; if facts arrive late, it transitions to `waiting_approval` with clear explanation (`"异步投影事实尚未落库，等待补齐后可续跑收口"`). User clicks "继续自动导演", facts are now present, and the node succeeds.
- **Base**: Tail node facts are ready immediately; loop runs without waiting or gating.
- **Bad**: Tail node times out waiting for projection facts, ignores the timeout, runs the fact-only validation, throws `"facts are not complete yet"`, and permanently fails an entire 150-chapter book run.

### 6. Tests Required
- **Timeout to Gate**:
  - Stub `inspectCompletion` to always return `completed: false` with small `projectionFactWaitTimeoutMs`.
  - Assert `runChapterExecutionNode` rejects with `isDirectorRuntimeGateError(e) === true`.
  - Assert `runtimeCalls` has no record of executing the tail node.
- **Gate Recovery**:
  - First run fails with gate error.
  - Set module state to `completed: true`.
  - Second run succeeds and produces expected artifacts.

### 7. Wrong vs Correct
#### Wrong
```typescript
// Ignores whether facts were actually ready; unconditionally executes.
const artifacts = await this.waitForProjectionFacts({ module: adapter, ... });
await this.runStepModule({ module: adapter, collectArtifacts: () => artifacts, ... });
// If facts were not ready, validateOutput throws a plain Error, causing markTaskFailed.
```

#### Correct
```typescript
const { artifacts, factsReady } = await this.waitForProjectionFacts({ module: adapter, ... });
if (!factsReady && isExecutableWorkflowStepModule(adapter) && BACKGROUND_ARTIFACT_PROJECTION_STEP_IDS.has(adapter.id)) {
  const recheck = await adapter.inspectCompletion(context).catch(() => null);
  if (!recheck?.completed) {
    const reason = `${adapter.id} 异步投影事实尚未落库，等待补齐后可续跑收口。`;
    await this.stateCommitter.markRuntimeWaitingGate({ taskId: input.taskId, novelId: input.novelId, message: reason });
    throw new DirectorRuntimeGateError(reason);
  }
}
await this.runStepModule({ module: adapter, collectArtifacts: () => artifacts, ... });
```
