FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /workspace

# Install k6
RUN apt-get update \
  && apt-get install -y --no-install-recommends gnupg ca-certificates curl \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://dl.k6.io/key.gpg | gpg --dearmor -o /etc/apt/keyrings/k6-archive-keyring.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" > /etc/apt/sources.list.d/k6.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends k6 \
  && rm -rf /var/lib/apt/lists/*

# Bun is the package manager; Node (from the Playwright base image) remains the runtime.
COPY --from=oven/bun:1.3.14-debian /usr/local/bin/bun /usr/local/bin/bun

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3366

EXPOSE 3366

CMD ["bun", "run", "e2e:leapcell-ui"]
