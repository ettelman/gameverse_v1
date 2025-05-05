# Använd officiell Node.js LTS-bild
FROM node:18

# Ange arbetskatalog i containern
WORKDIR /usr/src/app

# Kopiera package-filer och installera beroenden
COPY package*.json ./
RUN npm install

# Kopiera resten av applikationen
COPY . .

# Exponera porten som appen lyssnar på
EXPOSE 3300

# Starta applikationen
CMD ["node", "server.js"]
