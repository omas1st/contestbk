# Fast Finger Contest — Backend

Node.js + Express backend for the "Fast Finger" contest platform.

## Prerequisites
- Node.js 16+ and npm
- MongoDB (Atlas or local)
- (Optional) Gmail account for admin notification emails (use app password for security)

## Setup
1. Clone the repo / copy files into a folder.
2. `npm install`
3. Copy `.env.example` to `.env` and fill in the values (especially `MONGO_URI` and `secret_key`).
4. Create `uploads/` folder (the code will create it automatically if missing).
5. Start the server:
   - Development: `npm run dev` (uses nodemon)
   - Production: `npm start`

## Important endpoints (summary)
- `POST /api/auth/register` — register new user (body: firstName, lastName, country, email, phone, username, password)
- `POST /api/auth/login` — login (body: username, password)
- `GET  /api/auth/dashboard` — user dashboard (requires Bearer token)
- `POST /api/auth/message` — send message to admin
- `POST /api/auth/activate-payment` — submit activation payment (file field `giftImage` allowed)
- `POST /api/auth/withdraw-request` — create withdraw preview
- `POST /api/auth/withdraw-proceed/:id` — proceed withdraw

- `GET  /api/admin/users` — list users (admin)
- `PUT  /api/admin/users/:id` — edit user (admin) (body: balance, action)
- `GET  /api/admin/messages` — view messages (admin)
- `POST /api/admin/notify` — send notification to a user (admin) (body: userId, text)
- `GET  /api/admin/payments` — get activation payments (admin)
- `POST /api/admin/approve/:userId` — approve tax/insurance (admin)
- `GET  /api/admin/withdrawals` — list withdrawals (admin)
- `POST /api/admin/withdrawals/:id/approve` — approve withdrawal (admin)

## Notes & Next steps
- Frontend will need to attach `Authorization: Bearer <token>` header for authenticated routes.
- The activation payment route accepts a multipart/form-data form with `giftImage` as file field.
- Timer logic is based on `timerActive` & `timerEnds` on the user document — admin will start/stop timers via the admin `PUT /api/admin/users/:id` endpoint.
- If you want route/controller splitting or extra validation, I can add Joi/celebrate validation or move controllers into more granular modules.

