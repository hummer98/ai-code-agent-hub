FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY src/ src/
COPY tsconfig.json ./
RUN npx tsc

FROM node:22-slim

RUN apt-get update && apt-get install -y git python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*

# Install Aider (default agent)
RUN python3 -m venv /opt/aider && /opt/aider/bin/pip install aider-chat
ENV PATH="/opt/aider/bin:$PATH"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist dist/

EXPOSE 3000
EXPOSE 4097-4200

CMD ["node", "dist/index.js"]
