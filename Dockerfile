# The Playwright image brings Node, Chromium and its libraries. Its version
# has to match @playwright/test in package.json; Renovate updates both together.
FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579

ENV NODE_ENV=production \
    PSE_CONFIG=/app/checks/checks.yml \
    PSE_DATA_DIR=/data \
    PSE_LISTEN=:9470

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY tsconfig.json ./
COPY src/ src/
# The example checks, so the image runs out of the box; mount your own
# directory over /app/checks. It has to stay below /app for the imports.
COPY examples/checks/ checks/
RUN mkdir -p /data && chown pwuser:pwuser /data

USER pwuser
EXPOSE 9470
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s CMD ["node", "-e", "fetch('http://127.0.0.1:9470/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["node", "/app/src/runner.mjs"]
