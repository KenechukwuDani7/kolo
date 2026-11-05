#!/bin/bash
# Kolo on the Oracle server: three always-on services plus Caddy for HTTPS.
set -e
IP_DASHED=${IP_DASHED:?set IP_DASHED to the server IP with dashes, e.g. 84-12-109-77}
WALLET_HOST="wallet.$IP_DASHED.sslip.io"
KOLO_HOST="kolo.$IP_DASHED.sslip.io"
NPX=$(command -v npx)
NPM=$(command -v npm)

sudo tee /etc/systemd/system/kolo-fork.service >/dev/null <<EOF
[Unit]
Description=Kolo local Base Sepolia fork (Hardhat)
After=network-online.target
Wants=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/kolo/wallet
ExecStart=$NPX hardhat --config hardhat.config.cjs node
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/kolo-wallet.service >/dev/null <<EOF
[Unit]
Description=Kolo wallet sign-up page
After=kolo-fork.service
Requires=kolo-fork.service

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/kolo/wallet
Environment=PORT=3116
Environment=KOLO_BOT_URL=http://localhost:3117
ExecStartPre=/bin/sleep 8
ExecStart=$NPM run serve
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/kolo-bot.service >/dev/null <<EOF
[Unit]
Description=Kolo WhatsApp bot
After=network-online.target kolo-wallet.service
Wants=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/kolo/bot
Environment=QR_PORT=3117
Environment="KOLO_GROUPS=Kolo Test"
Environment=TEST_OWN_MESSAGES=1
Environment=JOIN_URL=https://$WALLET_HOST
Environment=WALLET_URL=http://localhost:3116
# Roqqu's sandbox stopped making payment links and blocks cloud servers, so pay links
# use Kolo's own test checkout at KOLO_URL/pay/... (set ROQQU_MODE=live to use Roqqu).
Environment=ROQQU_MODE=simulate
Environment=KOLO_URL=https://$KOLO_HOST
ExecStart=$NPM run whatsapp
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$WALLET_HOST {
	reverse_proxy localhost:3116
}

$KOLO_HOST {
	reverse_proxy localhost:3117
}
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now kolo-fork kolo-wallet
sudo systemctl reload caddy || sudo systemctl restart caddy
echo "services: fork=$(systemctl is-active kolo-fork) wallet=$(systemctl is-active kolo-wallet) caddy=$(systemctl is-active caddy)"
