# 💰 Finance Tracker - Features Overview

## 📋 Executive Summary

Finance Tracker is an intelligent personal finance management system designed around your unique **salary cycle** rather than traditional calendar months. Built with a mobile-first approach using React Native and React, it offers automated transaction tracking, comprehensive financial planning, and real-time insights to help you make smarter financial decisions.

### Key Differentiators
- **Salary Cycle-Based**: All tracking and insights align with YOUR payday schedule, not arbitrary calendar months
- **Smart Automation**: SMS parsing, bank statement OCR, and Tasker integration eliminate manual data entry
- **AI-Powered Intelligence**: OpenAI integration for category suggestions and transaction parsing
- **Comprehensive Coverage**: Manages everything from daily expenses to loans, insurance, and savings goals
- **Cross-Platform**: Full-featured mobile app (iOS/Android) and web dashboard with real-time sync

---

## 🎯 Core Philosophy

### The Salary Cycle Concept
Traditional finance apps force you to think in calendar months (1st-31st), but your financial reality revolves around when you get paid. Finance Tracker adapts to YOUR timeline:

- **Define Your Payday**: Set whether you're paid on a fixed date (e.g., 25th), last working day, or specific weekday (e.g., last Friday)
- **Custom Cycle Periods**: Your "month" runs from one payday to the next (e.g., 15th to 14th)
- **Cycle-Aware Insights**: All budgets, trends, and recommendations align with your salary cycle
- **Real-Time Health Score**: Track your financial health from 0-100 based on cycle progress

---

## ✨ Feature Categories

### 1. 💳 Account Management

#### Multi-Account Support
Track all your financial accounts in one place with real-time balance monitoring:

**Account Types:**
- **Bank Accounts** (Checking/Savings)
  - Full account number and IFSC code storage
  - Current balance tracking
  - Transaction history
  - Default account designation

- **Credit Cards**
  - Credit limit monitoring
  - Monthly spending limits
  - Billing cycle tracking (custom billing dates)
  - Utilization percentage calculation
  - Outstanding balance alerts

- **Debit Cards**
  - Linked to parent bank account
  - Spending from card automatically reflects in bank balance
  - Separate transaction categorization

- **Digital Wallets** (Paytm, PhonePe, etc.)
  - Track e-wallet balances
  - Monitor digital spending

- **Provident Fund (PF)**
  - Long-term savings tracking
  - Contribution history

**Features:**
- Color-coded account icons for quick identification
- Active/inactive account status
- Set spending limits with alerts
- Account-level balance forecasting

---

### 2. 💸 Transaction Management

#### Multiple Entry Methods

**1. Manual Entry**
- Quick transaction logging interface
- Amount, category, merchant, and notes
- Date and time selection
- Account selection
- Transfer between accounts support

**2. Bank Statement Upload**
- PDF statement parsing using OpenAI Vision API
- Automatic transaction extraction
- Date, amount, merchant detection
- Batch import with review step
- Duplicate detection

**3. SMS Parsing (AI-Powered)**
- Real-time SMS interception
- Intelligent parsing of bank notifications
- Extracts: amount, type (debit/credit), merchant, reference number, balance
- Supports multiple bank formats
- Automatic category suggestion using OpenAI

**4. Tasker Automation (Android)**
- Zero-touch transaction creation
- Intercepts bank SMS automatically
- Sends to API for parsing
- Creates transaction without opening app
- Saves ~6 hours annually of manual entry

#### Transaction Features
- Transfer tracking between own accounts
- Reference number logging
- Merchant name standardization
- Available balance snapshot (when SMS includes it)
- Link to scheduled payments or savings goals
- Recurring transaction flagging
- Edit/delete capability with audit trail

---

### 3. 📅 Scheduled Payments & Bills

#### Comprehensive Payment Tracking

**Payment Types:**
- **Recurring Bills** (Electricity, water, internet)
- **Subscriptions** (Netflix, Spotify, gym memberships)
- **Rent/Mortgage**
- **Credit Card Bills** (auto-calculated from billing cycle)
- **Loan EMIs** (auto-created from loan setup)
- **Insurance Premiums** (linked to insurance policies)

**Scheduling Options:**
- **Frequency**: Daily, weekly, monthly, quarterly, yearly
- **Start Date**: When payments begin
- **End Date**: Optional (for fixed-term payments)
- **Flexible Dates**: Support for last day of month, specific weekday, etc.

**Smart Features:**
- **Upcoming Payment Calendar**: Visual timeline of all upcoming bills
- **Payment Reminders**: Notifications before due date
- **Auto-Generate Transactions**: Create actual transactions when marked as paid
- **Payment History**: Track all past payments
- **Skip Occurrences**: Handle irregular months or vacations
- **Overdue Alerts**: Critical notifications for missed payments
- **Amount Variation Tracking**: Monitor if bill amounts change over time

---

### 4. 🏦 Loan Management System

#### Comprehensive Loan Lifecycle Management

**Loan Types Supported:**
- Personal Loans
- Home Loans
- Car Loans
- Education Loans
- Credit Card EMI Conversions

**Loan Components:**
The system models complex loan structures with four key components:
1. **Initial Disbursement**: Original loan amount
2. **Part Payments**: Extra principal payments to reduce interest
3. **Preclosures**: Full loan payoff before term end
4. **Top-Ups**: Additional borrowing on existing loan

**Loan Features:**

**1. EMI Calculator & Scheduling**
- Input: Principal, interest rate, tenure
- Calculate monthly EMI using reducing balance method
- Auto-generate scheduled payment entries
- Track total interest payable vs. paid
- Amortization schedule visualization

**2. Part Payments (Prepayments)**
- Record extra principal payments anytime
- Calculate interest saved
- Two reduction options:
  - Reduce EMI amount (lower monthly burden)
  - Reduce tenure (pay off faster)
- Track accumulated savings from all part payments
- Historical part payment log

**3. Preclosure (Full Payoff)**
- Calculate exact payoff amount
- Factor in prepayment penalties
- Interest calculation up to closure date
- Track interest saved vs. full term
- Closure documentation
- Loan marked as "closed"

**4. Top-Up**
- Increase loan amount mid-term
- Recalculate EMI based on:
  - New total principal (existing + top-up)
  - Remaining tenure or extended tenure
  - Updated interest rate
- New EMI schedule generation
- Historical tracking of top-up events

**5. Balance Transfer (BT)**
- Transfer loan to different lender
- Track multiple BT events per loan
- Capture:
  - From/to lender details
  - Original vs. new interest rate
  - Transfer date
  - Interest savings calculation
- BT allocation tracking (how much transferred from which loan)

**6. Loan Dashboard**
- Active loans overview
- Total outstanding across all loans
- Total monthly EMI burden
- Interest paid to date
- Interest remaining
- Savings from prepayments
- Loan health score (EMI to income ratio)

---

### 5. 🎯 Budget Planning

#### Intelligent Budget Management

**Budget Creation:**
- **Category-Based Allocation**: Set limits for each spending category
- **Total Budget Calculation**: Automatic summing of all category budgets
- **Income-Based Recommendations**: AI suggests budget splits based on your income
- **50/30/20 Rule Support**: Pre-built templates (Needs/Wants/Savings)

**Budget Tracking:**
- **Real-Time Monitoring**: Live spending vs. budget comparison
- **Visual Progress Bars**: Quick overview of category utilization
- **Color-Coded Alerts**:
  - Green: <70% spent (on track)
  - Yellow: 70-90% spent (warning)
  - Red: >90% spent (danger)
  - Dark Red: Over budget

**Budget Periods:**
- **Salary Cycle-Based**: Budget resets with each salary cycle
- **Monthly Budget**: Traditional calendar month option
- **Custom Periods**: Define any date range

**Advanced Features:**
- **Budget Rollover**: Unused budget carries to next period
- **Shared Budgets**: Family members can contribute to same categories
- **Budget Adjustments**: Mid-cycle budget modifications with tracking
- **Trend Analysis**: Compare budget adherence across cycles
- **Forecasting**: Predict if you'll stay within budget based on current pace

---

### 6. 🏆 Savings Goals

#### Goal-Based Savings System

**Goal Creation:**
- **Target Amount**: How much you want to save
- **Target Date**: When you want to achieve it
- **Goal Name & Description**: E.g., "Emergency Fund", "Vacation to Bali"
- **Visual Icon & Color**: Personalize your goals
- **Linked Account**: Where the savings are accumulated

**Contribution Methods:**

**1. Manual Contributions**
- One-time deposits
- Ad-hoc additions
- Gift money allocation
- Bonus allocation

**2. Automatic Contributions**
- **Fixed Amount**: Same amount every period (e.g., ₹5,000/month)
- **Percentage of Income**: Dynamic based on earnings (e.g., 10% of salary)
- **Triggered by Events**: Save when specific conditions met
- **Round-Up Savings**: Round transactions to nearest 10/100 and save difference

**Goal Tracking:**
- **Progress Percentage**: Visual progress bar
- **Amount Saved vs. Target**: Clear numerical display
- **Projected Completion Date**: Based on contribution rate
- **Behind/Ahead Schedule**: Indicator if you're on track
- **Milestone Celebrations**: Notifications at 25%, 50%, 75%, 100%

**Goal Management:**
- **Pause Goals**: Temporarily stop contributions
- **Extend Deadlines**: Modify target dates without losing progress
- **Withdraw from Goals**: Record when you use saved money
- **Goal Completion**: Mark as achieved and archive
- **Goal Templates**: Quick start for common goals (emergency fund, house down payment)

---

### 7. 🛡️ Insurance Management

#### Policy Tracking & Premium Management

**Insurance Types:**
- **Life Insurance** (Term, Whole Life, Endowment)
- **Health Insurance** (Individual, Family Floater, Critical Illness)
- **Vehicle Insurance** (Car, Bike - Comprehensive, Third Party)
- **Property Insurance** (Home, Contents)

**Policy Information:**
- Policy number and provider
- Coverage amount (Sum Insured)
- Premium amount
- Payment frequency (Monthly, Quarterly, Semi-Annual, Annual)
- Policy start and end dates
- Nominee details
- Policy documents (PDF upload)

**Premium Tracking:**
- **Auto-Calculate Next Due Date**: Based on frequency
- **Premium Payment Reminders**: Notifications before due date
- **Link to Scheduled Payments**: Auto-create payment entries
- **Payment History**: Track all premium payments
- **Lapse Warnings**: Alert when policy about to expire
- **Grace Period Tracking**: Know your payment window

**Insurance Dashboard:**
- Total coverage across all policies
- Total annual premium outflow
- Policies expiring soon
- Underinsured categories (AI recommendations)
- Premium payment calendar
- Coverage gap analysis

---

### 8. 🏷️ Smart Categorization

#### AI-Powered Transaction Categories

**Default Categories:**
Pre-loaded with 13+ essential categories:
- Groceries, Transport, Dining, Shopping
- Entertainment, Bills, Health, Education
- Travel, Salary, Investment, Transfer
- Other (catch-all)

**Custom Categories:**
- Create unlimited custom categories
- Choose from 100+ icon options
- Custom color coding
- Set as expense, income, or transfer type
- Category-specific budgets

**AI Category Suggestions:**
When creating transactions from SMS or manual entry:
- OpenAI analyzes merchant name and transaction details
- Suggests most likely category with confidence score
- Learns from your past categorization patterns
- Falls back to "Other" if uncertain
- Manual override always available

**Category Analytics:**
- **Top Spending Categories**: Ranked by amount
- **Trend Over Time**: Category spending across cycles
- **Category Budget Adherence**: How well you stick to limits
- **Unusual Spending Detection**: Alerts for abnormal category spending

---

### 9. 📈 Financial Insights & Dashboard

#### Real-Time Financial Intelligence

**Financial Health Score (0-100)**
Calculated from multiple factors:
- **Budget Adherence** (30%): Staying within limits
- **Savings Rate** (25%): Percentage of income saved
- **Debt-to-Income Ratio** (20%): Loan EMIs vs. income
- **Emergency Fund Status** (15%): 3-6 months expenses saved
- **Payment Timeliness** (10%): No overdue bills

Score displayed with:
- Color-coded indicator (Red/Yellow/Green)
- Trend arrow (improving/declining)
- Personalized tips to improve score

**Dashboard Widgets:**

**1. Cycle Overview**
- Days remaining in current cycle
- Total income received
- Total expenses
- Remaining budget
- Projected end-of-cycle balance
- Comparison to last cycle

**2. Spending Trends**
- **Line Chart**: Daily spending patterns
- **Bar Chart**: Category-wise breakdown
- **Pie Chart**: Expense distribution
- **Credit Card Spending**: Separate tracking
- Time period filters (week, cycle, month, year)

**3. Payment Calendar**
- **Visual Timeline**: All upcoming payments
- **Days Until Next Payment**: Countdown
- **Overdue Payments**: Red alerts
- **Total Upcoming**: Sum of all pending bills
- Quick-pay actions

**4. Daily Budget Suggestion**
- **Smart Calculation**: (Remaining Budget ÷ Days Left)
- **Contextual**: Accounts for known upcoming bills
- **Color-Coded**: Green (comfortable), Yellow (tight), Red (exceeded)
- **Actionable Tips**: Spending recommendations

**5. Category Deep Dive**
- **Top 5 Spending Categories**
- **Percentage of Total Spending**
- **Comparison to Budget**
- **Comparison to Previous Cycle**
- **Actionable Insights**: E.g., "Dining up 40% from last cycle"

**6. Next Cycle Preview**
- **Expected Income**: From salary profile
- **Scheduled Expenses**: Sum of all scheduled payments
- **Budget Allocation**: Recommended distribution
- **Net Savings Projection**: What you'll save if current pattern continues
- **Warning Flags**: If projected to overspend

**7. Account Balances Overview**
- All accounts at a glance
- Total liquid assets
- Total credit available
- Total credit utilized
- Net worth calculation (assets - liabilities)

**8. Goals Progress**
- All active savings goals
- Progress percentages
- On-track indicators
- Required monthly contribution to stay on track

**9. Loan Summary**
- Total outstanding debt
- Monthly EMI burden
- Total interest paid this cycle
- Interest saved from prepayments
- Debt-free countdown

**10. Recent Transactions**
- Last 10-20 transactions
- Quick filters (debits, credits, by account, by category)
- Swipe actions (edit, delete, recategorize)

---

### 10. 🔐 Security & Authentication

#### Multi-Layer Security System

**Authentication Methods:**

**1. Email OTP (Primary)**
- Email-based login
- 6-digit verification code
- 5-minute expiration
- Powered by EmailJS
- No password to remember or be compromised

**2. 4-Digit PIN Lock**
- Quick access after initial login
- Local device storage (encrypted)
- 3 failed attempts = force re-login with OTP
- Optional feature (can be disabled)

**3. Biometric Authentication** (Planned)
- Fingerprint recognition
- Face ID support
- Device-specific
- Fallback to PIN

**API Security:**
- **JWT Tokens**: Secure session management
- **Token Expiration**: Auto-logout after 7 days
- **Refresh Tokens**: Seamless re-authentication
- **Secure Headers**: All API calls include auth tokens

**Data Isolation:**
- **User ID Filtering**: All queries filtered by authenticated user
- **No Cross-User Access**: Impossible to see another user's data
- **Ownership Validation**: All create/update operations verify ownership

**Tasker API Security:**
- **API Key Authentication**: Required for SMS automation endpoint
- **X-API-Key Header**: Validates incoming requests
- **Environment Variable**: API key stored securely server-side
- **Rate Limiting**: Prevent abuse (planned)

**Privacy:**
- **No Data Selling**: Your financial data is never sold
- **Local Storage Option**: Can run on local network
- **Export Capability**: Download all your data anytime
- **Account Deletion**: Complete data removal on request

---

### 11. 🎨 User Experience

#### Design Philosophy

**Mobile-First Design:**
- **Single-Thumb Operation**: All primary actions reachable with thumb
- **Bottom Navigation**: Common tasks always accessible
- **Swipe Gestures**: Quick actions without opening menus
- **Large Touch Targets**: Easy to tap, no precision required
- **Minimal Typing**: Smart defaults, dropdowns, and suggestions

**Theme System:**
- **Light Mode**: Clean, professional look for daytime
- **Dark Mode**: Eye-friendly for night-time use
- **Auto Mode**: Switches based on system settings or time of day
- **High Contrast**: Accessibility option for visual impairments

**Responsive Design:**
- **Mobile Optimized**: iOS and Android native feel
- **Tablet Support**: Expanded layouts for larger screens
- **Web Dashboard**: Full desktop interface
- **Consistent Experience**: Same features across all platforms

**Offline-First Architecture:**
- **Local Data Storage**: App works without internet
- **Queue Operations**: Changes saved locally, synced when online
- **Conflict Resolution**: Smart merging of offline changes
- **Sync Indicator**: Clear status of online/offline state

**Performance:**
- **Fast Load Times**: < 2 seconds to dashboard
- **Smooth Animations**: 60fps transitions
- **Optimistic UI**: Instant feedback, server validation happens in background
- **Lazy Loading**: Load data as needed, not all at once

**Accessibility:**
- **Screen Reader Support**: Full VoiceOver/TalkBack compatibility
- **High Contrast Mode**: For low vision users
- **Font Scaling**: Respects system text size settings
- **Haptic Feedback**: Tactile confirmation of actions

---

## 🔧 Technical Architecture

### Technology Stack

**Frontend (Mobile):**
- **React Native** - Cross-platform iOS/Android
- **Expo** - Development and build tooling
- **React Query** - Server state management
- **React Navigation** - Navigation and routing
- **Async Storage** - Local data persistence

**Frontend (Web):**
- **React** - Component-based UI
- **Vite** - Fast build tool
- **TanStack Query** - Data fetching and caching
- **Tailwind CSS** - Utility-first styling
- **shadcn/ui** - Accessible component library
- **React Hook Form** - Form state management

**Backend:**
- **Node.js** - Runtime environment
- **Express** - Web framework
- **TypeScript** - Type-safe development
- **Drizzle ORM** - Type-safe database queries

**Database:**
- **PostgreSQL** - Primary database
- **Neon Serverless** - Managed Postgres hosting
- **Drizzle Kit** - Schema migrations

**AI/ML:**
- **OpenAI GPT-4** - SMS parsing and category suggestions
- **OpenAI Vision API** - PDF statement OCR

**Authentication:**
- **JWT** - Token-based auth
- **EmailJS** - OTP delivery
- **bcrypt** - Password/PIN hashing

**External Integrations:**
- **Tasker** - Android automation (SMS interception)
- **PDF-Parse** - Statement parsing
- **Node-Cron** - Scheduled tasks

### Data Models

**Core Entities:**
1. **Users** - Account holders
2. **Accounts** - Bank/card/wallet accounts
3. **Transactions** - All financial movements
4. **Categories** - Transaction classifications
5. **Budgets** - Spending limits
6. **Scheduled Payments** - Recurring bills
7. **Payment Occurrences** - Individual payment instances
8. **Savings Goals** - Savings targets
9. **Savings Contributions** - Deposits to goals
10. **Loans** - Loan accounts
11. **Loan Payments** - EMI and prepayments
12. **Loan Components** - Disbursements, part payments, etc.
13. **Insurances** - Insurance policies
14. **Salary Profiles** - Payday configuration
15. **Salary Cycles** - Individual cycle instances

**Relationships:**
- Users → Accounts (One-to-Many)
- Accounts → Transactions (One-to-Many)
- Categories → Transactions (One-to-Many)
- Users → Budgets (One-to-Many)
- Users → Scheduled Payments (One-to-Many)
- Scheduled Payments → Payment Occurrences (One-to-Many)
- Users → Savings Goals (One-to-Many)
- Savings Goals → Contributions (One-to-Many)
- Users → Loans (One-to-Many)
- Loans → Loan Payments (One-to-Many)
- Loans → Loan Components (One-to-Many)

### API Architecture

**RESTful Endpoints:**
- `/api/auth/*` - Authentication
- `/api/users/*` - User management
- `/api/accounts/*` - Account CRUD
- `/api/transactions/*` - Transaction operations
- `/api/categories/*` - Category management
- `/api/budgets/*` - Budget tracking
- `/api/scheduled-payments/*` - Bill management
- `/api/savings-goals/*` - Goal tracking
- `/api/loans/*` - Loan management
- `/api/insurances/*` - Insurance tracking
- `/api/salary-profile/*` - Salary configuration
- `/api/dashboard/*` - Aggregated insights
- `/api/parse-sms` - SMS parsing endpoint

**Response Format:**
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful"
}
```

**Error Handling:**
```json
{
  "success": false,
  "error": "Validation error",
  "details": { ... }
}
```

---

## 🚀 Unique Selling Points

### What Makes Finance Tracker Different?

1. **Salary Cycle Intelligence**
   - Only app that truly understands YOUR financial calendar
   - No more meaningless calendar month tracking
   - Insights when you need them (relative to payday)

2. **Zero-Touch Transaction Entry**
   - SMS parsing + Tasker automation = no manual entry
   - 95%+ of transactions auto-created
   - Save hours every month

3. **Comprehensive Loan Management**
   - Most apps ignore loans or treat them simplistically
   - Full lifecycle tracking: disbursement → part payments → closure → BT
   - Calculate interest saved from prepayments
   - Optimize loan payoff strategy

4. **Intelligent Financial Health Score**
   - Not just "spend less" advice
   - Multi-factor analysis of your complete financial picture
   - Actionable recommendations to improve

5. **Insurance Integration**
   - Most apps ignore insurance completely
   - Track policies, premiums, renewals
   - Never let coverage lapse

6. **AI-Powered Intelligence**
   - OpenAI suggests categories with high accuracy
   - Natural language SMS parsing (any bank format)
   - PDF statement OCR for bulk imports
   - Smart spending insights

7. **Cross-Platform Perfection**
   - True native mobile experience
   - Full-featured web dashboard
   - Real-time sync across all devices
   - Offline-first architecture

8. **Privacy-First**
   - Self-hostable (run on your own server)
   - No data selling
   - No ads
   - Complete data export

---

## 📊 Use Cases

### Individual Users

**Young Professional (Fresh Graduate)**
- Track first salary and learn budgeting
- Build emergency fund with savings goals
- Monitor subscription spending
- Simple expense categorization

**Family Person (30-45 years)**
- Manage home loan with part payment optimization
- Track multiple insurance policies
- Plan for children's education (savings goals)
- Household budget with multiple category limits
- Credit card management for rewards optimization

**Business Owner / Freelancer**
- Irregular income tracking
- Separate business vs. personal expenses
- Tax planning with category-wise reports
- Multiple account management

**Retiree**
- Fixed income (pension) tracking
- Medical expense monitoring
- Investment income tracking
- Minimal but regular spending patterns

### Family/Shared Use

- Multiple user accounts with data isolation
- Shared budget categories
- Family goals (vacation fund, house down payment)
- Consolidated dashboard for household finances

---

## 🎯 Future Roadmap

### Planned Features

**Short-Term (Next 3 Months):**
- ✅ Security audit and ownership validation fixes
- [ ] Biometric authentication (fingerprint/Face ID)
- [ ] Week start/end day configuration
- [ ] Merchant categorization improvements
- [ ] Enhanced PDF parsing with multiple formats support

**Medium-Term (3-6 Months):**
- [ ] Shared budgets and family accounts
- [ ] Investment tracking (stocks, mutual funds, crypto)
- [ ] Tax calculation and reporting
- [ ] Custom financial reports (PDF export)
- [ ] Multi-currency support
- [ ] Bank integration via Plaid/Yodlee

**Long-Term (6-12 Months):**
- [ ] AI financial advisor chatbot
- [ ] Predictive analytics (forecast future expenses)
- [ ] Social features (compare anonymized spending patterns)
- [ ] Financial education modules
- [ ] Voice-based transaction entry
- [ ] Wearable device integration (Apple Watch, Wear OS)

---

## 📖 Documentation

For detailed setup and usage instructions, refer to:

- **[README.md](./README.md)** - Quick start guide and installation
- **[AUTHENTICATION.md](./AUTHENTICATION.md)** - Authentication system details
- **[TASKER_INTEGRATION.md](./TASKER_INTEGRATION.md)** - SMS automation setup
- **[TASKER_FLOW.md](./TASKER_FLOW.md)** - SMS automation flow diagram
- **[IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)** - Technical implementation notes

---

## 🤝 Contributing

Finance Tracker is open for contributions! Areas where help is needed:

- **Bug Fixes**: Especially security and data integrity issues
- **UI/UX Improvements**: Better accessibility and mobile experience
- **Bank SMS Parsers**: Support for more bank formats
- **Localization**: Multi-language support
- **Testing**: Unit and integration tests
- **Documentation**: More examples and tutorials

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 💬 Support

For questions, issues, or feature requests:
- **GitHub Issues**: [Report bugs or request features]
- **Email**: [Your support email]
- **Discord**: [Community chat link]

---

**Last Updated**: August 15, 2026
**Version**: 1.0.0
**Status**: Production Ready 🚀
