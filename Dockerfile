FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --production --legacy-peer-deps --engine-strict=false --unsafe-perm

COPY . .

RUN npm run build && npm prune --omit=dev

EXPOSE $PORT

CMD ["npm", "run", "start"]
