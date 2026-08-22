FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Install dependencies (use cached layer when package files don't change).
# We keep devDependencies (typescript, tsx, prisma CLI) so the build step has
# what it needs. The runtime image is already large (Playwright base), so
# pruning is not worth the extra Dockerfile stages here.
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install --ignore-scripts \
    && npx prisma generate

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Storage volume mount point
RUN mkdir -p /data/storage

ENV STORAGE_DIR=/data/storage
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && node dist/index.js"]
