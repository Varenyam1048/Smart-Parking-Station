# Smart Parking Station

A minimal starter for a smart parking system where users must reserve parking in advance, pay upfront, and receive email notifications with their allocated time.

Features (initial scaffold):
- Reserve a slot with start time, duration, and vehicle plate
- Pay in advance (placeholder flow)
- Email notification stub (configure SMTP to enable)

Quickstart
- Prereqs: Python 3.11+
- (Optional) Create venv: `python -m venv .venv` then activate it
- Install deps: `pip install -r requirements.txt`
- Run API (dev):
  - Windows: `py -m uvicorn app.main:app --reload`
  - Unix/Mac: `uvicorn app.main:app --reload`

Env (for email)
- Copy `.env.example` to `.env` and fill values if you want real email delivery.

API (early draft)
- GET /health -> status OK
- POST /reservations -> accepts reservation details, performs placeholder payment check, and triggers an email notification stub

Notes
- Git is recommended; if not installed, install Git and run `git init -b main` in this directory.
