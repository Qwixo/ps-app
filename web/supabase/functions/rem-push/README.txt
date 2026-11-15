Reminders on the iPhone (1.60). Set up once per project, by its owner:
1. Apply migration 040_web_push.sql (the Mac's project setup does this with the others once ps-core.json lists it).
2. Make a VAPID key pair:  npx web-push generate-vapid-keys
3. Deploy this function (slug rem-push, verify_jwt off) and set its secrets VAPID_PRIVATE_KEY and VAPID_SUBJECT.
4. Put the PUBLIC key and your functions address into push-cron.sql and run it once (it needs pg_cron and pg_net).
Stored on the server: each phone's push address and two public keys, plus reminder ids with the time each should buzz.
Never stored: any reminder's words, title or colours.
