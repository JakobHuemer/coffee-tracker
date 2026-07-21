# Coffee Tracker API — runs on Bun (required for bun:sqlite).
FROM oven/bun:1

WORKDIR /app

# Install deps first for better layer caching
COPY package.json ./
RUN bun install

# App source
COPY . .

# The app reads process.env.PORT (falls back to 3001)
EXPOSE 3001

CMD ["bun", "src/index.js"]
