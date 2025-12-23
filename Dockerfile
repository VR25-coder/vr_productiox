# Dockerfile for vr-portfolio (Node/Express)
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the app
COPY . .

ENV NODE_ENV=production
EXPOSE 3002

CMD ["npm", "start"]
