# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY runner/package.json ./runner/package.json
RUN npm ci --workspace @pedrobef/navebox-runner --include-workspace-root=false
COPY runner ./runner
RUN npm --workspace @pedrobef/navebox-runner run build

FROM node:20-alpine AS production
RUN apk add --no-cache docker-cli dumb-init && addgroup -S navebox && adduser -S navebox -G navebox
WORKDIR /app
COPY package.json package-lock.json ./
COPY runner/package.json ./runner/package.json
RUN npm ci --omit=dev --workspace @pedrobef/navebox-runner --include-workspace-root=false \
  && npm cache clean --force
COPY --from=build /app/runner/lib ./runner/lib
RUN mkdir -p /data && chown -R navebox:navebox /app /data
USER navebox
ENV NODE_ENV=production NAVEBOX_DATA_DIR=/data NAVEBOX_LOCAL_ARTIFACTS=/data/artifacts
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "runner/lib/index.js"]
