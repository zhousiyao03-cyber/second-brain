#!/usr/bin/env bash
set -euo pipefail

SWAP_GB="${1:-4}"

if ! [[ "$SWAP_GB" =~ ^[0-9]+$ ]] || [ "$SWAP_GB" -lt 1 ]; then
  echo "swap size must be a positive integer in GB" >&2
  exit 1
fi

if ! swapon --show | grep -q '^/swapfile '; then
  rm -f /swapfile
  if ! fallocate -l "${SWAP_GB}G" /swapfile 2>/dev/null; then
    dd if=/dev/zero of=/swapfile bs=1G count="$SWAP_GB" status=progress
  fi
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi

if ! grep -q '^/swapfile ' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates cron curl git rsync ufw docker.io

if ! apt-get install -y docker-compose-v2; then
  apt-get install -y docker-compose-plugin
fi

systemctl enable --now docker
systemctl enable --now cron

cat >/etc/sysctl.d/99-knosi.conf <<'EOF'
vm.overcommit_memory = 1
EOF
sysctl --system >/dev/null

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

install -d -m 755 /srv/knosi
install -d -m 755 /srv/knosi/runtime

echo "bootstrap complete"
