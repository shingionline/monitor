#!/bin/bash

# 1. Basic Info & Custom Formatted Date + Timezone
HOSTNAME=$(hostname)
UPTIME=$(uptime -p)
READABLE_TIME=$(date "+%d %B %Y %H:%M %Z")
TIMEZONE=$(date "+%Z %z")
OS=$(grep 'PRETTY_NAME' /etc/os-release | cut -d'"' -f2)

# 2. CPU & Load
LOAD_1=$(cat /proc/loadavg | awk '{print $1}')
LOAD_5=$(cat /proc/loadavg | awk '{print $2}')
LOAD_15=$(cat /proc/loadavg | awk '{print $3}')
CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print 100 - $8}')

# 3. RAM Usage (Calculated for percentage)
RAM_TOTAL=$(free -m | awk '/Mem:/ {print $2}')
RAM_USED=$(free -m | awk '/Mem:/ {print $3}')
RAM_FREE=$(free -m | awk '/Mem:/ {print $4}')
RAM_AVAILABLE=$(free -m | awk '/Mem:/ {print $7}')
# Calculate percentage using awk for floating point precision
RAM_USED_PERCENT=$(free -m | awk '/Mem:/ {printf "%.1f", $3/$2*100}')

# 4. Disk Usage (Explicit naming)
DISK_TOTAL_GB=$(df -m / | awk 'NR==2 {printf "%.1f", $2/1024}')
DISK_USED_GB=$(df -m / | awk 'NR==2 {printf "%.1f", $3/1024}')
DISK_USED_PERCENT=$(df / | awk 'NR==2 {print $5}' | tr -d '%')

# 5. Top Processes
TOP_PROCESSES_CPU=$(ps -eo comm,%cpu,%mem --sort=-%cpu | head -n 6 | tail -n 5 | awk 'BEGIN{first=1} {if($2 ~ /^[0-9\.]+$/ && $3 ~ /^[0-9\.]+$/) {if(!first) printf ","; printf "{\"name\":\"%s\",\"cpu\":%s,\"mem\":%s}", $1, $2, $3; first=0}}')
TOP_PROCESSES_RAM=$(ps -eo comm,%cpu,%mem --sort=-%mem | head -n 6 | tail -n 5 | awk 'BEGIN{first=1} {if($2 ~ /^[0-9\.]+$/ && $3 ~ /^[0-9\.]+$/) {if(!first) printf ","; printf "{\"name\":\"%s\",\"cpu\":%s,\"mem\":%s}", $1, $2, $3; first=0}}')

# 6. Service Status
HTTP_STATUS=$(systemctl is-active apache2 2>/dev/null | head -n 1 || echo "inactive")

# --- CONSTRUCT THE JSON PAYLOAD ---
JSON_PAYLOAD=$(cat <<EOF
{
  "metadata": {
    "hostname": "$HOSTNAME",
    "os": "$OS",
    "uptime": "$UPTIME",
    "reported_at": "$READABLE_TIME",
    "timezone": "$TIMEZONE"
  },
  "cpu": {
    "usage_percent": $CPU_USAGE,
    "load_1": $LOAD_1,
    "load_5": $LOAD_5,
    "load_15": $LOAD_15
  },
  "memory": {
    "used_percent": $RAM_USED_PERCENT,
    "total_mb": $RAM_TOTAL,
    "used_mb": $RAM_USED,
    "available_mb": $RAM_AVAILABLE
  },
  "disk": {
    "used_percent": $DISK_USED_PERCENT,
    "total_gb": $DISK_TOTAL_GB,
    "used_gb": $DISK_USED_GB
  },
  "services": {
    "apache": "$HTTP_STATUS"
  },
  "top_processes_cpu": [$TOP_PROCESSES_CPU],
  "top_processes_memory": [$TOP_PROCESSES_RAM]
}
EOF
)

echo "$JSON_PAYLOAD" | jq --indent 2 . 2>/dev/null || echo "$JSON_PAYLOAD" | python3 -m json.tool 2>/dev/null || echo "$JSON_PAYLOAD"
