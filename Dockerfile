FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm config set legacy-peer-deps true && npm config set unsafe-perm true && npm config set engine-strict false && npm install --production

COPY . .

RUN npm run build && npm prune --omit=dev

EXPOSE 1337

CMD ["npm", "run", "start"]
