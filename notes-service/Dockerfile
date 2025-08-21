FROM node:18-alpine

WORKDIR /app

#package files and install dependencies
COPY package*.json ./
RUN npm ci


COPY . .

EXPOSE 3002


CMD ["node", "index.js"]