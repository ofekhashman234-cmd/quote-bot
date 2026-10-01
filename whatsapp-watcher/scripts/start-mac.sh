#!/bin/bash
# הפעלת הבוט על מק: caffeinate מונע מהמחשב להירדם כל עוד הבוט רץ
# (-i: חוסר פעילות, -s: כשמחובר לחשמל). סגירת המכסה עדיין מרדימה, ראה README.
cd "$(dirname "$0")/.." || exit 1
exec caffeinate -is node src/index.js
