FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Pre-gzip mesh files + WASM for static serving (better compression than on-the-fly)
RUN find /usr/share/nginx/html/mujoco -name "*.obj" -o -name "*.stl" | \
    xargs -I{} sh -c 'gzip -9 -k "{}"'
RUN gzip -9 -k /usr/share/nginx/html/vendor/mujoco/mujoco_wasm.js || true

EXPOSE 80
