FROM oven/bun:1.3.10-alpine

WORKDIR /app
COPY package.json ./
COPY src/ src/

EXPOSE 1900/udp
CMD ["bun", "run", "src/index.ts"]
