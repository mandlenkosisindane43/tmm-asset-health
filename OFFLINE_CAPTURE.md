# Offline capture pilot

Open `/offline-capture` once while connected. The service worker saves the capture screen and its app assets. Production shifts and breakdowns then save in IndexedDB on that device. The operator can see the pending count and sync explicitly after reconnecting and signing in as the software owner.

The sync endpoint uses a client UUID receipt and an atomic D1 batch so a retry cannot insert the same record twice. A failed or expired-session sync leaves remaining records on the device. Avoid clearing site data before sync, and keep shared devices locked: local records are stored in plaintext in the browser profile.

This first stage covers capture only. It does not provide offline dashboards, cross-device sharing, attachments, email, AI, or offline licence checks. Company choices load while connected, and each saved record retains its company ID. The sync endpoint requires the software owner session and checks that the company still exists. User roles, company membership, and mine-specific deployment must be completed before a multi-user pilot.
