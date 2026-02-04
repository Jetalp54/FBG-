# Cloudflare Domain Verification Feature

## Overview

The Firebase Manager now supports automated domain verification via Cloudflare! This feature allows you to:

- ✅ Automatically verify custom domains via DNS TXT records
- ✅ Configure domains across multiple Firebase projects
- ✅ Auto-setup email DNS (SPF, DKIM, DMARC) for email delivery
- ✅ Real-time verification status with automatic polling
- ✅ Manage verified domains from a centralized UI

## Setup Instructions

### 1. Install Required Python Dependencies

```bash
pip install dnspython requests
```

### 2. Get Your Cloudflare API Token

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Go to **My Profile** → **API Tokens**
3. Click **Create Token**
4. Use the **Edit zone DNS** template OR create a custom token with these permissions:
   - **Zone** → **DNS** → **Edit**
   - **Zone** → **Zone** → **Read**
5. Select the specific zones (domains) you want to manage
6. Copy the generated API token

### 3. Configure Environment Variables

Add your Cloudflare API token to the `.env` file:

```bash
# Cloudflare Configuration
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_here
```

### 4. Restart the Backend

```bash
sudo systemctl restart firebase-manager
# or if running locally:
python src/utils/firebaseBackend.py
```

## Usage Guide

### Adding a Custom Domain

1. Navigate to **Domain Verification** in the sidebar (Globe icon 🌐)
2. Enter your custom domain (e.g., `auth.yourdomain.com`)
3. Select one or more Firebase projects to associate with this domain
4. (Optional) Check **Setup Email DNS** to automatically configure SPF/DKIM/DMARC
5. Click **Verify Domain**

### Verification Process

The system will:

1. Create a TXT record at `_firebase-verify.yourdomain.com` in Cloudflare
2. Poll DNS every 10 seconds to check for propagation (max 5 minutes)
3. Once verified, automatically update Firebase's `authorizedDomains`
4. If requested, create email DNS records (MX, SPF, DMARC)

### Managing Verified Domains

- View all verified domains in the **Verified Domains** section
- See which projects are using each domain
- Delete verification records when no longer needed

## API Endpoints

### Backend Endpoints

```
POST   /cloudflare/initiate-verification
   Body: {
     "domain": "app.example.com",
     "project_ids": ["project-1", "project-2"],
     "setup_email_dns": true,
     "email_provider": "google"
   }

GET    /cloudflare/verification-status/{verification_id}
GET    /cloudflare/verified-domains
DELETE /cloudflare/verification/{verification_id}
```

## Troubleshooting

### Verification Times Out

- **Cause**: DNS propagation can take 1-5 minutes
- **Solution**: Wait a few minutes and refresh the status. DNS changes can take up to 24 hours in rare cases.

### "Cloudflare not configured" Error

- **Cause**: Missing or invalid `CLOUDFLARE_API_TOKEN`
- **Solution**: Verify the token is correctly set in `.env` and restart the backend

### Domain Not Found in Cloudflare

- **Cause**: The root domain is not in your Cloudflare account
- **Solution**: Ensure the domain (e.g., `example.com`) is added to Cloudflare first

### Firebase Update Failed

- **Cause**: Missing service account permissions
- **Solution**: Ensure the service account has `Identity Toolkit Admin` role

## Email DNS Records Created

When **Setup Email DNS** is enabled with Google provider:

```
MX   @ 1   aspmx.l.google.com
MX   @ 5   alt1.aspmx.l.google.com  
MX   @ 5   alt2.aspmx.l.google.com
MX   @ 10  alt3.aspmx.l.google.com
MX   @ 10  alt4.aspmx.l.google.com
TXT  @     v=spf1 include:_spf.google.com ~all
TXT  _dmarc v=DMARC1; p=none; rua=mailto:admin@yourdomain.com
```

## Security Notes

- Store the Cloudflare API token as an environment variable, never commit it to version control
- Use tokens with minimal required permissions (Zone DNS Edit only)
- Restrict tokens to specific zones when possible
- Regularly rotate API tokens for security

## Frontend Component

The `CloudflareDomainManager` component provides:

- Domain input with validation
- Multi-project selection
- Real-time verification progress
- Email DNS configuration toggle
- Verified domains list with management

## Future Enhancements

Potential improvements:

- WebSocket support for instant status updates
- Support for additional email providers (SendGrid, Mailgun)
- DNS record preview before creation
- Domain health monitoring
- SSL/TLS certificate verification
- Custom DNS record templates

---

**Need help?** Check the logs in the backend console for detailed error messages.
