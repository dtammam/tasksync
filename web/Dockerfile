FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY web/package*.json ./web/
RUN cd web && npm ci

COPY web ./web
COPY shared ./shared

WORKDIR /app/web
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app

COPY --from=build /app/web ./web
COPY --from=build /app/shared ./shared

WORKDIR /app/web
ENV VITE_API_URL=
ENV VITE_ALLOWED_HOSTS=
ENV NODE_ENV=production
EXPOSE 5173

CMD ["sh","-c","mkdir -p /app/web/.svelte-kit/output/client /app/web/dist && node -e \"const fs=require('fs');const cfg={apiUrl:process.env.VITE_API_URL||''};const body='window.__TASKSYNC_RUNTIME_CONFIG__='+JSON.stringify(cfg)+';\\\\n';for (const file of ['/app/web/.svelte-kit/output/client/runtime-config.js','/app/web/dist/runtime-config.js']) { fs.writeFileSync(file, body); }\" && npm run preview -- --host 0.0.0.0 --port 5173"]

