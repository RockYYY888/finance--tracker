FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=
ARG VITE_ENABLE_PWA=true

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
	VITE_ENABLE_PWA=${VITE_ENABLE_PWA}

RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
