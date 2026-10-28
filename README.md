# Bingwa Sokoni — Fresh Rebuild

Fresh codebase for the Bingwa Sokoni offers catalog.

## Security

* Keep Neon connection strings and Safaricom Daraja credentials in encrypted, server-side hosting environment variables.
* Never commit real credentials or expose them in browser code.
* Do not store payment secrets in ordinary database tables.

## Deployment plan

1. Build and verify the responsive offers catalog.
2. Connect the existing Neon `bingwahybrid` project and `main` branch without deleting or resetting data.
3. Configure Daraja credentials securely in the new Vercel project.
4. Implement and test server-side STK push, callback verification, idempotency, and transaction reconciliation.
5. Verify the production deployment before enabling real-money payments.

**Current status:** Initial repository setup. Production payment processing is not yet ready.
