#!/usr/bin/env bash
if [ -z "${BASH_VERSION-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi

set -euo pipefail

# inst_systemd.sh - installer placed under scripts/
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MAIL_UNIT_NAME="nexoramail-core.service"
API_UNIT_NAME="nexoramail-api.service"
TARGET_UNIT_NAME="nexoramail.service"
MAIL_UNIT_PATH="/etc/systemd/system/${MAIL_UNIT_NAME}"
API_UNIT_PATH="/etc/systemd/system/${API_UNIT_NAME}"
TARGET_UNIT_PATH="/etc/systemd/system/${TARGET_UNIT_NAME}"

echo "NexoraMail systemd installer"
echo "Project dir: ${WORKDIR}"

if [ "$(id -u)" -ne 0 ]; then
  echo "This script needs to write to /etc/systemd/system and control systemd."
  echo "Please run as root or via sudo: sudo ${SCRIPT_DIR}/inst_systemd.sh"
  exit 1
fi

backup_unit_if_exists() {
  local unit_path="$1"
  if [ -f "${unit_path}" ]; then
    local ts
    ts=$(date +%s)
    echo "Backing up existing unit to ${unit_path}.bak.${ts}"
    cp -a "${unit_path}" "${unit_path}.bak.${ts}"
  fi
}

backup_unit_if_exists "${MAIL_UNIT_PATH}"
backup_unit_if_exists "${API_UNIT_PATH}"
backup_unit_if_exists "${TARGET_UNIT_PATH}"

echo "Writing systemd unit: ${MAIL_UNIT_NAME}"
cat > /tmp/${MAIL_UNIT_NAME} <<EOF
[Unit]
Description=NexoraMail Core (SMTP/POP3/IMAP)
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${WORKDIR}
ExecStart=/usr/bin/python3 ${WORKDIR}/wMailServer.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
User=root

[Install]
WantedBy=multi-user.target
EOF

echo "Writing systemd unit: ${API_UNIT_NAME}"
cat > /tmp/${API_UNIT_NAME} <<EOF
[Unit]
Description=NexoraMail API Service
After=network.target network-online.target ${MAIL_UNIT_NAME}
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${WORKDIR}
ExecStart=/usr/bin/python3 ${WORKDIR}/NexoraMailAPI.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
User=root

[Install]
WantedBy=multi-user.target
EOF

echo "Writing systemd unit: ${TARGET_UNIT_NAME}"
cat > /tmp/${TARGET_UNIT_NAME} <<EOF
[Unit]
Description=NexoraMail (Core + API)
Requires=${MAIL_UNIT_NAME} ${API_UNIT_NAME}
After=${MAIL_UNIT_NAME} ${API_UNIT_NAME}

[Install]
WantedBy=multi-user.target
EOF

mv /tmp/${MAIL_UNIT_NAME} "${MAIL_UNIT_PATH}"
mv /tmp/${API_UNIT_NAME} "${API_UNIT_PATH}"
mv /tmp/${TARGET_UNIT_NAME} "${TARGET_UNIT_PATH}"
chmod 644 "${MAIL_UNIT_PATH}" "${API_UNIT_PATH}" "${TARGET_UNIT_PATH}"

echo "Reloading systemd and enabling service"
systemctl daemon-reload
systemctl enable --now "${MAIL_UNIT_NAME}" "${API_UNIT_NAME}" "${TARGET_UNIT_NAME}"

echo "Services enabled and started (if no error)."
echo "Status (${TARGET_UNIT_NAME}):"
systemctl status "${TARGET_UNIT_NAME}" --no-pager || true
echo
echo "Status (${MAIL_UNIT_NAME}):"
systemctl status "${MAIL_UNIT_NAME}" --no-pager || true
echo
echo "Status (${API_UNIT_NAME}):"
systemctl status "${API_UNIT_NAME}" --no-pager || true

echo
echo "To follow logs:"
echo "  journalctl -u ${MAIL_UNIT_NAME} -f"
echo "  journalctl -u ${API_UNIT_NAME} -f"
echo "If you need to remove units:"
echo "  sudo systemctl disable --now ${TARGET_UNIT_NAME} ${MAIL_UNIT_NAME} ${API_UNIT_NAME}"
echo "  sudo rm ${TARGET_UNIT_PATH} ${MAIL_UNIT_PATH} ${API_UNIT_PATH}"
echo "  sudo systemctl daemon-reload"

exit 0
