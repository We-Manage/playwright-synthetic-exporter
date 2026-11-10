# The Playwright image brings Node, Chromium and its libraries. Its version
# has to match @playwright/test in package.json; Renovate updates both together.
FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d

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
