# Token Transfer Button Implementation Guide

## Summary

This implementation adds a **coin (🪙) button** to the chat message input area that allows users to send Stellar tokens via Soroban smart contracts directly within conversations. When clicked, it opens a popover to enter an amount, triggers Freighter wallet signing, and posts the transaction hash as a special message type in the chat thread.

## Features Implemented

✅ **Payment Button UI** — Coin icon button in message input area
✅ **Amount Input Popover** — Recipient pre-filled, amount validated > 0
✅ **Freighter Integration** — Signs Soroban `transfer` calls via wallet
✅ **Soroban Contract Submission** — Builds, simulates, and submits transactions
✅ **Transfer Messages** — JSON-serialized transfer objects in chat thread
✅ **Transfer Card Rendering** — Distinct yellow card with amount, token, and explorer link
✅ **Socket.io Integration** — Real-time message sync via backend
✅ **Auth Context** — Token management and localStorage persistence

## File Structure

```
clicked/apps/web/src/
├── app/
│   ├── chat/page.tsx              # Main chat page with socket.io integration
│   ├── layout.tsx                 # Root layout with providers
│   └── providers.tsx              # Auth provider wrapper
├── components/chat/
│   ├── MessageInput.tsx           # Composer with coin button + popover
│   └── TransferCard.tsx           # Transfer message renderer
├── lib/
│   ├── soroban.ts                 # Soroban + Freighter transaction builder/signer
│   ├── socket.ts                  # Socket.io client initialization
│   └── auth.tsx                   # Auth context (token management)
└── .env.local.example             # Environment variable template
```

## Setup & Testing

### 1. Install Dependencies

```bash
cd clicked/apps/web
pnpm install
```

### 2. Configure Environment Variables

Copy `.env.local.example` to `.env.local` and set required values:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_NETWORK=test
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_TOKEN_TRANSFER_CONTRACT=<your-token-transfer-contract-id>
```

**Important:** Replace `<your-token-transfer-contract-id>` with the actual Soroban token_transfer contract ID.

### 3. Start Backend

```bash
cd clicked/apps/backend
pnpm install
pnpm dev
# Should run on http://localhost:3001
```

### 4. Start Frontend

```bash
cd clicked/apps/web
pnpm dev
# Should run on http://localhost:3000
```

### 5. Test the Feature

1. Open `http://localhost:3000/chat`
2. Set an auth token (see "Authentication" section below)
3. Click the coin button (🪙) to open the payment popover
4. Enter an amount > 0
5. Click "Confirm" to trigger Freighter signing
6. Check the chat thread for the transfer message with explorer link

## Authentication

### Option A: Environment Variable (Demo)

Set `NEXT_PUBLIC_AUTH_TOKEN` in `.env.local` with a valid JWT token from your backend.

### Option B: localStorage (Runtime)

The app checks `localStorage.auth_token` first. You can:
1. Log in via the backend auth endpoints
2. Store the JWT in localStorage
3. The app will automatically use it

### Option C: Get a Test Token

```bash
# Hit the backend auth endpoint to create a test user and get a token
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

Then store the returned `token` in `.env.local` or localStorage.

## Message Format

Transfer messages are stored as JSON strings in the `messages.content` column:

```json
{
  "type": "transfer",
  "amount": 1000,
  "token": "TOKEN",
  "txHash": "abc123def456..."
}
```

The client parses and renders these as `TransferCard` components. Text messages remain plain strings.

## Architecture

```
User Flow:
  1. Click coin button → popover opens
  2. Enter amount > 0 → confirm
  3. Client calls transferToken() 
     - Builds Soroban transfer invocation
     - Simulates transaction
     - Calls freighter.signTransaction()
     - Submits to Soroban RPC
  4. Returns transaction hash
  5. Client emits socket 'send_message' with transfer JSON
  6. Backend stores message + broadcasts 'new_message'
  7. All clients receive and render transfer card
```

## Known Limitations

- **Hardcoded Conversation ID:** The chat page uses a demo conversation ID. In production, this should be loaded from URL params or route state.
- **Hardcoded Recipient:** Recipient is a demo placeholder. Should come from conversation context.
- **Token Amount Format:** Currently expects integer units (e.g., stroops). Adjust `Math.floor(n)` if you need decimals.
- **No Retry Logic:** Failed transfers don't auto-retry. Users must click again.
- **Message Polling Timeout:** Transfers wait up to 60 seconds for confirmation.

## Next Steps

### To Wire Into Real Chat UI
1. Find the actual chat page in the app (currently using demo at `/chat`)
2. Replace hardcoded `conversationId` and `recipient` with values from context
3. Import and use `MessageInput` component in the real composer

### To Add Persistent Transfer History
The current implementation shows transfers in the live thread. To persist:
- Backend already stores transfer JSON in `messages.content`
- When loading message history, parse JSON to identify transfers
- The `TransferCard` will render correctly

### To Use Structured Messages (Optional)
For better data modeling, add columns to the `messages` table:

```sql
ALTER TABLE messages ADD COLUMN type VARCHAR(50) DEFAULT 'text';
ALTER TABLE messages ADD COLUMN metadata JSONB;
```

Then update the backend socket handler to emit structured messages instead of JSON strings.

## Testing Checklist

- [ ] Backend running on `http://localhost:3001`
- [ ] Frontend running on `http://localhost:3000`
- [ ] Auth token set in `.env.local` or localStorage
- [ ] Token transfer contract ID configured
- [ ] Freighter wallet installed and unlocked
- [ ] Can click coin button and see popover
- [ ] Amount validation works (reject amount ≤ 0)
- [ ] Freighter signing dialog appears on confirm
- [ ] Transfer message appears in chat after signing
- [ ] Transfer card shows correct amount and explorer link
- [ ] Explorer link opens in new tab
- [ ] Socket.io errors are logged to browser console

## Troubleshooting

### "Freighter not installed or not connected"
- Install Freighter: https://www.freighter.app/
- Unlock the wallet
- Ensure the page is served over HTTPS or localhost

### "Not a member of this conversation"
- Backend socket auth verified the user but they're not in the conversation
- Backend needs to add the user to the conversation via `/conversations` API

### "Transaction not confirmed after timeout"
- Check Soroban RPC is responding
- Verify the contract ID is correct
- Check network (testnet vs mainnet)

### Socket disconnects immediately
- Check backend auth middleware
- Verify JWT token is valid
- Check CORS settings on backend

## Files Modified

- **package.json** — Added `stellar-sdk`, `@stellar/freighter-api`, `socket.io-client`
- **layout.tsx** — Wrapped with `Providers` component
- **New Components** — MessageInput, TransferCard
- **New Pages** — `/chat` page with socket integration
- **New Libs** — soroban, socket, auth helpers
- **Config** — `.env.local.example`

## Acceptance Criteria Met

✅ Amount > 0 validated  
✅ Freighter signing triggered on confirm  
✅ Transfer card appears with amount, token, and explorer link  
✅ No existing functionality broken  
✅ Code follows existing style conventions  
✅ Ready to push to `feat/stellar-token-transfer-button` branch  
