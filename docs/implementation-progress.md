# Workspace continuity and local workflow implementation

Scope: implement the accepted browser-session continuity, remote preview, agent launch/status,
activity recap, handoffs, process resources, flight recorder/checkpoints, Git experiments,
and preview-to-task selection plan.

- [x] Persistent workspace registry and reconnectable terminals with bounded replay
- [x] Authenticated cross-device preview and opt-in element context capture
- [x] Local activity/history store, read positions, filtering and retention
- [x] Agent detection/launch and explicit attention signals
- [x] Handoff cards with restorable context
- [x] Owned process/resource and port controls
- [x] Git checkpoints and worktree experiments with comparison/merge/cleanup
- [x] Integrated UI, regression/integration/browser validation and documentation

Runtime scope: shell processes survive browser disconnects and workspace switches while
Yotram runs. Restarting the server ends those processes; durable history and workspace
metadata survive. AI summaries and agent-provider chat APIs are optional later extensions.

Verification: 90 backend tests, 44 frontend tests, nine Playwright browser scenarios,
production build, diff whitespace check, and rendered interface inspection all passed.
See README.md for operational limits and deferred optional extensions.
