# Pinkxraliz Site

Pinkxraliz Site is a minimal advertisement platform where users pay 500 NGN for a 7-day ad listing. This repository contains a ready-to-run Node.js + Express example with Paystack integration and a simple AI helper to assist users creating effective ads.

Features
- Post ads (title, description, contact) and pay 500 NGN per week.
- Optional: Feature your ad for +200 NGN to highlight it in listings.
- Paystack payment initialization and webhook handling for reliable payment confirmation.
- Daily cron job to expire ads after their paid period ends.
- Simple AI helper (uses OPENAI_API_KEY if provided) to help write better ad copy.
- Mobile-friendly, Bootstrap-based frontend and easy local testing with ngrok.

Important: No API keys are stored in the repo. Use a local .env file to set secrets:

.env example (see .env.example)

How to run locally
1. Clone
   git clone https://github.com/pinkxra/pinkxraliz-site.git
   cd pinkxraliz-site

2. Install
   npm install

3. Copy and edit .env
   cp .env.example .env
   Fill PAYSTACK_SECRET_KEY, PAYSTACK_WEBHOOK_SECRET, BASE_URL, and optionally OPENAI_API_KEY.

4. Start
   npm start

5. For webhook testing locally: use ngrok and set BASE_URL to the ngrok HTTPS URL and configure Paystack webhook to: https://<ngrok-id>.ngrok.io/webhook/paystack

Notes
- In production use a persistent DB (Postgres) and secure storage for API keys and webhook secrets.
- Consider adding authentication and moderation before showing ads publicly.

