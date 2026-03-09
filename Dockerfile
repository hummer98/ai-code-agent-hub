FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY src/ src/
COPY tsconfig.json ./
RUN npx tsc

FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm install -g opencode-ai@latest
COPY --from=builder /app/dist dist/

# OpenCode global config (OpenRouter provider)
RUN mkdir -p /root/.config/opencode && \
    echo '{"$schema":"https://opencode.ai/config.json","provider":{"openrouter":{"models":{"anthropic/claude-sonnet-4":{}}}}}' \
    > /root/.config/opencode/config.json

EXPOSE 3000
EXPOSE 4097-4200

CMD ["node", "dist/index.js"]
