FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install --production

# Copy rest of the code
COPY . .

# Expose the port your server listens on (e.g., 3000)
EXPOSE 3000

# Start the server
CMD ["node", "server.mjs"]
