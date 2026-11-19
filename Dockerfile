FROM node:22-bookworm

RUN apt-get update && apt-get install -y \
    xvfb \
    openbox \
    tint2 \
    pcmanfm \
    xfce4-terminal \
    mousepad \
    galculator \
    chromium \
    xdotool \
    scrot \
    ffmpeg \
    dbus-x11 \
    adwaita-icon-theme \
    x11-utils \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --legacy-peer-deps

COPY . .

RUN npm run build

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["npx", "tsx", "server.ts"]
