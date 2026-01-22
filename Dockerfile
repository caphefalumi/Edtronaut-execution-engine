# use the official Bun image
FROM oven/bun:1.1.26

WORKDIR /app

# Install Python3 for code execution
RUN apt-get update && apt-get install -y python3 && rm -rf /var/lib/apt/lists/*

# install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# copy source code
COPY . .

# expose port
EXPOSE 1409

# start the app
CMD ["bun", "run", "src/index.ts"]