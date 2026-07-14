# Multi-stage: build the Vite/React app, then serve the static output with
# nginx (which also reverse-proxies /api to the backend service -- see
# nginx.conf). No Node runtime in the final image.

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Sub-path mount point injected by the deploy host (e.g. "/crm-review-hub").
# vite.config.js reads it as `base`; empty -> builds for the root "/".
ARG VITE_BASE_PATH
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
