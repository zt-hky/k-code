// Captured from omp 18.13.3 (`omp acp`, haiku subagents): an async `task` batch of SleepA/SleepB where SleepA is stopped
// through the stop extension while SleepB runs on. Progress entries are trimmed to the fields T3 reads.
export const OMP_ASYNC_BATCH_FRAMES = [
  {
    sessionUpdate: "tool_call",
    toolCallId: "toolu_017XR1E1mYjsN7QQkJXkyBFz",
    name: "task",
    title: "Spawning two concurrent bash sleeps",
    kind: "other",
    status: "pending",
    rawInput: {
      context:
        "# Goal\nSpawn two background bash commands with different sleep durations, observe completion order.",
      tasks: [
        {
          name: "SleepA",
          agent: "task",
          task: "Run bash: sleep 90 && echo a",
          solutionSpace: "straightforward bash execution",
        },
        {
          name: "SleepB",
          agent: "task",
          task: "Run bash: sleep 25 && echo b",
          solutionSpace: "straightforward bash execution",
        },
      ],
    },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "toolu_017XR1E1mYjsN7QQkJXkyBFz",
    status: "in_progress",
    rawOutput: {
      content: [
        {
          type: "text",
          text: "Running agent SleepA...",
        },
      ],
      details: {
        projectAgentsDir: null,
        results: [],
        totalDurationMs: 0,
        progress: [
          {
            id: "SleepA",
            index: 0,
            agent: "task",
            status: "pending",
            resolvedModel: "anthropic/claude-sonnet-5-5:medium",
            resolvedThinkingLevel: "medium",
            tokens: 0,
            toolCount: 0,
            requests: 0,
            cost: 0,
            contextWindow: 1000000,
            durationMs: 0,
          },
          {
            id: "SleepB",
            index: 1,
            agent: "task",
            status: "pending",
            tokens: 0,
            toolCount: 0,
            requests: 0,
            cost: 0,
            durationMs: 0,
          },
        ],
        async: {
          state: "running",
          jobId: "SleepA",
          type: "task",
        },
      },
    },
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: "Running agent SleepA...",
        },
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "toolu_017XR1E1mYjsN7QQkJXkyBFz",
    status: "in_progress",
    rawOutput: {
      content: [
        {
          type: "text",
          text: "Running background task SleepA...",
        },
      ],
      details: {
        projectAgentsDir: null,
        results: [],
        totalDurationMs: 0,
        progress: [
          {
            id: "SleepA",
            index: 0,
            agent: "task",
            status: "running",
            resolvedModel: "anthropic/claude-sonnet-5-5:medium",
            resolvedThinkingLevel: "medium",
            tokens: 0,
            toolCount: 0,
            requests: 0,
            cost: 0,
            contextWindow: 1000000,
            durationMs: 0,
          },
          {
            id: "SleepB",
            index: 1,
            agent: "task",
            status: "pending",
            resolvedModel: "anthropic/claude-sonnet-5-5:medium",
            resolvedThinkingLevel: "medium",
            tokens: 0,
            toolCount: 0,
            requests: 0,
            cost: 0,
            contextWindow: 1000000,
            durationMs: 0,
          },
        ],
        async: {
          state: "running",
          jobId: "SleepA",
          type: "task",
        },
      },
    },
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: "Running background task SleepA...",
        },
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "toolu_017XR1E1mYjsN7QQkJXkyBFz",
    status: "in_progress",
    rawOutput: {
      content: [
        {
          type: "text",
          text: "Running background task SleepB...",
        },
      ],
      details: {
        projectAgentsDir: null,
        results: [],
        totalDurationMs: 0,
        progress: [
          {
            id: "SleepA",
            index: 0,
            agent: "task",
            status: "running",
            resolvedModel: "anthropic/claude-sonnet-5-5:medium",
            resolvedThinkingLevel: "medium",
            tokens: 0,
            toolCount: 0,
            requests: 0,
            cost: 0,
            contextWindow: 1000000,
            durationMs: 0,
          },
          {
            id: "SleepB",
            index: 1,
            agent: "task",
            status: "running",
            resolvedModel: "anthropic/claude-sonnet-5-5:medium",
            resolvedThinkingLevel: "medium",
            tokens: 0,
            toolCount: 0,
            requests: 0,
            cost: 0,
            contextWindow: 1000000,
            durationMs: 0,
          },
        ],
        async: {
          state: "running",
          jobId: "SleepA",
          type: "task",
        },
      },
    },
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: "Running background task SleepB...",
        },
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "toolu_017XR1E1mYjsN7QQkJXkyBFz",
    status: "completed",
    rawOutput: {
      content: [
        {
          type: "text",
          text: "Spawned 2 background agents using task.\n- `SleepA` (job `SleepA`)\n- `SleepB` (job `SleepB`)",
        },
      ],
      details: {
        projectAgentsDir: null,
        results: [],
        totalDurationMs: 0,
        progress: [
          {
            id: "SleepA",
            index: 0,
            agent: "task",
            status: "pending",
            resolvedModel: "anthropic/claude-sonnet-5-5:medium",
            resolvedThinkingLevel: "medium",
            tokens: 0,
            toolCount: 0,
            requests: 0,
            cost: 0,
            contextWindow: 1000000,
            durationMs: 0,
          },
          {
            id: "SleepB",
            index: 1,
            agent: "task",
            status: "pending",
            resolvedModel: "anthropic/claude-sonnet-5-5:medium",
            resolvedThinkingLevel: "medium",
            tokens: 0,
            toolCount: 0,
            requests: 0,
            cost: 0,
            contextWindow: 1000000,
            durationMs: 0,
          },
        ],
        async: {
          state: "running",
          jobId: "SleepA",
          type: "task",
        },
      },
    },
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: "Spawned 2 background agents using task.\n- `SleepA` (job `SleepA`)\n- `SleepB` (job `SleepB`)",
        },
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "toolu_017XR1E1mYjsN7QQkJXkyBFz",
    status: "in_progress",
    rawOutput: {
      content: [
        {
          type: "text",
          text: "Running agent SleepB...",
        },
      ],
      details: {
        projectAgentsDir: null,
        results: [],
        totalDurationMs: 64,
        progress: [
          {
            id: "SleepA",
            index: 0,
            agent: "task",
            status: "running",
            resolvedModel: "anthropic/claude-sonnet-5-5:medium",
            resolvedThinkingLevel: "medium",
            tokens: 0,
            toolCount: 0,
            requests: 0,
            cost: 0,
            contextWindow: 1000000,
            durationMs: 0,
          },
          {
            id: "SleepB",
            index: 1,
            agent: "task",
            status: "running",
            resolvedModel: "anthropic/claude-sonnet-5-5:medium",
            resolvedThinkingLevel: "medium",
            tokens: 0,
            toolCount: 0,
            requests: 0,
            cost: 0,
            contextWindow: 1000000,
            durationMs: 0,
          },
        ],
        async: {
          state: "running",
          jobId: "SleepA",
          type: "task",
        },
      },
    },
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: "Running agent SleepB...",
        },
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "toolu_017XR1E1mYjsN7QQkJXkyBFz",
    status: "in_progress",
    rawOutput: {
      content: [
        {
          type: "text",
          text: "Background task SleepB complete.",
        },
      ],
      details: {
        projectAgentsDir: null,
        results: [],
        totalDurationMs: 28747,
        progress: [
          {
            id: "SleepA",
            index: 0,
            agent: "task",
            status: "running",
            resolvedModel: "anthropic/claude-sonnet-5-5:medium",
            resolvedThinkingLevel: "medium",
            tokens: 1950,
            toolCount: 2,
            requests: 3,
            cost: 0.010999,
            lastIntent: "Running sleep 90",
            contextTokens: 12525,
            contextWindow: 1000000,
            durationMs: 0,
          },
          {
            id: "SleepB",
            index: 1,
            agent: "task",
            status: "completed",
            resolvedModel: "anthropic/claude-sonnet-5-5:medium",
            resolvedThinkingLevel: "medium",
            tokens: 2108,
            toolCount: 2,
            requests: 3,
            cost: 0.013255500000000002,
            lastIntent: "Running sleep command",
            contextTokens: 12679,
            contextWindow: 1000000,
            durationMs: 28870,
          },
        ],
        async: {
          state: "running",
          jobId: "SleepA",
          type: "task",
        },
      },
    },
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: "Background task SleepB complete.",
        },
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "toolu_017XR1E1mYjsN7QQkJXkyBFz",
    status: "failed",
    rawOutput: {
      content: [
        {
          type: "text",
          text: "Background task SleepA failed.",
        },
      ],
      details: {
        projectAgentsDir: null,
        results: [],
        totalDurationMs: 92058,
        progress: [
          {
            id: "SleepA",
            index: 0,
            agent: "task",
            status: "aborted",
            resolvedModel: "anthropic/claude-sonnet-5-5:medium",
            resolvedThinkingLevel: "medium",
            tokens: 1950,
            toolCount: 2,
            requests: 3,
            cost: 0.010999,
            lastIntent: "Running sleep 90",
            contextTokens: 12525,
            contextWindow: 1000000,
            durationMs: 92489,
          },
          {
            id: "SleepB",
            index: 1,
            agent: "task",
            status: "completed",
            resolvedModel: "anthropic/claude-sonnet-5-5:medium",
            resolvedThinkingLevel: "medium",
            tokens: 2108,
            toolCount: 2,
            requests: 3,
            cost: 0.013255500000000002,
            lastIntent: "Running sleep command",
            contextTokens: 12679,
            contextWindow: 1000000,
            durationMs: 28870,
          },
        ],
        async: {
          state: "failed",
          jobId: "SleepA",
          type: "task",
        },
      },
    },
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: "Background task SleepA failed.",
        },
      },
    ],
  },
] as const;
