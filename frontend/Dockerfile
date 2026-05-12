FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173

# Expose Vite host
CMD ["npm", "run", "dev", "--", "--host"]
