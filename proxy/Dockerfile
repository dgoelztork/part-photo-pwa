FROM node:20-slim
WORKDIR /app

# Install all deps (including devDeps for tsc build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Remove devDeps after build
RUN npm prune --production

EXPOSE 3001
CMD ["node", "dist/index.js"]
