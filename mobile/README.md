# My Tracker - React Native Mobile App

A React Native mobile version of the Personal Finance Tracker app, built with Expo.

## Prerequisites

1. Node.js (v18 or higher)
2. Expo CLI: `npm install -g expo-cli`
3. Expo Go app on your Android phone (from Play Store)

## Setup

1. Navigate to the mobile folder:
   ```bash
   cd mobile
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. **Configure the backend URL**:
   
   Create a `.env` file in the mobile folder:
   ```
   EXPO_PUBLIC_API_URL=https://your-app-name.replit.app
   ```
   
   Or for local development:
   ```
   EXPO_PUBLIC_API_URL=http://YOUR_LOCAL_IP:5000
   ```
   
   Note: Use your machine's local IP (not localhost) when testing on a physical device.

4. Add app icons (optional):
   - Place icon images in the `assets/` folder:
     - `icon.png` (1024x1024) - App icon
     - `splash.png` (1284x2778) - Splash screen
     - `adaptive-icon.png` (1024x1024) - Android adaptive icon
     - `favicon.png` (48x48) - Web favicon

## Running the App

### On Android Phone (Recommended)
1. Start the Expo development server:
   ```bash
   npm start
   ```

2. Scan the QR code with Expo Go app on your Android phone

3. The app will connect to your backend API

### On Web Browser
```bash
npm run web
# or: npx expo start --web
```
Opens at `http://localhost:8082`

> **Note:** The web version uses Metro bundler. If you see JSON output at the root URL, ensure you're running with `--web` flag.

## Building APK for Testing

### Quick APK via EAS (No Android Studio Required)
```bash
npm install -g eas-cli
npx eas login
npm run build:apk
# or: npx eas build -p android --profile preview
```

Download the APK from the link provided (takes 10-15 minutes to build).

### Production Build (AAB for Play Store)
Below is proper
```
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=$JAVA_HOME/bin:$PATH
cd /home/kgd122/personal/FinanceTracker/mobile/android
./gradlew bundleRelease
```

```bash
npm run build:aab
# or: npx eas build -p android --profile production
```

See **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** for detailed deployment instructions.

## Features

- **Dashboard**: View spending summary, budget tracking, and recent transactions
- **Accounts**: Manage bank accounts and credit cards
- **Transactions**: View, search, and filter all transactions
- **Add Transaction**: Quick entry with category selection
- **Budgets**: Set monthly spending limits per category
- **Scheduled Payments**: Track recurring payments with reminders
- **Settings**: Dark mode, PIN lock, biometric authentication

## Tech Stack

- **React Native** with Expo SDK 50
- **React Navigation** (Bottom tabs + Stack navigators)
- **TanStack Query** for data fetching and caching
- **TypeScript** for type safety
- Connects to **Express.js** backend API

## Project Structure

```
mobile/
├── App.tsx                 # Main app with navigation setup
├── src/
│   ├── components/
│   │   └── FABButton.tsx   # Floating action button component
│   ├── screens/
│   │   ├── DashboardScreen.tsx      # Home with spending overview
│   │   ├── AccountsScreen.tsx       # Bank accounts & credit cards
│   │   ├── TransactionsScreen.tsx   # Transaction list with filters
│   │   ├── MoreScreen.tsx           # Navigation menu
│   │   ├── AddTransactionScreen.tsx # Add income/expense
│   │   ├── AddAccountScreen.tsx     # Add bank/credit card
│   │   ├── BudgetsScreen.tsx        # Monthly budget list
│   │   ├── AddBudgetScreen.tsx      # Create budget
│   │   ├── ScheduledPaymentsScreen.tsx # Recurring payments
│   │   ├── AddScheduledPaymentScreen.tsx # Add recurring payment
│   │   └── SettingsScreen.tsx       # App settings
│   └── lib/
│       ├── api.ts          # API client with all endpoints
│       ├── types.ts        # TypeScript type definitions
│       └── utils.ts        # Helper functions (formatting, colors)
├── assets/                  # App icons and splash screen
├── app.json                 # Expo configuration
├── .env                     # Environment variables (create this)
└── package.json
```

## API Endpoints Used

The mobile app connects to these backend endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dashboard` | GET | Dashboard analytics |
| `/api/accounts` | GET, POST | List/create accounts |
| `/api/accounts/:id` | PATCH, DELETE | Update/delete account |
| `/api/transactions` | GET, POST | List/create transactions |
| `/api/transactions/:id` | DELETE | Delete transaction |
| `/api/categories` | GET | List categories |
| `/api/budgets` | GET, POST | List/create budgets |
| `/api/budgets/:id` | DELETE | Delete budget |
| `/api/scheduled-payments` | GET, POST | List/create payments |
| `/api/scheduled-payments/:id` | PATCH, DELETE | Update/delete payment |
| `/api/user` | GET, PATCH | Get/update user settings |
| `/api/user/set-pin` | POST | Set PIN code |
| `/api/user/reset-pin` | POST | Remove PIN code |

## Backend Deployment

Before using the mobile app, deploy the backend to one of these platforms:

### Replit (Recommended)
1. Click "Publish" in Replit
2. Copy the deployment URL
3. Add to `.env` as `EXPO_PUBLIC_API_URL`

### Render
1. Connect your GitHub repo
2. Set environment variables:
   - `DATABASE_URL` - PostgreSQL connection
   - `SESSION_SECRET` - Random string
   - `OPENAI_API_KEY` - (Optional) For AI features
3. Deploy and copy the URL

### Railway
1. Connect your GitHub repo
2. Add PostgreSQL plugin
3. Set environment variables
4. Deploy and copy the URL

## Troubleshooting

**App shows "Network request failed"**
- Check that `EXPO_PUBLIC_API_URL` is set correctly
- Ensure the backend is running
- Use your machine's IP address (not localhost) for local development

**Categories/Accounts not loading**
- Verify the backend database is properly seeded
- Check backend logs for errors

**Transactions not syncing**
- Ensure you have network connectivity
- Pull to refresh on any screen to reload data
