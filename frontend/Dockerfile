# Multi-stage: build the Vite/React app, then serve the static output with
# nginx (which also reverse-proxies /api to the backend service -- see
# nginx.conf). No Node runtime in the final image.

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
