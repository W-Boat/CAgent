# ---------- 构建 ----------
FROM node:20-alpine AS build
WORKDIR /app

# 先装依赖（利用层缓存）
RUN apk add --no-cache openssl
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/api/tsconfig.build.json ./apps/api/tsconfig.build.json
WORKDIR /app/apps/api
RUN npm install --no-audit --no-fund

# 再编译
WORKDIR /app
COPY apps/api/prisma ./apps/api/prisma
WORKDIR /app/apps/api
RUN npx prisma generate
WORKDIR /app
COPY apps/api/src ./apps/api/src
# 运维脚本（校园导览导入等）
COPY apps/api/scripts ./apps/api/scripts
WORKDIR /app/apps/api
RUN npm run build

# ---------- 运行 ----------
# Dedicated timetable browser: shared Chromium process, isolated temporary contexts,
# at most two sessions. No persistent school credentials or public screenshots.
FROM node:20-alpine
WORKDIR /app/apps/api
RUN apk add --no-cache openssl chromium nss freetype harfbuzz ca-certificates font-noto-cjk
ENV NODE_ENV=production

COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/apps/api/scripts ./scripts
COPY --from=build /app/apps/api/package.json ./package.json

# 迁移在启动时执行；seed 与校园导览导入按需手动执行：
#   docker exec cagent-api node dist/prisma/seed.js
#   docker exec cagent-api node scripts/import-campus-guide.mjs <json>
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
