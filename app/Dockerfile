FROM node:22-alpine

# Postfix fuer direkten Mailversand (wie bei der Website)
RUN apk add --no-cache postfix \
    && postconf -e "myhostname = faecherlofts.de" \
    && postconf -e "mydomain = faecherlofts.de" \
    && postconf -e "myorigin = faecherlofts.de" \
    && postconf -e "inet_interfaces = loopback-only" \
    && postconf -e "mydestination = " \
    && postconf -e "relay_domains = " \
    && postconf -e "smtp_tls_security_level = may"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

# Postfix starten, dann Node
CMD postfix start && node server.js
