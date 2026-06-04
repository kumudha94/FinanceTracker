# 💰 Finance Tracker

A comprehensive personal finance management application that acts as your intelligent financial companion, built with React Native (Mobile) and React (Web).

## 🎯 Core Concept

Finance Tracker revolves around your **salary cycle** - not calendar months. Define your salary date and cycle, and the entire app adapts to provide meaningful insights based on YOUR financial timeline.

## ✨ Key Features

### 📊 Salary Cycle Management
- Set your salary date and monthly income
- Define custom monthly cycles (e.g., 15th to 14th)
- Track payday types: last working day, nth weekday, or fixed date
- View current cycle health score and financial insights

### 💳 Multi-Account Management
- **Bank Accounts** - Track checking/savings accounts
- **Credit Cards** - Monitor spending limits, billing cycles, and utilization
- **Debit Cards** - Manage linked debit cards
- Real-time balance tracking across all accounts
- Set spending limits and get alerts

### 💸 Smart Transaction Entry
- **Manual Entry** - Quick transaction logging with category tagging
- **Bank Statement Upload** - PDF statement parsing with OpenAI
- **SMS Parsing** - Auto-extract transactions from bank SMS messages
- **🤖 Tasker Automation** - Auto-create transactions from bank SMS (Android)
- Support for transfers between accounts
- Link transactions to scheduled payments or savings goals

### 📅 Scheduled Payments
- Recurring payment tracking (bills, subscriptions, rent)
- Credit card bill reminders based on billing cycles
- Payment history and upcoming payment calendar
- Auto-generate transactions when payments are due
- Mark payments as paid or skip occurrences

### 🏦 Comprehensive Loan Management
- Track multiple loans (personal, home, car, education, credit card EMI)
- **Part Payments** - Record extra principal payments to reduce interest
- **Preclosure** - Calculate and execute full loan closures
- **Top-Up** - Increase loan amount with revised EMI
- **Balance Transfer (BT)** - Switch to better interest rates
- EMI calculator with auto-scheduling
- Track total interest paid and savings from prepayments

### 🎯 Budget Planning
- Category-wise budget allocation
- Real-time spending vs budget tracking
- Visual progress indicators and alerts
- Monthly/cycle-based budget periods
- Budget rollover options

### 🏆 Savings Goals
- Create multiple savings goals with target amounts
- Set target dates and track progress
- Automatic or manual contributions
- Link to specific accounts
- Achievement tracking and notifications

### 🛡️ Insurance Management
- Track life, health, vehicle, and property insurance
- Premium payment reminders based on frequency (monthly, quarterly, yearly)
- Coverage amount and policy details
- Next due date tracking
- Link premium payments to scheduled payments

### 🏷️ Smart Categories
- Pre-loaded default categories (Food, Transport, Housing, etc.)
- Create custom categories with color coding
- Category-based spending analysis
- Budget allocation per category
- OpenAI-powered category suggestions for transactions

### 📈 Financial Insights & Dashboard
- **Financial Health Score** - Real-time assessment (0-100)
- **Spending Trends** - Visual charts for expense and credit card spending
- **Cycle Overview** - Income, expenses, and remaining budget
- **Payment Calendar** - Upcoming bills, EMIs, and premiums
- **Overdue Alerts** - Critical payment notifications
- **Daily Budget Suggestions** - Smart spending guidance based on remaining days
- **Category Analysis** - Top spending areas with actionable tips
- **Next Month Preview** - Plan ahead with projected income and expenses

### 🔐 Security & Authentication
- Email OTP verification
- 4-digit PIN lock for quick access
- Biometric authentication (Fingerprint/Face ID)
- JWT-based secure API authentication
- Multi-user support with complete data isolation

### 🎨 User Experience
- **Dark/Light/Auto Themes** - Choose your preferred appearance
- **Mobile-First Design** - Optimized for single-thumb operation
- **Web Dashboard** - Full-featured web interface
- **Offline Support** - Works without internet (sync when online)
- **Real-time Sync** - Instant updates across devices

## 🛠️ Technology Stack

### Mobile App (React Native + Expo)
- **Framework**: Expo SDK 50, React Native 0.73
- **Navigation**: React Navigation (Bottom Tabs + Stack)
- **State Management**: TanStack Query (React Query)
- **UI Components**: React Native Elements, Expo Vector Icons
- **Charts**: React Native Chart Kit
- **Storage**: AsyncStorage
- **Authentication**: Expo Local Authentication, JWT

### Web App (React + Vite)
- **Framework**: React 18, TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query
- **UI Library**: shadcn/ui, Tailwind CSS
- **Build Tool**: Vite

### Backend (Node.js + Express)
- **Runtime**: Node.js with Express
- **Database**: PostgreSQL (Neon serverless)
- **ORM**: Drizzle ORM
- **Validation**: Zod schemas
- **AI Integration**: OpenAI API (GPT-4 for SMS/PDF parsing, category suggestions)
- **Email**: EmailJS for OTP delivery
- **Authentication**: JWT tokens with refresh mechanism

### Shared
- **Schema Definitions**: Drizzle + Zod in `/shared`
- **Type Safety**: Full TypeScript across all layers

## 📁 Project Structure

```
FinanceTracker/
├── client/          # React web application
├── mobile/          # React Native mobile app
├── server/          # Express.js backend API
├── shared/          # Shared schemas and types
└── migrations/      # Database migration files
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database (or Neon account)
- Expo CLI (for mobile)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd FinanceTracker
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd mobile && npm install
   ```

3. **Configure environment**
   
   Create `.env` in root:
   ```env
   DATABASE_URL=your_postgres_connection_string
   OPENAI_API_KEY=your_openai_api_key
   JWT_SECRET=your_jwt_secret
   TASKER_API_KEY=your_secure_random_string  # For Tasker integration
   ```
   
   Create `mobile/.env`:
   ```env
   EXPO_PUBLIC_API_URL=http://YOUR_LOCAL_IP:5000
   ```

4. **Initialize database**
   ```bash
   npm run db:push
   ```

5. **Run development servers**
   
   Terminal 1 (Backend + Web):
   ```bash
   npm run dev
   ```
   
   Terminal 2 (Mobile):
   ```bash
   cd mobile
   npm start
   ```

## 📱 Building for Production

### Mobile App (Android)
```bash
cd mobile
npm run build:apk   # Development APK
npm run build:aab   # Production AAB for Play Store
```

### Web App
```bash
npm run build
```

## 🤖 Tasker Automation (Android)

Automate transaction tracking by intercepting bank SMS notifications!

Finance Tracker includes a **Tasker integration** that automatically creates transactions when your bank sends SMS notifications about debits/credits.

### Quick Setup
1. Install [Tasker](https://play.google.com/store/apps/details?id=net.dinglisch.android.taskerm) on your Android device
2. Set `TASKER_API_KEY` in your `.env` file
3. Import the pre-configured profile from `tasker-profiles/FinanceTracker-SMS.prf.xml`
4. Configure your server URL and API key in the profile
5. Done! Transactions auto-create from bank SMS 🎉

**Full guide**: See [TASKER_INTEGRATION.md](./TASKER_INTEGRATION.md) for detailed setup instructions, troubleshooting, and advanced configuration.

**Features:**
- ✅ Auto-parse bank SMS notifications
- ✅ AI-powered transaction categorization
- ✅ Works with all major Indian banks (HDFC, ICICI, Axis, SBI, etc.)
- ✅ Secure API key authentication
- ✅ Batch processing support

## 🎯 Roadmap

- [ ] **Enhanced Dashboard** - Data-driven insights with advanced visualizations
- [ ] **Investment Tracking** - Stocks, mutual funds, crypto portfolio
- [ ] **Tax Planning** - Income tax calculations and filing prep
- [ ] **Family Accounts** - Multi-user profiles with shared expenses
- [ ] **Bill Splitting** - Track shared expenses with roommates/partners
- [ ] **Receipt Scanning** - OCR for expense receipts
- [ ] **Bank Integration** - Direct account linking (Open Banking API)
- [ ] **Export Reports** - PDF/Excel financial reports
- [ ] **Voice Commands** - "Hey Finance, log ₹500 for groceries"

## 🤝 Contributing

This is a personal project, but suggestions and feedback are welcome! Feel free to open issues for bugs or feature requests.

## 📄 License

MIT License - Feel free to use this project for learning and personal use.

## 🙏 Acknowledgments

- Built with love for better financial management
- Inspired by the need for cycle-based (not month-based) finance tracking
- OpenAI for intelligent transaction parsing
- Expo team for excellent React Native tooling

---

**Made with ❤️ by Kumudha** | Track smarter, save better, live financially free! 🚀
