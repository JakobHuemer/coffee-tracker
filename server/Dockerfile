# Coffee Tracker API — runs on Bun (required for bun:sqlite).
# Railway service Root Directory should be set to "server".
FROM oven/bun:1

WORKDIR /app

# Install deps first for better layer caching
COPY package.json ./
RUN bun install

# App source
COPY . .

# Railway injects PORT; the app reads process.env.PORT (falls back to 3001)
EXPOSE 3001

CMD ["bun", "src/index.js"]
