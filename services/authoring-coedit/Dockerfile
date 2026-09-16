# Co-editing service image.
#
# Build context is the REPOSITORY ROOT, not this directory:
#
#   docker build -f services/authoring-coedit/Dockerfile -t authoring-coedit .
#
# Dependencies are installed ONCE at the repository root, not inside this
# directory. The service imports the shared, DOM-free rich-text schema straight
# out of src/features/exam-authoring/editor, and that schema imports ProseMirror
# through the root tree. A second install under services/authoring-coedit would
# load two prosemirror-model instances, and y-prosemirror would then reject
# every node it is handed ("looks like multiple versions of prosemirror-model
# were loaded"). One dependency tree is a correctness requirement here.
FROM oven/bun:1-slim AS runtime

WORKDIR /srv
ENV NODE_ENV=production \
    AUTHORING_COEDIT_PORT=1235

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY services/authoring-coedit/tsconfig.json ./services/authoring-coedit/
COPY services/authoring-coedit/src ./services/authoring-coedit/src
COPY src/features/exam-authoring/editor/schema ./src/features/exam-authoring/editor/schema
COPY src/features/exam-authoring/editor/richContent.ts src/features/exam-authoring/editor/richContentIdentity.ts ./src/features/exam-authoring/editor/
COPY src/features/exam-authoring/contracts ./src/features/exam-authoring/contracts
# The ONE workspace-command envelope. The service validates the frames it
# relays with the same module the browser provider parses them with, so a
# command cannot be acceptable at one end and rejected at the other. That file
# must therefore exist in this image; it is dependency-free by construction.
COPY src/features/exam-authoring/realtime/coedit/workspaceCommands.ts ./src/features/exam-authoring/realtime/coedit/
COPY src/features/exam-authoring/realtime/coedit/workspaceSeed.ts ./src/features/exam-authoring/realtime/coedit/
# Durable epoch/cache metadata is dependency-free, but it validates the same
# opaque room names as the browser contract, so its small identity dependency
# travels with it into the image as well.
COPY src/features/exam-authoring/realtime/coedit/protocol.ts src/features/exam-authoring/realtime/coedit/documentIdentity.ts ./src/features/exam-authoring/realtime/coedit/

EXPOSE 1235

# Readiness, not liveness: /readyz is false until the singleton lock is held, so
# an orchestrator never routes traffic to a process that would not serve rooms.
# Deploy stop-before-start: a replacement process waits for the lock and exits
# non-zero rather than serving a second set of rooms.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.AUTHORING_COEDIT_PORT || 1235) + '/readyz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "services/authoring-coedit/src/main.ts"]
