import type { Express } from "express";
import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { 
  insertAccountSchema, 
  insertTransactionSchema, 
  insertBudgetSchema, 
  insertScheduledPaymentSchema,
  insertPaymentOccurrenceSchema,
  insertSavingsGoalSchema,
  insertSavingsContributionSchema,
  insertSalaryProfileSchema,
  insertSalaryCycleSchema,
  insertSmsLogSchema,
  insertCategorySchema,
  insertLoanSchema,
  insertLoanComponentSchema,
  insertLoanInstallmentSchema,
  insertLoanTermSchema,
  insertLoanPaymentSchema,
  insertCardDetailsSchema,
  insertInsuranceSchema,
  insertInsurancePremiumSchema
} from "@shared/schema";
import { suggestCategory, parseSmsMessage, parseStatementPDF, ExtractedTransaction } from "./openai";
import { deriveInstitutionKey, parseDueSms } from "./smsParser";
import multer from "multer";
// pdf-parse is imported dynamically at usage site to avoid pdfjs-dist crashing on startup
import { getPaydayForMonth, getNextPaydays, getPastPaydays, getCurrentCycleDates, getNextCycleDates, getCyclePrimaryMonth } from "./salaryUtils";
import { validateNewSpendingEntry } from "./loanSpendingValidation";
import { generateOTP, storeOTP, verifyOTP, sendOTP } from "./emailService";
import { generateTokenPair, generateAccessToken } from "./jwtService";
import { authenticateToken } from "./authMiddleware";
import { validateApiKey } from "./apiKeyMiddleware";
import { verifyToken } from "./jwtService";
import { PRIVACY_POLICY_HTML } from "./privacyPolicy";

// Configure multer for file uploads (memory storage for processing)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Seed default categories on startup
  await storage.seedDefaultCategories();

  // ========== Privacy Policy (public, required for Play Store listing) ==========
  app.get("/privacy-policy", (req, res) => {
    res.type("html").send(PRIVACY_POLICY_HTML);
  });

  // ========== Authentication ==========
  app.post("/api/auth/request-otp", async (req, res) => {
    try {
      const { email, username } = req.body;
      
      if (!email || !username) {
        return res.status(400).json({ error: "Email and username are required" });
      }

      // Check if user exists, if not create
      let user = await storage.getUserByEmail(email);
      if (!user) {
        user = await storage.createUser({
          name: username,
          email: email,
        });
      }

      // Generate and store OTP
      const otp = generateOTP();
      storeOTP(email, otp);

      // Send OTP via email
      const sent = await sendOTP(email, username, otp);
      
      if (sent) {
        res.json({ success: true, message: "OTP sent to your email" });
      } else {
        res.status(500).json({ error: "Failed to send OTP" });
      }
    } catch (error: any) {
      console.error("Request OTP error:", error);
      res.status(500).json({ error: error.message || "Failed to request OTP" });
    }
  });

  app.post("/api/auth/verify-otp", async (req, res) => {
    try {
      const { email, otp } = req.body;
      
      if (!email || !otp) {
        return res.status(400).json({ error: "Email and OTP are required" });
      }

      const isValid = verifyOTP(email, otp);
      
      if (isValid) {
        const user = await storage.getUserByEmail(email);
        if (user) {
          // Generate JWT token pair
          const { accessToken, refreshToken } = generateTokenPair(user.id, user.email!);
          
          res.json({ 
            success: true,
            accessToken,
            refreshToken,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              hasPassword: !!user.passwordHash,
              hasPin: !!user.pinHash,
              biometricEnabled: user.biometricEnabled
            }
          });
        } else {
          res.status(404).json({ error: "User not found" });
        }
      } else {
        res.status(401).json({ error: "Invalid or expired OTP" });
      }
    } catch (error: any) {
      console.error("Verify OTP error:", error);
      res.status(500).json({ error: error.message || "Failed to verify OTP" });
    }
  });

  // Password-based login
  app.post("/api/auth/login-password", async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const user = await storage.getUserByEmail(email);
      if (!user || !user.passwordHash) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      
      if (isValidPassword) {
        const { accessToken, refreshToken } = generateTokenPair(user.id, user.email!);
        
        res.json({ 
          success: true,
          accessToken,
          refreshToken,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            hasPassword: !!user.passwordHash,
            hasPin: !!user.pinHash,
            biometricEnabled: user.biometricEnabled
          }
        });
      } else {
        res.status(401).json({ error: "Invalid email or password" });
      }
    } catch (error: any) {
      console.error("Password login error:", error);
      res.status(500).json({ error: error.message || "Login failed" });
    }
  });

  // Set password (after first OTP login)
  app.post("/api/auth/set-password", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { password } = req.body;
      
      if (!password || password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      // First check if user exists
      const existingUser = await storage.getUser(userId);
      
      if (!existingUser) {
        console.error(`❌ [set-password] User not found with ID: ${userId}`);
        console.error(`   Token payload:`, req.user);
        return res.status(404).json({ error: "User not found" });
      }

      console.log(`✅ [set-password] Setting password for user: ${existingUser.email} (ID: ${userId})`);

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await storage.updateUser(userId, { passwordHash });
      
      if (user) {
        console.log(`✅ [set-password] Password set successfully for user: ${user.email}`);
        res.json({ 
          success: true, 
          message: "Password set successfully",
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            hasPassword: !!user.passwordHash,
            hasPin: !!user.pinHash,
            biometricEnabled: user.biometricEnabled
          }
        });
      } else {
        console.error(`❌ [set-password] Failed to update password for user ID: ${userId}`);
        res.status(500).json({ error: "Failed to update password" });
      }
    } catch (error: any) {
      console.error("❌ [set-password] Error:", error);
      res.status(500).json({ error: error.message || "Failed to set password" });
    }
  });

  app.post("/api/auth/setup-pin", async (req, res) => {
    try {
      const { userId, pin } = req.body;
      
      if (!userId || !pin) {
        return res.status(400).json({ error: "User ID and PIN are required" });
      }

      if (pin.length !== 4 || !/^\d+$/.test(pin)) {
        return res.status(400).json({ error: "PIN must be 4 digits" });
      }

      const pinHash = await bcrypt.hash(pin, 10);
      const user = await storage.updateUserPin(userId, pinHash);
      
      if (user) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "User not found" });
      }
    } catch (error: any) {
      console.error("Setup PIN error:", error);
      res.status(500).json({ error: error.message || "Failed to setup PIN" });
    }
  });

  app.post("/api/auth/verify-pin", async (req, res) => {
    try {
      const { userId, pin } = req.body;
      
      if (!userId || !pin) {
        return res.status(400).json({ error: "User ID and PIN are required" });
      }

      const user = await storage.getUser(userId);
      
      if (!user || !user.pinHash) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const isValid = await bcrypt.compare(pin, user.pinHash);
      
      if (isValid) {
        // Generate JWT token pair
        const { accessToken, refreshToken } = generateTokenPair(user.id, user.email!);
        
        res.json({ 
          success: true, 
          accessToken,
          refreshToken,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            biometricEnabled: user.biometricEnabled
          }
        });
      } else {
        res.status(401).json({ error: "Invalid PIN" });
      }
    } catch (error: any) {
      console.error("Verify PIN error:", error);
      res.status(500).json({ error: error.message || "Failed to verify PIN" });
    }
  });

  // Biometric verification endpoint - verifies user has biometric enabled and returns tokens
  app.post("/api/auth/verify-biometric", async (req, res) => {
    try {
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }

      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (!user.biometricEnabled) {
        return res.status(403).json({ error: "Biometric authentication not enabled" });
      }

      // Since the device already verified biometric (fingerprint/face), 
      // we trust that and generate tokens
      const { accessToken, refreshToken } = generateTokenPair(user.id, user.email!);
      
      res.json({ 
        success: true, 
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          biometricEnabled: user.biometricEnabled
        }
      });
    } catch (error: any) {
      console.error("Verify biometric error:", error);
      res.status(500).json({ error: error.message || "Failed to verify biometric" });
    }
  });

  app.post("/api/auth/toggle-biometric", async (req, res) => {
    try {
      const { userId, enabled } = req.body;
      
      if (!userId || enabled === undefined) {
        return res.status(400).json({ error: "User ID and enabled status are required" });
      }

      const user = await storage.updateUserBiometric(userId, enabled);
      
      if (user) {
        res.json({ success: true, biometricEnabled: user.biometricEnabled });
      } else {
        res.status(404).json({ error: "User not found" });
      }
    } catch (error: any) {
      console.error("Toggle biometric error:", error);
      res.status(500).json({ error: error.message || "Failed to toggle biometric" });
    }
  });

  // Refresh access token using refresh token
  app.post("/api/auth/refresh-token", async (req, res) => {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(400).json({ error: "Refresh token is required" });
      }

      // Verify refresh token
      const payload = verifyToken(refreshToken);
      
      if (!payload || payload.type !== 'refresh') {
        return res.status(403).json({ error: "Invalid refresh token" });
      }

      // Generate new access token
      const newAccessToken = generateAccessToken(payload.userId, payload.email);
      
      res.json({ 
        success: true,
        accessToken: newAccessToken
      });
    } catch (error: any) {
      console.error("Refresh token error:", error);
      res.status(403).json({ error: "Invalid or expired refresh token" });
    }
  });

  // ========== Categories ==========
  app.get("/api/categories", async (_req, res) => {
    try {
      const categories = await storage.getAllCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  app.post("/api/categories", async (req, res) => {
    try {
      const validatedData = insertCategorySchema.parse(req.body);
      const category = await storage.createCategory(validatedData);
      res.status(201).json(category);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid category data" });
    }
  });

  app.patch("/api/categories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertCategorySchema.partial().parse(req.body);
      const category = await storage.updateCategory(id, validatedData);
      res.json(category);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid category data" });
    }
  });

  app.delete("/api/categories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteCategory(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to delete category" });
    }
  });

  app.get("/api/categories/usage", async (_req, res) => {
    try {
      const usage = await storage.getCategoryUsage();
      res.json(usage);
    } catch (error) {
      console.error("Error fetching category usage:", error);
      res.status(500).json({ error: "Failed to fetch category usage" });
    }
  });

  // ========== Accounts ==========
  app.get("/api/accounts", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const accounts = await storage.getAllAccounts(userId);
      // Optimize: Batch fetch card details for all card accounts at once
      const cardAccountIds = accounts
        .filter(a => a.type === 'credit_card' || a.type === 'debit_card')
        .map(a => a.id);
      
      const cardDetailsMap = new Map();
      if (cardAccountIds.length > 0) {
        const allCardDetails = await Promise.all(
          cardAccountIds.map(id => storage.getCardDetails(id))
        );
        cardAccountIds.forEach((id, idx) => {
          if (allCardDetails[idx]) cardDetailsMap.set(id, allCardDetails[idx]);
        });
      }
      
      const accountsWithCards = accounts.map(account => {
        if (cardDetailsMap.has(account.id)) {
          return { ...account, cardDetails: cardDetailsMap.get(account.id) };
        }
        return account;
      });
      
      res.json(accountsWithCards);
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') console.error("Error fetching accounts:", error);
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  app.get("/api/accounts/:id", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const account = await storage.getAccount(parseInt(req.params.id));
      if (account && account.userId === userId) {
        res.json(account);
      } else {
        res.status(404).json({ error: "Account not found" });
      }
    } catch (error) {
      console.error("Error fetching account:", error);
      res.status(500).json({ error: "Failed to fetch account" });
    }
  });

  app.post("/api/accounts", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { cardDetails: cardData, ...accountData } = req.body;
      const validatedData = insertAccountSchema.parse({ ...accountData, userId });
      const account = await storage.createAccount(validatedData);
      
      // If card details provided, save them
      if (cardData && (account.type === 'credit_card' || account.type === 'debit_card')) {
        const lastFourDigits = cardData.cardNumber.slice(-4);
        await storage.createCardDetails({
          accountId: account.id,
          cardNumber: cardData.cardNumber,
          lastFourDigits,
          expiryMonth: cardData.expiryMonth,
          expiryYear: cardData.expiryYear,
          cardholderName: cardData.cardholderName,
          cardType: cardData.cardType,
        });
      }
      
      res.status(201).json(account);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid account data" });
    }
  });

  app.patch("/api/accounts/:id", authenticateToken, async (req, res) => {
    try {
      const { cardDetails: cardData, ...accountData } = req.body;
      const account = await storage.updateAccount(parseInt(req.params.id), accountData);
      if (account) {
        // Handle card details update
        if (cardData && (account.type === 'credit_card' || account.type === 'debit_card')) {
          const existingCard = await storage.getCardDetails(account.id);
          const lastFourDigits = cardData.cardNumber.slice(-4);
          
          if (existingCard) {
            await storage.updateCardDetails(existingCard.id, {
              cardNumber: cardData.cardNumber,
              lastFourDigits,
              expiryMonth: cardData.expiryMonth,
              expiryYear: cardData.expiryYear,
              cardholderName: cardData.cardholderName,
              cardType: cardData.cardType,
            });
          } else {
            await storage.createCardDetails({
              accountId: account.id,
              cardNumber: cardData.cardNumber,
              lastFourDigits,
              expiryMonth: cardData.expiryMonth,
              expiryYear: cardData.expiryYear,
              cardholderName: cardData.cardholderName,
              cardType: cardData.cardType,
            });
          }
        }
        res.json(account);
      } else {
        res.status(404).json({ error: "Account not found" });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid account data" });
    }
  });

  app.delete("/api/accounts/:id", authenticateToken, async (req, res) => {
    try {
      const deleted = await storage.deleteAccount(parseInt(req.params.id));
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Account not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  // ========== Transactions ==========
  app.get("/api/transactions", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { accountId, categoryId, startDate, endDate, search, limit } = req.query;
      
      const filters: any = { userId };
      if (accountId) filters.accountId = parseInt(accountId as string);
      if (categoryId) filters.categoryId = parseInt(categoryId as string);
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);
      if (search) filters.search = search as string;
      if (limit) filters.limit = parseInt(limit as string);

      const transactions = await storage.getAllTransactions(filters);
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  app.get("/api/transactions/:id", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const transaction = await storage.getTransaction(parseInt(req.params.id));
      if (transaction && transaction.userId === userId) {
        res.json(transaction);
      } else {
        res.status(404).json({ error: "Transaction not found" });
      }
    } catch (error) {
      console.error("Error fetching transaction:", error);
      res.status(500).json({ error: "Failed to fetch transaction" });
    }
  });

  // ========== Statement Import ==========
  
  // Parse PDF bank statement and extract transactions
  app.post("/api/import/parse-pdf", authenticateToken, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No PDF file uploaded" });
      }

      console.log("📄 Parsing PDF statement:", req.file.originalname, "Size:", req.file.size);

      // Get password from request body (for password-protected PDFs)
      const password = req.body?.password || undefined;

      // Extract text from PDF (with optional password)
      let pdfText: string;
      try {
        const pdfOptions: any = { data: req.file.buffer };
        if (password) {
          pdfOptions.password = password;
          console.log("🔐 Using password for encrypted PDF");
        }
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse(pdfOptions);
        const textResult = await parser.getText();
        pdfText = textResult.text || '';
        await parser.destroy();
      } catch (pdfError: any) {
        if (pdfError.message?.includes('password') || pdfError.message?.includes('encrypted')) {
          return res.status(400).json({ 
            error: "This PDF is password-protected. Please provide the password.",
            requiresPassword: true
          });
        }
        throw pdfError;
      }
      
      console.log("📝 Extracted text length:", pdfText.length);

      if (!pdfText || pdfText.trim().length < 100) {
        return res.status(400).json({ 
          error: "Could not extract text from PDF. Please ensure it's a text-based PDF, not a scanned image." 
        });
      }

      // Use AI to parse transactions from the text
      const result = await parseStatementPDF(pdfText);

      if (result.error) {
        return res.status(400).json({ error: result.error });
      }

      console.log("✅ Extracted", result.transactions.length, "transactions from statement");

      res.json({
        transactions: result.transactions,
        accountNumber: result.accountNumber,
        bankName: result.bankName,
        statementPeriod: result.statementPeriod,
        totalTransactions: result.transactions.length
      });
    } catch (error: any) {
      console.error("PDF parsing error:", error);
      res.status(500).json({ error: error.message || "Failed to parse PDF" });
    }
  });

  // Bulk import transactions (with duplicate detection)
  app.post("/api/import/transactions", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { transactions, accountId, skipDuplicates = true } = req.body;

      if (!Array.isArray(transactions) || transactions.length === 0) {
        return res.status(400).json({ error: "No transactions to import" });
      }

      if (!accountId) {
        return res.status(400).json({ error: "Account ID is required" });
      }

      // Verify account belongs to user (security check)
      const account = await storage.getAccount(accountId);
      if (!account || account.userId !== userId) {
        return res.status(403).json({ error: "Account not found or access denied" });
      }

      console.log("📥 Importing", transactions.length, "transactions for account", accountId);

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      // Prefetch existing transactions once for duplicate detection (O(1) lookup)
      let existingTxKeys = new Set<string>();
      if (skipDuplicates) {
        const existingTransactions = await storage.getAllTransactions({ accountId });
        existingTransactions.forEach((existing: any) => {
          // Create a normalized key: date (YYYY-MM-DD) + amount + type
          const existingDate = new Date(existing.transactionDate).toISOString().split('T')[0];
          const key = `${existingDate}|${parseFloat(existing.amount).toFixed(2)}|${existing.type}`;
          existingTxKeys.add(key);
        });
      }

      for (const tx of transactions) {
        try {
          // Check for duplicates using precomputed set
          if (skipDuplicates) {
            const txDate = new Date(tx.date).toISOString().split('T')[0];
            const txKey = `${txDate}|${tx.amount.toFixed(2)}|${tx.type}`;
            
            if (existingTxKeys.has(txKey)) {
              skipped++;
              continue;
            }
            // Add to set to prevent importing same tx twice from statement
            existingTxKeys.add(txKey);
          }

          // Get category suggestion
          const categoryName = await suggestCategory(tx.description);
          const categories = await storage.getAllCategories();
          const category = categories.find((c: any) => c.name === categoryName);

          // Create the transaction
          await storage.createTransaction({
            userId,
            accountId,
            categoryId: category?.id || null,
            amount: tx.amount.toString(),
            type: tx.type,
            description: tx.description,
            referenceNumber: tx.referenceNumber || null,
            transactionDate: tx.date,
            merchant: null,
            smsId: null,
            isRecurring: false,
            toAccountId: null,
            savingsContributionId: null,
            paymentOccurrenceId: null
          });

          imported++;
        } catch (txError: any) {
          errors.push(`Transaction on ${tx.date}: ${txError.message}`);
        }
      }

      console.log("✅ Import complete:", imported, "imported,", skipped, "skipped");

      res.json({
        success: true,
        imported,
        skipped,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error: any) {
      console.error("Bulk import error:", error);
      res.status(500).json({ error: error.message || "Failed to import transactions" });
    }
  });

  app.post("/api/transactions", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      console.log("🔍 [transactions] POST Request Debug:");
      console.log("  User ID:", userId);
      console.log("  Raw request body:", JSON.stringify(req.body, null, 2));
      
      const transactionData = { ...req.body, userId };
      console.log("  Transaction data with userId:", JSON.stringify(transactionData, null, 2));
      
      const validatedData = insertTransactionSchema.parse(transactionData);
      console.log("  ✅ Validation passed, creating transaction...");
      
      const transaction = await storage.createTransaction(validatedData);
      console.log("  ✅ Transaction created successfully:", transaction.id);
      
      res.status(201).json(transaction);
    } catch (error: any) {
      console.error("❌ [transactions] POST Error:");
      console.error("  Error type:", error.constructor.name);
      console.error("  Error message:", error.message);
      
      if (error.name === 'ZodError') {
        console.error("  🔴 Zod Validation Errors:");
        error.issues?.forEach((issue: any, index: number) => {
          console.error(`    ${index + 1}. Path: ${issue.path.join('.')}`);
          console.error(`       Code: ${issue.code}`);
          console.error(`       Message: ${issue.message}`);
          if (issue.received !== undefined) {
            console.error(`       Received: ${JSON.stringify(issue.received)}`);
          }
          if (issue.expected !== undefined) {
            console.error(`       Expected: ${issue.expected}`);
          }
        });
        
        return res.status(400).json({ 
          error: "Validation failed", 
          details: error.issues.map((issue: any) => ({
            field: issue.path.join('.'),
            code: issue.code,
            message: issue.message,
            received: issue.received,
            expected: issue.expected
          }))
        });
      }
      
      console.error("  Full error:", error);
      res.status(400).json({ error: error.message || "Invalid transaction data" });
    }
  });

  app.patch("/api/transactions/:id", authenticateToken, async (req, res) => {
    try {
      const transactionId = parseInt(req.params.id);
      const transaction = await storage.getTransaction(transactionId);
      
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      // Check if this transaction is linked to a savings contribution
      if (transaction.savingsContributionId) {
        return res.status(400).json({ 
          error: "Cannot edit savings contribution transaction",
          isSavingsContribution: true,
          message: "This transaction is part of a savings contribution and cannot be edited directly."
        });
      }

      const validatedData = insertTransactionSchema.partial().parse(req.body);
      const updated = await storage.updateTransaction(transactionId, validatedData);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid transaction data" });
    }
  });

  app.delete("/api/transactions/:id", authenticateToken, async (req, res) => {
    try {
      const transactionId = parseInt(req.params.id);
      const transaction = await storage.getTransaction(transactionId);
      
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      
      // Check if this transaction is linked to a savings contribution
      if (transaction.savingsContributionId) {
        // Get all transactions linked to this contribution (both debit and credit)
        const allTransactions = await storage.getAllTransactions({});
        const linkedTransactions = allTransactions.filter(
          (t: any) => t.savingsContributionId === transaction.savingsContributionId
        );
        
        // Delete all linked transactions
        for (const linkedTx of linkedTransactions) {
          if (linkedTx.id !== transactionId) {
            await storage.deleteTransaction(linkedTx.id);
          }
        }
        
        // Delete the savings contribution
        const contribution = await storage.getSavingsContribution(transaction.savingsContributionId);
        if (contribution) {
          // Delete the contribution (this will also update the goal's currentAmount)
          await storage.deleteSavingsContribution(contribution.id);
        }
      }
      
      // Check if this transaction is linked to a payment occurrence
      if (transaction.paymentOccurrenceId) {
        // Update the payment occurrence status back to pending
        await storage.updatePaymentOccurrence(transaction.paymentOccurrenceId, { status: 'pending' });
      }
      
      // If this transaction was created from SMS, clear the transactionId reference in the SMS log
      if (transaction.smsId) {
        await storage.clearSmsLogTransaction(transaction.smsId);
      }
      
      // Delete the transaction (this will restore the account balance)
      const deleted = await storage.deleteTransaction(transactionId);
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Transaction not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete transaction" });
    }
  });

  // ========== Budgets ==========
  app.get("/api/budgets", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { month, year } = req.query;
      const filters: any = { userId };
      if (month) filters.month = parseInt(month as string);
      if (year) filters.year = parseInt(year as string);

      const budgets = await storage.getAllBudgets(filters);
      res.json(budgets);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch budgets" });
    }
  });

  app.post("/api/budgets", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      console.log("🔍 [budgets] POST Request Debug:");
      console.log("  User ID:", userId);
      console.log("  Raw request body:", JSON.stringify(req.body, null, 2));
      
      const budgetData = { ...req.body, userId };
      console.log("  Budget data with userId:", JSON.stringify(budgetData, null, 2));
      
      const validatedData = insertBudgetSchema.parse(budgetData);
      console.log("  ✅ Validation passed, creating budget...");
      
      const budget = await storage.createBudget(validatedData);
      console.log("  ✅ Budget created successfully:", budget.id);
      
      res.status(201).json(budget);
    } catch (error: any) {
      console.error("❌ [budgets] POST Error:");
      console.error("  Error type:", error.constructor.name);
      console.error("  Error message:", error.message);
      
      if (error.name === 'ZodError') {
        console.error("  🔴 Zod Validation Errors:");
        error.issues?.forEach((issue: any, index: number) => {
          console.error(`    ${index + 1}. Path: ${issue.path.join('.')}`);
          console.error(`       Code: ${issue.code}`);
          console.error(`       Message: ${issue.message}`);
          if (issue.received !== undefined) {
            console.error(`       Received: ${JSON.stringify(issue.received)}`);
          }
          if (issue.expected !== undefined) {
            console.error(`       Expected: ${issue.expected}`);
          }
        });
        
        return res.status(400).json({ 
          error: "Validation failed", 
          details: error.issues.map((issue: any) => ({
            field: issue.path.join('.'),
            code: issue.code,
            message: issue.message,
            received: issue.received,
            expected: issue.expected
          }))
        });
      }
      
      console.error("  Full error:", error);
      res.status(400).json({ error: error.message || "Invalid budget data" });
    }
  });

  app.patch("/api/budgets/:id", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const budgetId = parseInt(req.params.id);
      
      // First verify the budget belongs to the user
      const existingBudget = await storage.getBudget(budgetId);
      if (!existingBudget || existingBudget.userId !== userId) {
        return res.status(404).json({ error: "Budget not found" });
      }
      
      const budget = await storage.updateBudget(budgetId, req.body);
      if (budget) {
        res.json(budget);
      } else {
        res.status(404).json({ error: "Budget not found" });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid budget data" });
    }
  });

  app.delete("/api/budgets/:id", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const budgetId = parseInt(req.params.id);
      
      // First verify the budget belongs to the user
      const existingBudget = await storage.getBudget(budgetId);
      if (!existingBudget || existingBudget.userId !== userId) {
        return res.status(404).json({ error: "Budget not found" });
      }
      
      const deleted = await storage.deleteBudget(budgetId);
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Budget not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete budget" });
    }
  });

  // ========== Scheduled Payments ==========
  app.get("/api/scheduled-payments", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const payments = await storage.getAllScheduledPayments(userId);
      res.json(payments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scheduled payments" });
    }
  });

  app.get("/api/scheduled-payments/:id", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const payment = await storage.getScheduledPayment(parseInt(req.params.id));
      if (payment && payment.userId === userId) {
        res.json(payment);
      } else {
        res.status(404).json({ error: "Scheduled payment not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scheduled payment" });
    }
  });

  // Calculate billing cycle amount for credit card bills
  app.get("/api/scheduled-payments/:id/billing-amount", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const paymentId = parseInt(req.params.id);
      const payment = await storage.getScheduledPayment(paymentId);

      if (!payment || payment.userId !== userId) {
        return res.status(404).json({ error: "Scheduled payment not found" });
      }

      if (payment.paymentType !== 'credit_card_bill' || !payment.creditCardAccountId) {
        return res.status(400).json({ error: "Not a credit card bill scheduled payment" });
      }

      // Get the credit card account
      const creditCardAccount = await storage.getAccount(payment.creditCardAccountId);
      if (!creditCardAccount || !creditCardAccount.billingDate) {
        return res.status(400).json({ error: "Credit card account not found or has no billing date" });
      }

      // Import the getCreditCardBillingCycle function
      const { getCreditCardBillingCycle } = await import('./salaryUtils');
      const { cycleStart, cycleEnd, cycleLabel } = getCreditCardBillingCycle(new Date(), creditCardAccount.billingDate);

      // Get all transactions for the credit card in this billing cycle
      const transactions = await storage.getAllTransactions({
        accountId: payment.creditCardAccountId,
        startDate: cycleStart,
        endDate: cycleEnd,
      });

      // Sum debit transactions (spending)
      const calculatedAmount = transactions
        .filter(t => t.type === 'debit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);

      res.json({
        calculatedAmount: calculatedAmount.toFixed(2),
        cycleStart: cycleStart.toISOString(),
        cycleEnd: cycleEnd.toISOString(),
        cycleLabel,
        transactionCount: transactions.length,
      });
    } catch (error) {
      console.error("Error calculating billing amount:", error);
      res.status(500).json({ error: "Failed to calculate billing amount" });
    }
  });

  app.post("/api/scheduled-payments", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      console.log("🔍 [scheduled-payments] POST Request Debug:");
      console.log("  User ID:", userId);
      console.log("  Raw request body:", JSON.stringify(req.body, null, 2));
      
      const paymentData = { ...req.body, userId };
      console.log("  Payment data with userId:", JSON.stringify(paymentData, null, 2));
      
      const validatedData = insertScheduledPaymentSchema.parse(paymentData);
      console.log("  ✅ Validation passed, creating scheduled payment...");
      
      const payment = await storage.createScheduledPayment(validatedData);
      console.log("  ✅ Scheduled payment created successfully:", payment.id);

      // Day-interval payments (e.g. phone recharge every 84 days) aren't picked up by the
      // month-batch generator — create the first occurrence directly, anchored off the date
      // the user says they last paid/recharged.
      if (payment.frequency === 'day_interval' && payment.customIntervalDays) {
        const anchorDate = req.body.lastPaidDate ? new Date(req.body.lastPaidDate) : new Date();
        const dueDateObj = new Date(anchorDate.getTime() + payment.customIntervalDays * 24 * 60 * 60 * 1000);
        await storage.createPaymentOccurrence({
          scheduledPaymentId: payment.id,
          month: dueDateObj.getMonth() + 1,
          year: dueDateObj.getFullYear(),
          dueDate: dueDateObj,
          status: 'pending',
        });
      }

      res.status(201).json(payment);
    } catch (error: any) {
      console.error("❌ [scheduled-payments] POST Error:");
      console.error("  Error type:", error.constructor.name);
      console.error("  Error message:", error.message);
      
      if (error.name === 'ZodError') {
        console.error("  🔴 Zod Validation Errors:");
        error.issues?.forEach((issue: any, index: number) => {
          console.error(`    ${index + 1}. Path: ${issue.path.join('.')}`);
          console.error(`       Code: ${issue.code}`);
          console.error(`       Message: ${issue.message}`);
          if (issue.received !== undefined) {
            console.error(`       Received: ${JSON.stringify(issue.received)}`);
          }
          if (issue.expected !== undefined) {
            console.error(`       Expected: ${issue.expected}`);
          }
        });
        
        return res.status(400).json({ 
          error: "Validation failed", 
          details: error.issues.map((issue: any) => ({
            field: issue.path.join('.'),
            code: issue.code,
            message: issue.message,
            received: issue.received,
            expected: issue.expected
          }))
        });
      }
      
      console.error("  Full error:", error);
      res.status(400).json({ error: error.message || "Invalid payment data" });
    }
  });

  app.patch("/api/scheduled-payments/:id", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const paymentId = parseInt(req.params.id);
      
      // First verify the payment belongs to the user
      const existingPayment = await storage.getScheduledPayment(paymentId);
      if (!existingPayment || existingPayment.userId !== userId) {
        return res.status(404).json({ error: "Scheduled payment not found" });
      }
      
      const payment = await storage.updateScheduledPayment(paymentId, req.body);
      if (payment) {
        res.json(payment);
      } else {
        res.status(404).json({ error: "Scheduled payment not found" });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid payment data" });
    }
  });

  app.delete("/api/scheduled-payments/:id", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const paymentId = parseInt(req.params.id);
      
      // First verify the payment belongs to the user
      const existingPayment = await storage.getScheduledPayment(paymentId);
      if (!existingPayment || existingPayment.userId !== userId) {
        return res.status(404).json({ error: "Scheduled payment not found" });
      }
      
      const deleted = await storage.deleteScheduledPayment(paymentId);
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Scheduled payment not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete scheduled payment" });
    }
  });

  // ========== Payment Occurrences (Monthly Checklist) ==========
  app.get("/api/payment-occurrences", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { month, year } = req.query;
      const filters: any = { userId };
      if (month) filters.month = parseInt(month as string);
      if (year) filters.year = parseInt(year as string);

      const occurrences = await storage.getPaymentOccurrences(filters);
      res.json(occurrences);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch payment occurrences" });
    }
  });

  // ========== Credit Card Bills ==========
  app.get("/api/credit-card-bills", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const bills = await storage.getCreditCardBills();
      res.json(bills);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch credit card bills" });
    }
  });

  // ========== Credit Card Statements ==========
  app.get("/api/credit-card-statements/:accountId", authenticateToken, async (req, res) => {
    try {
      const accountId = parseInt(req.params.accountId);
      const statements = await storage.getCreditCardStatements(accountId);
      res.json(statements);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch credit card statements" });
    }
  });

  app.get("/api/credit-card-statement/:id", authenticateToken, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const statement = await storage.getCreditCardStatement(id);
      if (statement) {
        res.json(statement);
      } else {
        res.status(404).json({ error: "Statement not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch statement" });
    }
  });

  app.post("/api/credit-card-statements/:accountId/current", authenticateToken, async (req, res) => {
    try {
      const accountId = parseInt(req.params.accountId);
      const statement = await storage.getOrCreateCurrentStatement(accountId);
      res.json(statement);
    } catch (error) {
      res.status(500).json({ error: "Failed to get/create statement" });
    }
  });

  app.post("/api/credit-card-statements/:id/payment", authenticateToken, async (req, res) => {
    try {
      const statementId = parseInt(req.params.id);
      const { amount, paidDate } = req.body;
      
      if (!amount || amount <= 0) {
        res.status(400).json({ error: "Valid payment amount is required" });
        return;
      }

      const statement = await storage.recordCreditCardPayment(
        statementId, 
        parseFloat(amount), 
        paidDate ? new Date(paidDate) : new Date()
      );

      if (statement) {
        res.json(statement);
      } else {
        res.status(404).json({ error: "Statement not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to record payment" });
    }
  });

  app.post("/api/payment-occurrences/generate", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { month, year } = req.body;
      if (!month || !year) {
        res.status(400).json({ error: "Month and year are required" });
        return;
      }
      const occurrences = await storage.generatePaymentOccurrencesForMonth(month, year, userId);
      res.json(occurrences);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate payment occurrences" });
    }
  });

  app.patch("/api/payment-occurrences/:id", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const occurrenceId = parseInt(req.params.id);
      const { affectTransaction, affectAccountBalance, ...otherData } = req.body;
      
      // Get current occurrence and verify user ownership
      const currentOccurrence = await storage.getPaymentOccurrence(occurrenceId);
      if (!currentOccurrence) {
        return res.status(404).json({ error: "Payment occurrence not found" });
      }

      // Get scheduled payment details and verify user ownership
      const payment = await storage.getScheduledPayment(currentOccurrence.scheduledPaymentId);
      if (!payment || payment.userId !== userId) {
        return res.status(404).json({ error: "Scheduled payment not found" });
      }

      // Handle affectTransaction toggle change
      if (affectTransaction !== undefined && affectTransaction !== currentOccurrence.affectTransaction) {
        if (affectTransaction && currentOccurrence.status === 'paid') {
          // Create transaction when toggle is enabled
          const account = await storage.getDefaultAccount();
          if (account && payment.amount) {
            await storage.createTransaction({
              userId: userId,
              type: 'debit',
              amount: payment.amount,
              merchant: payment.name,
              description: `Scheduled payment: ${payment.name}`,
              categoryId: payment.categoryId || null,
              accountId: account.id,
              transactionDate: (currentOccurrence.paidAt || currentOccurrence.dueDate).toISOString(),
              paymentOccurrenceId: occurrenceId,
            });
          }
        } else if (!affectTransaction) {
          // Delete transaction when toggle is disabled
          const transactions = await storage.getAllTransactions({});
          const matchingTransaction = transactions.find((t: any) => 
            t.paymentOccurrenceId === occurrenceId
          );
          if (matchingTransaction) {
            await storage.deleteTransaction(matchingTransaction.id);
          }
        }
      }

      // Handle affectAccountBalance toggle change
      if (affectAccountBalance !== undefined && affectAccountBalance !== currentOccurrence.affectAccountBalance) {
        const transactions = await storage.getAllTransactions({});
        const matchingTransaction = transactions.find((t: any) => 
          t.paymentOccurrenceId === occurrenceId
        );
        
        if (matchingTransaction && matchingTransaction.accountId && payment.amount) {
          const account = await storage.getAccount(matchingTransaction.accountId);
          if (account) {
            const amount = parseFloat(payment.amount);
            if (!affectAccountBalance) {
              // Restore balance when toggle is disabled (add back the payment amount)
              const newBalance = (parseFloat(account.balance || '0') + amount).toString();
              await storage.updateAccount(account.id, { balance: newBalance });
            } else if (affectAccountBalance && !currentOccurrence.affectAccountBalance) {
              // Deduct balance when toggle is re-enabled
              const newBalance = (parseFloat(account.balance || '0') - amount).toString();
              await storage.updateAccount(account.id, { balance: newBalance });
            }
          }
        }
      }

      // Variable-amount bills (e.g. electricity) can't be marked paid until this cycle's
      // actual amount is known — enforced here, not just via the disabled checkbox client-side.
      const effectiveAmount = otherData.amount ?? currentOccurrence.amount ?? payment.amount;
      if (otherData.status === 'paid' && payment.variableAmount && !effectiveAmount) {
        return res.status(400).json({ error: "Enter this cycle's amount before marking it paid" });
      }

      // Update occurrence with new toggle states
      const updateData: any = {
        ...otherData,
        ...(affectTransaction !== undefined && { affectTransaction }),
        ...(affectAccountBalance !== undefined && { affectAccountBalance }),
      };

      if (otherData.status === 'paid' && updateData.paidAmount === undefined && effectiveAmount) {
        updateData.paidAmount = effectiveAmount;
      }

      const occurrence = await storage.updatePaymentOccurrence(occurrenceId, updateData);

      // Day-interval payments (e.g. phone recharge every 84 days) have no fixed day-of-month —
      // the next occurrence rolls forward from the actual paid date, created right here rather
      // than by the month-batch generator (which explicitly skips this frequency).
      const isNewlyPaid = otherData.status === 'paid' && currentOccurrence.status !== 'paid';
      if (occurrence && isNewlyPaid && payment.frequency === 'day_interval' && payment.customIntervalDays) {
        const anchorDate = occurrence.paidAt ? new Date(occurrence.paidAt) : new Date();
        const dueDateObj = new Date(anchorDate.getTime() + payment.customIntervalDays * 24 * 60 * 60 * 1000);
        await storage.createPaymentOccurrence({
          scheduledPaymentId: payment.id,
          month: dueDateObj.getMonth() + 1,
          year: dueDateObj.getFullYear(),
          dueDate: dueDateObj,
          status: 'pending',
        });
      }

      if (occurrence) {
        res.json(occurrence);
      } else {
        res.status(404).json({ error: "Payment occurrence not found" });
      }
    } catch (error) {
      console.error("Error updating payment occurrence:", error);
      res.status(500).json({ error: "Failed to update payment occurrence" });
    }
  });

  // ========== Savings Goals ==========
  app.get("/api/savings-goals", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const goals = await storage.getAllSavingsGoals(userId);
      res.json(goals);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch savings goals" });
    }
  });

  app.get("/api/savings-goals/:id", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const goal = await storage.getSavingsGoal(parseInt(req.params.id));
      if (goal && goal.userId === userId) {
        res.json(goal);
      } else {
        res.status(404).json({ error: "Savings goal not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch savings goal" });
    }
  });

  app.post("/api/savings-goals", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      console.log("🔍 [savings-goals] POST Request Debug:");
      console.log("  User ID:", userId);
      console.log("  Raw request body:", JSON.stringify(req.body, null, 2));
      
      const goalData = { ...req.body, userId };
      console.log("  Goal data with userId:", JSON.stringify(goalData, null, 2));
      
      const validatedData = insertSavingsGoalSchema.parse(goalData);
      console.log("  ✅ Validation passed, creating savings goal...");
      console.log("  📊 Monthly Expected Amount from validation:", validatedData.monthlyExpectedAmount);
      
      // Convert date strings to Date objects for Drizzle
      const goalToCreate = {
        ...validatedData,
        startDate: new Date(validatedData.startDate),
        targetDate: new Date(validatedData.targetDate),
      };
      
      console.log("  📊 Monthly Expected Amount before DB insert:", goalToCreate.monthlyExpectedAmount);
      const goal = await storage.createSavingsGoal(goalToCreate);
      console.log("  ✅ Savings goal created successfully:", goal.id);
      console.log("  📊 Monthly Expected Amount in created goal:", goal.monthlyExpectedAmount);
      
      res.status(201).json(goal);
    } catch (error: any) {
      console.error("❌ [savings-goals] POST Error:");
      console.error("  Error type:", error.constructor.name);
      console.error("  Error message:", error.message);
      
      if (error.name === 'ZodError') {
        console.error("  🔴 Zod Validation Errors:");
        error.issues?.forEach((issue: any, index: number) => {
          console.error(`    ${index + 1}. Path: ${issue.path.join('.')}`);
          console.error(`       Code: ${issue.code}`);
          console.error(`       Message: ${issue.message}`);
          if (issue.received !== undefined) {
            console.error(`       Received: ${JSON.stringify(issue.received)}`);
          }
          if (issue.expected !== undefined) {
            console.error(`       Expected: ${issue.expected}`);
          }
        });
        
        return res.status(400).json({ 
          error: "Validation failed", 
          details: error.issues.map((issue: any) => ({
            field: issue.path.join('.'),
            code: issue.code,
            message: issue.message,
            received: issue.received,
            expected: issue.expected
          }))
        });
      }
      
      console.error("  Full error:", error);
      res.status(400).json({ error: error.message || "Invalid savings goal data" });
    }
  });

  app.patch("/api/savings-goals/:id", authenticateToken, async (req, res) => {
    try {
      console.log("🔍 [PATCH savings-goals] Request body:", JSON.stringify(req.body, null, 2));
      console.log("  📊 Monthly Expected Amount received:", req.body.monthlyExpectedAmount);
      
      // Convert date strings to Date objects if present
      const updateData = { ...req.body };
      if (updateData.startDate && typeof updateData.startDate === 'string') {
        updateData.startDate = new Date(updateData.startDate);
      }
      if (updateData.targetDate && typeof updateData.targetDate === 'string') {
        updateData.targetDate = new Date(updateData.targetDate);
      }
      
      console.log("  📊 Monthly Expected Amount before DB update:", updateData.monthlyExpectedAmount);
      const goal = await storage.updateSavingsGoal(parseInt(req.params.id), updateData);
      if (goal) {
        console.log("  ✅ Goal updated successfully");
        console.log("  📊 Monthly Expected Amount in updated goal:", goal.monthlyExpectedAmount);
        res.json(goal);
      } else {
        res.status(404).json({ error: "Savings goal not found" });
      }
    } catch (error) {
      console.error('[PATCH /api/savings-goals/:id] Error:', error);
      res.status(500).json({ error: "Failed to update savings goal" });
    }
  });

  app.delete("/api/savings-goals/:id", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const goalId = parseInt(req.params.id);
      
      // First verify the goal belongs to the user
      const existingGoal = await storage.getSavingsGoal(goalId);
      if (!existingGoal || existingGoal.userId !== userId) {
        return res.status(404).json({ error: "Savings goal not found" });
      }
      
      const deleted = await storage.deleteSavingsGoal(goalId);
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Savings goal not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete savings goal" });
    }
  });

  // ========== Savings Contributions ==========
  app.get("/api/savings-goals/:goalId/contributions", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const goalId = parseInt(req.params.goalId);
      
      // First verify the goal belongs to the user
      const goal = await storage.getSavingsGoal(goalId);
      if (!goal || goal.userId !== userId) {
        return res.status(404).json({ error: "Savings goal not found" });
      }
      
      const contributions = await storage.getSavingsContributions(goalId);
      res.json(contributions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch contributions" });
    }
  });

  app.post("/api/savings-goals/:goalId/contributions", authenticateToken, async (req, res) => {
    try {
      const goalId = parseInt(req.params.goalId);
      
      // Get the goal to use its configured accounts and toggle settings
      const goal = await storage.getSavingsGoal(goalId);
      if (!goal) {
        return res.status(404).json({ error: "Savings goal not found" });
      }
      
      const validatedData = insertSavingsContributionSchema.parse({
        ...req.body,
        savingsGoalId: goalId,
        accountId: goal.accountId, // Use accountId from goal configuration
      });
      
      // Create the contribution
      const contribution = await storage.createSavingsContribution(validatedData);
      
      // Get toggle settings from request body (override goal settings for this contribution only)
      // Default to goal settings if not provided in request
      const affectTransaction = req.body.createTransaction !== undefined 
        ? req.body.createTransaction 
        : (goal.affectTransaction ?? true);
      const affectAccountBalance = req.body.affectBalance !== undefined 
        ? req.body.affectBalance 
        : (goal.affectAccountBalance ?? true);
      
      // Handle transaction and balance updates based on toggle settings
      if (affectTransaction && goal.accountId && goal.toAccountId) {
        // When both from and to accounts are specified, create a single transfer transaction
        await storage.createTransaction({
          userId: goal.userId,
          accountId: goal.accountId,
          toAccountId: goal.toAccountId,
          categoryId: null,
          amount: validatedData.amount,
          type: "transfer",
          description: `Contribution to ${goal.name}`,
          transactionDate: validatedData.contributedAt || new Date().toISOString(),
          savingsContributionId: contribution.id,
        });
        
        // If affectAccountBalance is false, reverse both balance changes
        if (!affectAccountBalance) {
          // Reverse from account balance change
          const fromAccount = await storage.getAccount(goal.accountId);
          if (fromAccount) {
            const currentBalance = parseFloat(fromAccount.balance || '0');
            const contributionAmount = parseFloat(validatedData.amount);
            // Add amount back to reverse the debit
            await storage.updateAccount(goal.accountId, {
              balance: (currentBalance + contributionAmount).toString()
            });
          }
          
          // Reverse to account balance change
          const toAccount = await storage.getAccount(goal.toAccountId);
          if (toAccount) {
            const currentBalance = parseFloat(toAccount.balance || '0');
            const contributionAmount = parseFloat(validatedData.amount);
            // Subtract amount back to reverse the credit
            await storage.updateAccount(goal.toAccountId, {
              balance: (currentBalance - contributionAmount).toString()
            });
          }
        }
      } else if (affectTransaction && goal.accountId && !goal.toAccountId) {
        // Only from account specified, create a debit transaction
        const categories = await storage.getAllCategories();
        let savingsCategory = categories.find(c => c.name === "Savings");
        
        if (!savingsCategory) {
          savingsCategory = await storage.createCategory({
            name: "Savings",
            icon: "piggy-bank",
            color: "#10b981",
            type: "expense",
          });
        }
        
        await storage.createTransaction({
          userId: goal.userId,
          accountId: goal.accountId,
          categoryId: savingsCategory.id,
          amount: validatedData.amount,
          type: "debit",
          description: `Contribution to ${goal.name}`,
          transactionDate: validatedData.contributedAt || new Date().toISOString(),
          savingsContributionId: contribution.id,
        });
        
        // If affectAccountBalance is false, reverse the balance change
        if (!affectAccountBalance) {
          const account = await storage.getAccount(goal.accountId);
          if (account) {
            const currentBalance = parseFloat(account.balance || '0');
            const contributionAmount = parseFloat(validatedData.amount);
            // Add amount back to reverse the debit
            await storage.updateAccount(goal.accountId, {
              balance: (currentBalance + contributionAmount).toString()
            });
          }
        }
      } else if (affectTransaction && !goal.accountId && goal.toAccountId) {
        // Only to account specified, create a credit transaction
        const categories = await storage.getAllCategories();
        let savingsCategory = categories.find(c => c.name === "Savings");
        
        if (!savingsCategory) {
          savingsCategory = await storage.createCategory({
            name: "Savings",
            icon: "piggy-bank",
            color: "#10b981",
            type: "income",
          });
        }
        
        await storage.createTransaction({
          userId: goal.userId,
          accountId: goal.toAccountId,
          categoryId: savingsCategory.id,
          amount: validatedData.amount,
          type: "credit",
          description: `Contribution to ${goal.name}`,
          transactionDate: validatedData.contributedAt || new Date().toISOString(),
          savingsContributionId: contribution.id,
        });
        
        // If affectAccountBalance is false, reverse the balance change
        if (!affectAccountBalance) {
          const account = await storage.getAccount(goal.toAccountId);
          if (account) {
            const currentBalance = parseFloat(account.balance || '0');
            const contributionAmount = parseFloat(validatedData.amount);
            // Subtract amount back to reverse the credit
            await storage.updateAccount(goal.toAccountId, {
              balance: (currentBalance - contributionAmount).toString()
            });
          }
        }
      } else if (!affectTransaction && affectAccountBalance) {
        // No transaction, but directly update balances
        if (goal.accountId) {
          const account = await storage.getAccount(goal.accountId);
          if (account) {
            const currentBalance = parseFloat(account.balance || '0');
            const contributionAmount = parseFloat(validatedData.amount);
            // Subtract amount directly
            await storage.updateAccount(goal.accountId, {
              balance: (currentBalance - contributionAmount).toString()
            });
          }
        }
        
        if (goal.toAccountId) {
          const toAccount = await storage.getAccount(goal.toAccountId);
          if (toAccount) {
            const currentBalance = parseFloat(toAccount.balance || '0');
            const contributionAmount = parseFloat(validatedData.amount);
            // Add amount directly
            await storage.updateAccount(goal.toAccountId, {
              balance: (currentBalance + contributionAmount).toString()
            });
          }
        }
      }
      
      res.status(201).json(contribution);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid contribution data" });
    }
  });

  app.delete("/api/savings-contributions/:id", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const contributionId = parseInt(req.params.id);
      
      // Get contribution details before deleting
      const contribution = await storage.getSavingsContribution(contributionId);
      
      if (!contribution) {
        return res.status(404).json({ error: "Contribution not found" });
      }
      
      // Get the goal to access account configuration and verify user ownership
      const goal = await storage.getSavingsGoal(contribution.savingsGoalId);
      if (!goal || goal.userId !== userId) {
        return res.status(404).json({ error: "Savings goal not found" });
      }
      
      // Delete transactions associated with this contribution
      const transactionDescription = `Contribution to ${goal.name}`;
      
      // Check if it's a transfer transaction (both from and to accounts)
      if (contribution.accountId && goal.toAccountId) {
        // Find and delete the single transfer transaction
        const allTransactions = await storage.getAllTransactions({});
        
        const transferTransaction = allTransactions.find((t: any) => 
          t.description === transactionDescription && 
          parseFloat(t.amount) === parseFloat(contribution.amount) &&
          t.savingsContributionId === contribution.id &&
          t.type === 'transfer' &&
          t.accountId === contribution.accountId &&
          t.toAccountId === goal.toAccountId
        );
        
        if (transferTransaction) {
          await storage.deleteTransaction(transferTransaction.id);
        }
      } else {
        // Find and delete transaction from accountId (debit or credit)
        if (contribution.accountId) {
          const fromTransactions = await storage.getAllTransactions({
            accountId: contribution.accountId,
            search: transactionDescription,
          });
          
          const fromTransaction = fromTransactions.find((t: any) => 
            t.description === transactionDescription && 
            parseFloat(t.amount) === parseFloat(contribution.amount) &&
            t.savingsContributionId === contribution.id &&
            (t.type === 'debit' || t.type === 'credit')
          );
          
          if (fromTransaction) {
            await storage.deleteTransaction(fromTransaction.id);
          }
        }
        
        // Find and delete transaction to toAccountId (credit) if it exists and accountId is not set
        if (goal.toAccountId && !contribution.accountId) {
          const toTransactions = await storage.getAllTransactions({
            accountId: goal.toAccountId,
            search: transactionDescription,
          });
          
          const toTransaction = toTransactions.find((t: any) => 
            t.description === transactionDescription && 
            parseFloat(t.amount) === parseFloat(contribution.amount) &&
            t.savingsContributionId === contribution.id &&
            t.type === 'credit'
          );
          
          if (toTransaction) {
            await storage.deleteTransaction(toTransaction.id);
          }
        }
      }
      
      // Delete the contribution (this also updates the goal's currentAmount)
      const deleted = await storage.deleteSavingsContribution(contributionId);
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Contribution not found" });
      }
    } catch (error) {
      console.error("Error deleting contribution:", error);
      res.status(500).json({ error: "Failed to delete contribution" });
    }
  });

  // ========== Salary Profile ==========
  app.get("/api/salary-profile", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const profile = await storage.getSalaryProfile(userId);
      res.json(profile || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch salary profile" });
    }
  });

  app.post("/api/salary-profile", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const profileData = { ...req.body, userId };
      const validatedData = insertSalaryProfileSchema.parse(profileData);
      const profile = await storage.createSalaryProfile(validatedData);
      
      // Auto-generate past 3 months salary cycles
      const pastPaydays = getPastPaydays(
        profile.paydayRule || 'last_working_day',
        profile.fixedDay,
        profile.weekdayPreference,
        3
      );
      
      for (const payday of pastPaydays) {
        try {
          // Check if cycle already exists
          const existingCycles = await storage.getSalaryCycles(profile.id);
          const exists = existingCycles.some(c => c.month === payday.month && c.year === payday.year);
          
          if (!exists) {
            await storage.createSalaryCycle({
              salaryProfileId: profile.id,
              month: payday.month,
              year: payday.year,
              expectedPayDate: payday.date,
              expectedAmount: profile.monthlyAmount ?? undefined,
              actualPayDate: undefined,
              actualAmount: undefined,
            });
          }
        } catch (cycleError) {
          console.error('Error creating salary cycle:', cycleError);
        }
      }
      
      res.status(201).json(profile);
    } catch (error: any) {
      console.error("Salary profile creation error:", error);
      res.status(400).json({ error: error.message || "Invalid salary profile data" });
    }
  });

  app.patch("/api/salary-profile/:id", authenticateToken, async (req, res) => {
    try {
      const profile = await storage.updateSalaryProfile(parseInt(req.params.id), req.body);
      if (profile) {
        // Auto-generate past 3 months salary cycles if they don't exist
        const pastPaydays = getPastPaydays(
          profile.paydayRule || 'last_working_day',
          profile.fixedDay,
          profile.weekdayPreference,
          3
        );
        
        for (const payday of pastPaydays) {
          try {
            const existingCycles = await storage.getSalaryCycles(profile.id);
            const exists = existingCycles.some(c => c.month === payday.month && c.year === payday.year);
            
            if (!exists) {
              await storage.createSalaryCycle({
                salaryProfileId: profile.id,
                month: payday.month,
                year: payday.year,
                expectedPayDate: payday.date,
                expectedAmount: profile.monthlyAmount ?? undefined,
                actualPayDate: undefined,
                actualAmount: undefined,
              });
            }
          } catch (cycleError) {
            console.error('Error creating salary cycle:', cycleError);
          }
        }
        
        res.json(profile);
      } else {
        res.status(404).json({ error: "Salary profile not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to update salary profile" });
    }
  });

  app.get("/api/salary-profile/next-paydays", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const profile = await storage.getSalaryProfile(userId);
      if (!profile) {
        res.json([]);
        return;
      }
      const count = req.query.count ? parseInt(req.query.count as string) : 6;
      const calculatedPaydays = getNextPaydays(
        profile.paydayRule || 'last_working_day',
        profile.fixedDay,
        profile.weekdayPreference,
        count + 2
      );
      
      const cycles = await storage.getSalaryCycles(profile.id);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      
      const paydays = calculatedPaydays.map(payday => {
        const cycle = cycles.find(c => c.month === payday.month && c.year === payday.year);
        if (cycle && cycle.expectedPayDate) {
          return {
            ...payday,
            date: new Date(cycle.expectedPayDate),
            expectedAmount: cycle.expectedAmount,
            cycleId: cycle.id,
          };
        }
        return {
          ...payday,
          expectedAmount: profile.monthlyAmount,
        };
      });
      
      const futurePaydays = paydays.filter(p => {
        const payDate = new Date(p.date);
        payDate.setHours(0, 0, 0, 0);
        return payDate >= now;
      });
      
      res.json(futurePaydays.slice(0, count));
    } catch (error) {
      res.status(500).json({ error: "Failed to calculate next paydays" });
    }
  });

  // ========== Salary Cycles ==========
  app.get("/api/salary-cycles", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const profile = await storage.getSalaryProfile(userId);
      if (!profile) {
        res.json([]);
        return;
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const cycles = await storage.getSalaryCycles(profile.id, limit);
      res.json(cycles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch salary cycles" });
    }
  });

  app.post("/api/salary-cycles", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const profile = await storage.getSalaryProfile(userId);
      if (!profile) {
        res.status(400).json({ error: "Please create a salary profile first" });
        return;
      }
      const { month, year, expectedPayDate: customPayDate, expectedAmount: customAmount } = req.body;
      
      // Check if cycle already exists for this month/year
      const existingCycles = await storage.getSalaryCycles(profile.id);
      const existingCycle = existingCycles.find(c => c.month === month && c.year === year);
      
      if (existingCycle) {
        // Update existing cycle with custom values
        const updateData: any = {};
        if (customPayDate) {
          updateData.expectedPayDate = new Date(customPayDate);
        }
        if (customAmount) {
          updateData.expectedAmount = customAmount;
        }
        const updated = await storage.updateSalaryCycle(existingCycle.id, updateData);
        res.status(200).json(updated);
        return;
      }
      
      // Calculate default expected pay date if not provided
      const defaultPayDate = getPaydayForMonth(
        year,
        month,
        profile.paydayRule || 'last_working_day',
        profile.fixedDay,
        profile.weekdayPreference
      );
      
      // Use custom values if provided, otherwise use defaults
      const finalPayDate = customPayDate ? new Date(customPayDate) : defaultPayDate;
      const finalAmount = customAmount || profile.monthlyAmount || undefined;
      
      const validatedData = insertSalaryCycleSchema.parse({
        salaryProfileId: profile.id,
        month,
        year,
        expectedPayDate: finalPayDate,
        expectedAmount: finalAmount,
      });
      const cycle = await storage.createSalaryCycle(validatedData);
      res.status(201).json(cycle);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid salary cycle data" });
    }
  });

  app.patch("/api/salary-cycles/:id", authenticateToken, async (req, res) => {
    try {
      const cycleId = parseInt(req.params.id);
      const { markAsCredited, ...updateData } = req.body;
      
      // Get current cycle to check existing state
      const currentCycle = await storage.getSalaryCycle(cycleId);
      if (!currentCycle) {
        res.status(404).json({ error: "Salary cycle not found" });
        return;
      }

      // Get salary profile to get account info
      const userId = req.user!.userId;
      const profile = await storage.getSalaryProfile(userId);
      if (!profile || !profile.accountId) {
        res.status(400).json({ error: "Salary profile or account not configured" });
        return;
      }

      // Handle marking as credited/uncredited
      if (markAsCredited !== undefined) {
        if (markAsCredited && !currentCycle.transactionId) {
          // Create transaction
          if (!updateData.actualAmount || !updateData.actualPayDate) {
            res.status(400).json({ error: "Actual amount and date required to mark as credited" });
            return;
          }

          // Get or create Salary category
          let salaryCategory = await storage.getCategoryByName('Salary');
          if (!salaryCategory) {
            salaryCategory = await storage.createCategory({
              name: 'Salary',
              type: 'income',
              icon: 'wallet',
              color: '#10b981',
            });
          }

          // Create transaction
          const transaction = await storage.createTransaction({
            userId: userId,
            accountId: profile.accountId,
            categoryId: salaryCategory.id,
            type: 'credit',
            amount: updateData.actualAmount,
            transactionDate: new Date(updateData.actualPayDate).toISOString(),
            description: `Salary - ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][currentCycle.month - 1]} ${currentCycle.year}`,
          });

          // createTransaction already updates account balance automatically
          
          // Update cycle with transaction ID
          updateData.transactionId = transaction.id;
        } else if (!markAsCredited && currentCycle.transactionId) {
          // Delete transaction (this will automatically update account balance)
          await storage.deleteTransaction(currentCycle.transactionId);
          updateData.transactionId = null;
        }
      }

      // Update the cycle
      const cycle = await storage.updateSalaryCycle(cycleId, updateData);
      if (cycle) {
        res.json(cycle);
      } else {
        res.status(404).json({ error: "Salary cycle not found" });
      }
    } catch (error: any) {
      console.error("Error updating salary cycle:", error);
      res.status(500).json({ error: error.message || "Failed to update salary cycle" });
    }
  });

  // ========== Budget Summary ==========
  app.get("/api/budget-summary", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { month, year } = req.query;
      const currentMonth = month ? parseInt(month as string) : new Date().getMonth() + 1;
      const currentYear = year ? parseInt(year as string) : new Date().getFullYear();

      const budgets = await storage.getAllBudgets({ userId, month: currentMonth, year: currentYear });
      const categories = await storage.getAllCategories();
      
      const startOfMonth = new Date(currentYear, currentMonth - 1, 1);
      const endOfMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59);
      const transactions = await storage.getAllTransactions({
        userId,
        startDate: startOfMonth,
        endDate: endOfMonth,
      });

      const categorySpending = new Map<number, number>();
      for (const t of transactions.filter(t => t.type === 'debit')) {
        if (t.categoryId) {
          const current = categorySpending.get(t.categoryId) || 0;
          categorySpending.set(t.categoryId, current + parseFloat(t.amount));
        }
      }

      const summary = budgets.map(b => {
        const category = categories.find(c => c.id === b.categoryId);
        const spent = categorySpending.get(b.categoryId!) || 0;
        const budgetAmount = parseFloat(b.amount);
        return {
          budgetId: b.id,
          categoryId: b.categoryId,
          categoryName: category?.name || 'Unknown',
          categoryIcon: category?.icon,
          categoryColor: category?.color,
          budgetAmount,
          spentAmount: spent,
          remainingAmount: budgetAmount - spent,
          percentage: budgetAmount > 0 ? Math.round((spent / budgetAmount) * 100) : 0,
        };
      });

      const totalBudget = summary.reduce((sum, s) => sum + s.budgetAmount, 0);
      const totalSpent = summary.reduce((sum, s) => sum + s.spentAmount, 0);

      res.json({
        month: currentMonth,
        year: currentYear,
        totalBudget,
        totalSpent,
        totalRemaining: totalBudget - totalSpent,
        categories: summary,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch budget summary" });
    }
  });

  // ========== Dashboard ==========
  app.get("/api/dashboard", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const stats = await storage.getDashboardStats(userId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  app.get("/api/dashboard-summary", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      // Get salary profile to determine cycle dates
      const salaryProfile = await storage.getSalaryProfile(userId);
      let lastSalaryCycle = null;
      
      if (salaryProfile) {
        const recentCycles = await storage.getSalaryCycles(salaryProfile.id, 1);
        if (recentCycles.length > 0) {
          lastSalaryCycle = recentCycles[0];
        }
      }
      
      // Calculate cycle dates based on salary profile
      const { cycleStart, cycleEnd } = getCurrentCycleDates(salaryProfile, lastSalaryCycle, now);
      const startOfMonth = cycleStart;
      const endOfMonth = cycleEnd;

      const monthTransactions = await storage.getAllTransactions({
        userId,
        startDate: startOfMonth,
        endDate: endOfMonth,
      });

      const totalIncome = monthTransactions
        .filter(t => t.type === 'credit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);

      const totalSpent = monthTransactions
        .filter(t => t.type === 'debit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);

      const todayTransactions = monthTransactions
        .filter(t => new Date(t.transactionDate) >= startOfToday);
      const totalSpentToday = todayTransactions
        .filter(t => t.type === 'debit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);

      const allPayments = await storage.getAllScheduledPayments(userId);
      const activePayments = allPayments.filter(p => p.status === 'active');
      const today = now.getDate();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      const isPaymentDueThisMonth = (payment: any): boolean => {
        const frequency = payment.frequency || 'monthly';
        const startMonth = payment.startMonth;

        switch (frequency) {
          case 'monthly': return true;
          case 'quarterly': {
            if (startMonth) {
              const quarterMonths = [startMonth];
              for (let i = 1; i < 4; i++) {
                quarterMonths.push(((startMonth - 1 + i * 3) % 12) + 1);
              }
              return quarterMonths.includes(currentMonth);
            }
            return [1, 4, 7, 10].includes(currentMonth);
          }
          case 'half_yearly': {
            if (startMonth) {
              return currentMonth === startMonth || currentMonth === ((startMonth + 5) % 12) + 1;
            }
            return currentMonth === 1 || currentMonth === 7;
          }
          case 'yearly':
            return startMonth ? currentMonth === startMonth : currentMonth === 1;
          case 'custom': {
            if (payment.customIntervalMonths && payment.customIntervalMonths > 0) {
              const interval = payment.customIntervalMonths;
              const refMonth = startMonth || ((payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt)).getMonth() + 1);
              const refYear = (payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt)).getFullYear();
              const totalMonthsDiff = (currentYear - refYear) * 12 + (currentMonth - refMonth);
              return totalMonthsDiff >= 0 && totalMonthsDiff % interval === 0;
            }
            return true;
          }
          case 'one_time': {
            if (startMonth && startMonth === currentMonth) {
              const createdYear = (payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt)).getFullYear();
              return createdYear === currentYear || !payment.createdAt;
            }
            return false;
          }
          default: return true;
        }
      };

      const dueThisMonth = activePayments.filter(p =>
        p.paymentType !== 'credit_card_bill' && isPaymentDueThisMonth(p)
      );

      const billsDue = dueThisMonth
        .filter(p => (p.dueDate || 0) >= today)
        .reduce((sum, p) => sum + parseFloat(p.amount || '0'), 0);

      const upcomingBills = dueThisMonth
        .filter(p => {
          const dueDay = p.dueDate || 0;
          return dueDay >= today && dueDay <= today + 7;
        })
        .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0))
        .slice(0, 5);

      const categoryTotals = new Map<number, { name: string; total: number; color: string; icon: string }>();
      for (const t of monthTransactions.filter(t => t.type === 'debit')) {
        if (t.categoryId && t.category) {
          const existing = categoryTotals.get(t.categoryId) || { name: t.category.name, total: 0, color: t.category.color || '#9E9E9E', icon: t.category.icon || 'ellipsis-horizontal' };
          existing.total += parseFloat(t.amount);
          categoryTotals.set(t.categoryId, existing);
        }
      }
      const topCategories = Array.from(categoryTotals.entries())
        .map(([categoryId, data]) => ({ categoryId, ...data }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      const monthBudgets = await storage.getAllBudgets({ userId, month: now.getMonth() + 1, year: now.getFullYear() });
      const allCategories = await storage.getAllCategories();
      const budgetUsage = monthBudgets.map(b => {
        const category = allCategories.find(c => c.id === b.categoryId);
        const spent = categoryTotals.get(b.categoryId!)?.total || 0;
        const budgetAmount = parseFloat(b.amount);
        return {
          categoryId: b.categoryId!,
          categoryName: category?.name || 'Unknown',
          spent,
          budget: budgetAmount,
          percentage: budgetAmount > 0 ? Math.round((spent / budgetAmount) * 100) : 0,
        };
      }).sort((a, b) => b.percentage - a.percentage).slice(0, 3);

      const creditCardAccounts = await storage.getAllAccounts(userId);
      const creditCards = creditCardAccounts.filter(a => a.type === 'credit_card' && a.isActive);
      // One transaction-history query per card, run concurrently instead of awaited in sequence.
      const creditCardSpending = await Promise.all(creditCards.map(async (card) => {
        let cycleStartDate: Date;
        let cycleEndDate: Date;
        if (card.billingDate) {
          const billingDay = card.billingDate;
          const currentDay = now.getDate();
          if (currentDay >= billingDay) {
            cycleStartDate = new Date(now.getFullYear(), now.getMonth(), billingDay);
            cycleEndDate = new Date(now.getFullYear(), now.getMonth() + 1, billingDay - 1, 23, 59, 59);
          } else {
            cycleStartDate = new Date(now.getFullYear(), now.getMonth() - 1, billingDay);
            cycleEndDate = new Date(now.getFullYear(), now.getMonth(), billingDay - 1, 23, 59, 59);
          }
        } else {
          cycleStartDate = startOfMonth;
          cycleEndDate = endOfMonth;
        }
        const cycleTransactions = await storage.getAllTransactions({
          userId,
          accountId: card.id,
          startDate: cycleStartDate,
          endDate: cycleEndDate,
        });
        const spent = cycleTransactions
          .filter(t => t.type === 'debit')
          .reduce((sum, t) => sum + parseFloat(t.amount), 0);
        const limit = card.monthlySpendingLimit ? parseFloat(card.monthlySpendingLimit) : null;
        const percentage = limit && limit > 0 ? Math.round((spent / limit) * 100) : 0;
        let color = '#22c55e';
        if (limit) {
          if (percentage >= 100) color = '#ef4444';
          else if (percentage >= 80) color = '#eab308';
        }
        return {
          accountId: card.id,
          accountName: card.name,
          bankName: card.bankName || '',
          spent,
          limit,
          percentage,
          color,
        };
      }));

      const incomeByAccount = new Map<number, { accountId: number; accountName: string; bankName: string; amount: number }>();
      for (const t of monthTransactions.filter(t => t.type === 'credit')) {
        if (t.accountId && t.account) {
          const existing = incomeByAccount.get(t.accountId) || {
            accountId: t.accountId,
            accountName: t.account.name,
            bankName: t.account.bankName || '',
            amount: 0,
          };
          existing.amount += parseFloat(t.amount);
          incomeByAccount.set(t.accountId, existing);
        }
      }

      const expenseByAccount = new Map<number, { accountId: number; accountName: string; bankName: string; amount: number }>();
      for (const t of monthTransactions.filter(t => t.type === 'debit')) {
        if (t.accountId && t.account) {
          const existing = expenseByAccount.get(t.accountId) || {
            accountId: t.accountId,
            accountName: t.account.name,
            bankName: t.account.bankName || '',
            amount: 0,
          };
          existing.amount += parseFloat(t.amount);
          expenseByAccount.set(t.accountId, existing);
        }
      }

      const scheduledPaymentsBills = [];
      const manualCreditCardBills = [];
      // Each payment's bill item is independent of the others — was previously one query per
      // payment awaited in sequence; running them concurrently is what actually cuts load time
      // (this loop alone can be a dozen+ sequential round-trips to Neon on a real account).
      const duePaymentsThisMonth = activePayments.filter(isPaymentDueThisMonth);
      const billItems = await Promise.all(duePaymentsThisMonth.map(async (p) => {
        const occurrences = await storage.getPaymentOccurrences({
          scheduledPaymentId: p.id,
          month: currentMonth,
          year: currentYear,
        });
        const occurrence = occurrences.length > 0 ? occurrences[0] : null;
        const isPaid = occurrence?.status === 'paid';
        const paidAmount = occurrence?.paidAmount ? parseFloat(occurrence.paidAmount) : 0;

        let amount = parseFloat(p.amount || '0');

        // If amount is 0 for credit card bill (auto-calculate), fetch the actual billing cycle amount
        if (amount === 0 && p.paymentType === 'credit_card_bill' && p.creditCardAccountId) {
          const creditCardAccount = await storage.getAccount(p.creditCardAccountId);
          if (creditCardAccount && creditCardAccount.billingDate) {
            const { getCreditCardBillingCycle } = await import('./salaryUtils');
            const { cycleStart, cycleEnd } = getCreditCardBillingCycle(now, creditCardAccount.billingDate);
            const cycleTransactions = await storage.getAllTransactions({
              accountId: creditCardAccount.id,
              startDate: cycleStart,
              endDate: cycleEnd,
            });
            amount = cycleTransactions
              .filter(t => t.type === 'debit')
              .reduce((sum, t) => sum + parseFloat(t.amount), 0);
          }
        }

        return {
          paymentType: p.paymentType,
          billItem: {
            id: p.id,
            name: p.name,
            amount,
            dueDate: p.dueDate,
            dueDateType: p.dueDateType || 'fixed_day',
            frequency: p.frequency || 'monthly',
            isPaid,
            paidAmount,
            status: isPaid ? 'paid' : (p.dueDate && p.dueDate < today ? 'overdue' : 'pending'),
          },
        };
      }));

      for (const { paymentType, billItem } of billItems) {
        if (paymentType === 'credit_card_bill') {
          manualCreditCardBills.push(billItem);
        } else {
          scheduledPaymentsBills.push(billItem);
        }
      }

      const manualCCAccountIds = new Set(
        activePayments.filter(p => p.paymentType === 'credit_card_bill').map(p => p.creditCardAccountId).filter(Boolean)
      );
      const autoCreditCardBills = (await Promise.all(
        creditCards
          .filter(card => !manualCCAccountIds.has(card.id) && card.billingDate)
          .map(async (card) => {
            const billingDay = card.billingDate!;
            let prevCycleStart: Date;
            let prevCycleEnd: Date;
            if (today >= billingDay) {
              prevCycleStart = new Date(now.getFullYear(), now.getMonth() - 1, billingDay, 0, 0, 0);
              prevCycleEnd = new Date(now.getFullYear(), now.getMonth(), billingDay - 1, 23, 59, 59);
            } else {
              prevCycleStart = new Date(now.getFullYear(), now.getMonth() - 2, billingDay, 0, 0, 0);
              prevCycleEnd = new Date(now.getFullYear(), now.getMonth() - 1, billingDay - 1, 23, 59, 59);
            }
            const prevCycleTxns = await storage.getAllTransactions({
              userId,
              accountId: card.id,
              startDate: prevCycleStart,
              endDate: prevCycleEnd,
            });
            const billAmount = prevCycleTxns
              .filter(t => t.type === 'debit')
              .reduce((sum, t) => sum + parseFloat(t.amount), 0);
            if (billAmount <= 0) return null;
            const creditLimit = card.creditLimit ? parseFloat(card.creditLimit) : null;
            return {
              id: `cc-auto-${card.id}`,
              name: `${card.name} Bill`,
              amount: billAmount,
              dueDate: billingDay,
              dueDateType: 'fixed_day',
              frequency: 'monthly',
              isPaid: false,
              paidAmount: 0,
              status: billingDay < today ? 'overdue' : billingDay === today ? 'due_today' : 'pending',
              creditLimit,
              bankName: card.bankName || '',
              isAutoCalculated: true,
            };
          })
      )).filter((bill): bill is NonNullable<typeof bill> => bill !== null);
      const creditCardBills: any[] = [...autoCreditCardBills, ...manualCreditCardBills];

      const loans = await storage.getAllLoans(userId);
      const activeLoans = loans.filter(l => l.status === 'active');
      const totalEMI = activeLoans.reduce((sum, l) => sum + parseFloat(l.emiAmount || '0'), 0);

      const loanBills = await Promise.all(activeLoans.map(async (loan) => {
        const installments = await storage.getLoanInstallments(loan.id);
        const currentInstallment = installments.find(inst => {
          const d = new Date(inst.dueDate);
          return d.getMonth() + 1 === currentMonth && d.getFullYear() === currentYear;
        });
        return {
          id: loan.id,
          name: loan.name,
          loanType: loan.type,
          amount: currentInstallment ? parseFloat(currentInstallment.emiAmount) : parseFloat(loan.emiAmount || '0'),
          dueDate: loan.emiDay,
          isPaid: currentInstallment?.status === 'paid',
          paidAmount: currentInstallment?.paidAmount ? parseFloat(currentInstallment.paidAmount) : 0,
          status: currentInstallment?.status || (loan.emiDay && loan.emiDay < today ? 'overdue' : 'pending'),
          lenderName: loan.lenderName || '',
        };
      }));

      const allInsurances = await storage.getAllInsurances(userId);
      // Auto-funded policies (e.g. a market/sub policy funded by a main policy's benefit) are
      // never something the user pays directly — exclude them from due/forecast projections
      // entirely; their premium history is only meaningful on the policy's own details view.
      const activeInsurances = allInsurances.filter(i => i.status === 'active' && !i.autoFunded);
      const insuranceBills = [];
      for (const ins of activeInsurances) {
        const premiums = ins.premiums || [];
        const currentPremium = premiums.find((p: any) => {
          const d = new Date(p.dueDate);
          return d.getMonth() + 1 === currentMonth && d.getFullYear() === currentYear;
        });
        if (currentPremium) {
          insuranceBills.push({
            id: ins.id,
            name: ins.name,
            insuranceType: ins.type,
            providerName: ins.providerName || '',
            amount: parseFloat(currentPremium.amount),
            dueDate: new Date(currentPremium.dueDate).getDate(),
            isPaid: currentPremium.status === 'paid',
            paidAmount: currentPremium.paidAmount ? parseFloat(currentPremium.paidAmount) : 0,
            status: currentPremium.status || 'pending',
          });
        }
      }

      const totalBillsDue =
        scheduledPaymentsBills.filter(b => !b.isPaid).reduce((s, b) => s + b.amount, 0) +
        creditCardBills.filter(b => !b.isPaid).reduce((s, b) => s + b.amount, 0) +
        loanBills.filter(b => !b.isPaid).reduce((s, b) => s + b.amount, 0) +
        insuranceBills.filter(b => !b.isPaid).reduce((s, b) => s + b.amount, 0);

      // Savings progress for the current cycle — sum of contributions (not goal balances) made
      // to active goals within this cycle's date range, so it reads as "progress this cycle"
      // rather than an all-time total.
      const activeSavingsGoals = await storage.getAllSavingsGoals(userId);
      const savedThisCycleByGoal = await Promise.all(
        activeSavingsGoals.filter(g => g.status === 'active').map(async (goal) => {
          const contributions = await storage.getSavingsContributions(goal.id);
          return contributions
            .filter(c => {
              const contributedAt = new Date(c.contributedAt);
              return contributedAt >= startOfMonth && contributedAt <= endOfMonth;
            })
            .reduce((sum, c) => sum + parseFloat(c.amount), 0);
        })
      );
      const savedThisCycle = savedThisCycleByGoal.reduce((sum, amount) => sum + amount, 0);

      const lastTransactions = await storage.getAllTransactions({ userId, limit: 5 });

      const cycleDatesObj = getCurrentCycleDates(salaryProfile, lastSalaryCycle, now);

      res.json({
        monthLabel: cycleDatesObj.cycleLabel,
        totalIncome,
        totalSpent,
        totalSpentToday,
        billsDue: totalBillsDue,
        incomeByAccount: Array.from(incomeByAccount.values()).sort((a, b) => b.amount - a.amount),
        expenseByAccount: Array.from(expenseByAccount.values()).sort((a, b) => b.amount - a.amount),
        billsDueDetails: {
          scheduledPayments: scheduledPaymentsBills.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
          creditCardBills: creditCardBills.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
          loans: loanBills.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
          insurance: insuranceBills.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
        },
        topCategories,
        budgetUsage,
        creditCardSpending,
        totalEMI,
        activeLoansCount: activeLoans.length,
        lastTransactions,
        savedThisCycle,
        cycleInfo: {
          cycleStartFormatted: cycleDatesObj.cycleStartFormatted,
          cycleEndFormatted: cycleDatesObj.cycleEndFormatted,
          isSalaryCycle: cycleDatesObj.isSalaryCycle,
        },
      });
    } catch (error) {
      console.error("Error fetching dashboard summary:", error);
      res.status(500).json({ error: "Failed to fetch dashboard summary" });
    }
  });

  app.get("/api/next-month-forecast", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const now = new Date();

      const salaryProfile = await storage.getSalaryProfile(userId);
      let lastSalaryCycle = null;
      if (salaryProfile) {
        const recentCycles = await storage.getSalaryCycles(salaryProfile.id, 1);
        if (recentCycles.length > 0) {
          lastSalaryCycle = recentCycles[0];
        }
      }

      const nextCycle = getNextCycleDates(salaryProfile, lastSalaryCycle, now);
      const { month: nextMonth, year: nextYear } = getCyclePrimaryMonth(nextCycle.cycleStart, nextCycle.cycleEnd);
      const monthLabel = nextCycle.cycleLabel;

      // Items the user has opted out of this specific cycle's Income/Outflow/Balance totals —
      // still shown in the list (so it's obvious they exist and can be re-included), just not
      // counted toward the sums.
      const exclusions = await storage.getForecastExclusions(userId, nextCycle.cycleStart);
      const excludedKeys = new Set(exclusions.map(e => `${e.itemType}:${e.itemId}`));
      const isExcluded = (itemType: string, itemId: string | number) => excludedKeys.has(`${itemType}:${itemId}`);

      const salaryItems: any[] = [];
      let totalIncome = 0;

      if (salaryProfile && salaryProfile.isActive && salaryProfile.monthlyAmount) {
        const payday = getPaydayForMonth(
          nextYear,
          nextMonth,
          salaryProfile.paydayRule || 'last_working_day',
          salaryProfile.fixedDay,
          salaryProfile.weekdayPreference,
        );
        const amount = parseFloat(salaryProfile.monthlyAmount);
        let accountName = 'Salary Account';
        let bankName = '';
        if (salaryProfile.accountId) {
          const accounts = await storage.getAllAccounts(userId);
          const acc = accounts.find(a => a.id === salaryProfile.accountId);
          if (acc) {
            accountName = acc.name;
            bankName = acc.bankName || '';
          }
        }
        salaryItems.push({
          profileId: salaryProfile.id,
          accountName,
          bankName,
          amount,
          creditDate: payday.toISOString(),
          creditDay: payday.getDate(),
        });
        totalIncome += amount;
      }

      const allPayments = await storage.getAllScheduledPayments(userId);
      const activePayments = allPayments.filter(p => p.status === 'active');

      const isPaymentDueNextMonth = (payment: any): boolean => {
        const frequency = payment.frequency || 'monthly';
        const startMonth = payment.startMonth;

        switch (frequency) {
          case 'monthly': return true;
          case 'quarterly': {
            if (startMonth) {
              const quarterMonths = [startMonth];
              for (let i = 1; i < 4; i++) {
                quarterMonths.push(((startMonth - 1 + i * 3) % 12) + 1);
              }
              return quarterMonths.includes(nextMonth);
            }
            return [1, 4, 7, 10].includes(nextMonth);
          }
          case 'half_yearly': {
            if (startMonth) {
              return nextMonth === startMonth || nextMonth === ((startMonth + 5) % 12) + 1;
            }
            return nextMonth === 1 || nextMonth === 7;
          }
          case 'yearly':
            return startMonth ? nextMonth === startMonth : nextMonth === 1;
          case 'custom': {
            if (payment.customIntervalMonths && payment.customIntervalMonths > 0) {
              const interval = payment.customIntervalMonths;
              const refMonth = startMonth || ((payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt)).getMonth() + 1);
              const refYear = (payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt)).getFullYear();
              const totalMonthsDiff = (nextYear - refYear) * 12 + (nextMonth - refMonth);
              return totalMonthsDiff >= 0 && totalMonthsDiff % interval === 0;
            }
            return true;
          }
          case 'one_time': {
            if (startMonth) {
              const createdYear = (payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt)).getFullYear();
              return nextMonth === startMonth && nextYear >= createdYear;
            }
            return false;
          }
          default: return true;
        }
      };

      const scheduledPaymentItems: any[] = [];
      let totalScheduled = 0;
      for (const p of activePayments) {
        if (p.paymentType === 'credit_card_bill') continue;
        if (!isPaymentDueNextMonth(p)) continue;
        const amount = parseFloat(p.amount || '0');
        const freq = p.frequency || 'monthly';
        const freqLabel = freq === 'monthly' ? 'Monthly' : freq === 'quarterly' ? 'Quarterly' : freq === 'half_yearly' ? 'Half Yearly' : freq === 'yearly' ? 'Yearly' : freq === 'custom' ? 'Custom' : '';
        const excluded = isExcluded('scheduled_payment', p.id);
        scheduledPaymentItems.push({
          id: p.id,
          name: p.name,
          amount,
          dueDate: p.dueDate,
          subLabel: freqLabel,
          excluded,
        });
        if (!excluded) totalScheduled += amount;
      }

      const loans = await storage.getAllLoans(userId);
      const activeLoans = loans.filter(l => l.status === 'active');
      const loanItems = await Promise.all(activeLoans.map(async (loan) => {
        const installments = await storage.getLoanInstallments(loan.id);
        const nextInstallment = installments.find(inst => {
          const d = new Date(inst.dueDate);
          return d.getMonth() + 1 === nextMonth && d.getFullYear() === nextYear;
        });
        const amount = nextInstallment ? parseFloat(nextInstallment.emiAmount) : parseFloat(loan.emiAmount || '0');
        const typeLabel = loan.type === 'home_loan' ? 'Home Loan' : loan.type === 'personal_loan' ? 'Personal Loan' : loan.type === 'credit_card_loan' ? 'CC Loan' : loan.type === 'item_emi' ? 'Item EMI' : 'Loan';
        const excluded = isExcluded('loan', loan.id);
        return {
          id: loan.id,
          name: loan.name,
          amount,
          dueDate: loan.emiDay,
          subLabel: `${typeLabel}${loan.lenderName ? ` · ${loan.lenderName}` : ''}`,
          excluded,
        };
      }));
      const totalLoans = loanItems.filter(item => !item.excluded).reduce((sum, item) => sum + item.amount, 0);

      const allInsurances = await storage.getAllInsurances(userId);
      // Auto-funded policies (e.g. a market/sub policy funded by a main policy's benefit) are
      // never something the user pays directly — exclude them from due/forecast projections
      // entirely; their premium history is only meaningful on the policy's own details view.
      const activeInsurances = allInsurances.filter(i => i.status === 'active' && !i.autoFunded);
      const insuranceItems: any[] = [];
      let totalInsurance = 0;
      for (const ins of activeInsurances) {
        const premiums = ins.premiums || [];
        const nextPremium = premiums.find((p: any) => {
          const d = new Date(p.dueDate);
          return d.getMonth() + 1 === nextMonth && d.getFullYear() === nextYear && p.status !== 'paid';
        });
        if (nextPremium) {
          const amount = parseFloat(nextPremium.amount);
          const typeLabel = ins.type === 'health' ? 'Health' : ins.type === 'life' ? 'Life' : ins.type === 'vehicle' ? 'Vehicle' : ins.type === 'home' ? 'Home' : ins.type === 'term' ? 'Term' : 'Insurance';
          const excluded = isExcluded('insurance', ins.id);
          insuranceItems.push({
            id: ins.id,
            name: ins.name,
            amount,
            dueDate: new Date(nextPremium.dueDate).getDate(),
            subLabel: `${typeLabel}${ins.providerName ? ` · ${ins.providerName}` : ''}`,
            excluded,
          });
          if (!excluded) totalInsurance += amount;
        }
      }

      const allAccounts = await storage.getAllAccounts(userId);
      const ccCards = allAccounts.filter(a => a.type === 'credit_card' && a.isActive && a.billingDate);
      const manualCCIds = new Set(
        activePayments.filter(p => p.paymentType === 'credit_card_bill').map(p => p.creditCardAccountId).filter(Boolean)
      );

      // Auto-detected credit card bills (spend-based) — one transaction-history query per card,
      // run concurrently instead of awaited in sequence.
      const autoCcItems = (await Promise.all(
        ccCards.filter(card => !manualCCIds.has(card.id)).map(async (card) => {
          const billingDay = card.billingDate!;
          const currentDay = now.getDate();
          let curCycleStart: Date;
          let curCycleEnd: Date;
          if (currentDay >= billingDay) {
            curCycleStart = new Date(now.getFullYear(), now.getMonth(), billingDay, 0, 0, 0);
            curCycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, billingDay - 1, 23, 59, 59);
          } else {
            curCycleStart = new Date(now.getFullYear(), now.getMonth() - 1, billingDay, 0, 0, 0);
            curCycleEnd = new Date(now.getFullYear(), now.getMonth(), billingDay - 1, 23, 59, 59);
          }
          const curCycleTxns = await storage.getAllTransactions({
            userId,
            accountId: card.id,
            startDate: curCycleStart,
            endDate: new Date(),
          });
          const spentSoFar = curCycleTxns
            .filter(t => t.type === 'debit')
            .reduce((sum, t) => sum + parseFloat(t.amount), 0);
          if (spentSoFar <= 0) return null;
          const creditLimit = card.creditLimit ? parseFloat(card.creditLimit) : null;
          const itemId = `cc-auto-${card.id}`;
          return {
            id: itemId,
            name: `${card.name} Bill`,
            amount: spentSoFar,
            dueDate: billingDay,
            subLabel: `Spent so far this cycle`,
            creditLimit,
            excluded: isExcluded('credit_card_bill', itemId),
          };
        })
      )).filter((item): item is NonNullable<typeof item> => item !== null);

      // Manually-configured credit card bill payments — same concurrency treatment.
      const manualCcItems = await Promise.all(
        activePayments
          .filter(p => p.paymentType === 'credit_card_bill' && isPaymentDueNextMonth(p) && manualCCIds.has(p.creditCardAccountId))
          .map(async (p) => {
            let amount = parseFloat(p.amount || '0');

            // If amount is 0 (auto-calculate), fetch the actual billing cycle amount
            if (amount === 0 && p.creditCardAccountId) {
              const creditCardAccount = await storage.getAccount(p.creditCardAccountId);
              if (creditCardAccount && creditCardAccount.billingDate) {
                const { getCreditCardBillingCycle } = await import('./salaryUtils');
                const { cycleStart, cycleEnd } = getCreditCardBillingCycle(now, creditCardAccount.billingDate);
                const cycleTransactions = await storage.getAllTransactions({
                  accountId: creditCardAccount.id,
                  startDate: cycleStart,
                  endDate: cycleEnd,
                });
                amount = cycleTransactions
                  .filter(t => t.type === 'debit')
                  .reduce((sum, t) => sum + parseFloat(t.amount), 0);
              }
            }

            let creditLimit: number | null = null;
            const linkedCard = allAccounts.find(a => a.id === p.creditCardAccountId);
            if (linkedCard && linkedCard.creditLimit) {
              creditLimit = parseFloat(linkedCard.creditLimit);
            }
            return {
              id: p.id,
              name: p.name,
              amount,
              dueDate: p.dueDate,
              subLabel: 'Monthly',
              creditLimit,
              excluded: isExcluded('credit_card_bill', p.id),
            };
          })
      );

      const creditCardBillItems: any[] = [...autoCcItems, ...manualCcItems];
      const totalCreditCardBills = creditCardBillItems.filter(item => !item.excluded).reduce((sum, item) => sum + item.amount, 0);

      const totalOutflow = totalScheduled + totalLoans + totalInsurance + totalCreditCardBills;

      res.json({
        monthLabel,
        salary: salaryItems,
        scheduledPayments: scheduledPaymentItems.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
        loans: loanItems.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
        insurance: insuranceItems.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
        creditCardBills: creditCardBillItems.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
        totalIncome,
        totalOutflow,
        net: totalIncome - totalOutflow,
        totalScheduled,
        totalLoans,
        totalInsurance,
        totalCreditCardBills,
        cycleInfo: {
          cycleStartFormatted: nextCycle.cycleStartFormatted,
          cycleEndFormatted: nextCycle.cycleEndFormatted,
          isSalaryCycle: nextCycle.isSalaryCycle,
        },
      });
    } catch (error) {
      console.error("Error fetching next month forecast:", error);
      res.status(500).json({ error: "Failed to fetch next month forecast" });
    }
  });

  // Toggle whether a specific item counts toward the Next Cycle Plan's Income/Outflow/Balance
  // totals — scoped to the upcoming cycle only, so it resets back to included next cycle rather
  // than silently muting a recurring bill from every future projection.
  app.post("/api/forecast-exclusions/toggle", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { itemType, itemId } = req.body;
      if (!itemType || itemId === undefined || itemId === null) {
        return res.status(400).json({ error: "itemType and itemId are required" });
      }

      const salaryProfile = await storage.getSalaryProfile(userId);
      let lastSalaryCycle = null;
      if (salaryProfile) {
        const recentCycles = await storage.getSalaryCycles(salaryProfile.id, 1);
        if (recentCycles.length > 0) {
          lastSalaryCycle = recentCycles[0];
        }
      }
      const nextCycle = getNextCycleDates(salaryProfile, lastSalaryCycle, new Date());

      const result = await storage.toggleForecastExclusion(userId, itemType, String(itemId), nextCycle.cycleStart);
      res.json(result);
    } catch (error: any) {
      console.error("Error toggling forecast exclusion:", error.message);
      res.status(500).json({ error: error.message || "Failed to toggle forecast exclusion" });
    }
  });

  // Get credit card billing cycle spending
  app.get("/api/credit-card-spending", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const cycle = req.query.cycle as string || 'current'; // 'current' or 'previous'
      const accounts = await storage.getAllAccounts(userId);
      const creditCards = accounts.filter(acc => acc.type === 'credit_card' && acc.isActive && acc.billingDate);
      
      const cardSpending = [];
      
      for (const card of creditCards) {
        const now = new Date();
        const currentDay = now.getDate();
        const billingDay = card.billingDate!;
        
        // Determine billing cycle dates based on requested cycle
        let cycleStartDate: Date;
        let cycleEndDate: Date;
        
        if (cycle === 'previous') {
          // Previous complete cycle - this represents the bill that will be paid this month
          // Example: Today is Jan 14, billing date 13
          // Previous cycle: Dec 13 to Jan 12 (this is the Jan bill)
          if (currentDay >= billingDay) {
            // We're past billing date, so previous cycle is last month to this month
            cycleStartDate = new Date(now.getFullYear(), now.getMonth() - 1, billingDay, 0, 0, 0);
            cycleEndDate = new Date(now.getFullYear(), now.getMonth(), billingDay - 1, 23, 59, 59);
          } else {
            // We're before billing date, so previous cycle is 2 months ago to last month
            cycleStartDate = new Date(now.getFullYear(), now.getMonth() - 2, billingDay, 0, 0, 0);
            cycleEndDate = new Date(now.getFullYear(), now.getMonth() - 1, billingDay - 1, 23, 59, 59);
          }
        } else {
          // Current cycle
          if (currentDay >= billingDay) {
            // Current cycle: billingDay of this month to next month's billingDay - 1
            cycleStartDate = new Date(now.getFullYear(), now.getMonth(), billingDay, 0, 0, 0);
            cycleEndDate = new Date(now.getFullYear(), now.getMonth() + 1, billingDay - 1, 23, 59, 59);
          } else {
            // Previous cycle: billingDay of last month to this month's billingDay - 1
            cycleStartDate = new Date(now.getFullYear(), now.getMonth() - 1, billingDay, 0, 0, 0);
            cycleEndDate = new Date(now.getFullYear(), now.getMonth(), billingDay - 1, 23, 59, 59);
          }
        }
        
        // Get transactions for this card in billing cycle
        const transactions = await storage.getAllTransactions({
          accountId: card.id,
          startDate: cycleStartDate,
          endDate: cycleEndDate,
        });
        
        const totalSpent = transactions
          .filter(t => t.type === 'debit')
          .reduce((sum, t) => sum + parseFloat(t.amount), 0);
        
        const creditLimit = card.creditLimit ? parseFloat(card.creditLimit) : 0;
        const availableCredit = parseFloat(card.balance || '0');
        const usedCredit = creditLimit - availableCredit;
        
        cardSpending.push({
          accountId: card.id,
          accountName: card.name,
          color: card.color,
          billingDate: billingDay,
          cycleStart: cycleStartDate.toISOString(),
          cycleEnd: cycleEndDate.toISOString(),
          totalSpent,
          creditLimit,
          availableCredit,
          usedCredit,
          utilizationPercent: creditLimit > 0 ? (totalSpent / creditLimit) * 100 : 0,
        });
      }
      
      res.json(cardSpending);
    } catch (error) {
      console.error("Error fetching credit card spending:", error);
      res.status(500).json({ error: "Failed to fetch credit card spending" });
    }
  });

  // ========== Expense Analytics ==========
  app.get("/api/expenses/monthly", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const now = new Date();
      const monthlyData = [];
      
      // Get last 6 months of expense data
      for (let i = 5; i >= 0; i--) {
        const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth();
        
        const startOfMonth = new Date(year, month, 1);
        const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);
        
        const transactions = await storage.getAllTransactions({
          startDate: startOfMonth,
          endDate: endOfMonth,
        });
        
        const totalExpenses = transactions
          .filter(t => t.type === 'debit')
          .reduce((sum, t) => sum + parseFloat(t.amount), 0);
        
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        monthlyData.push({
          month: monthNames[month],
          year,
          fullMonth: `${monthNames[month]} ${year}`,
          expenses: totalExpenses,
          monthIndex: month,
        });
      }
      
      res.json(monthlyData);
    } catch (error) {
      console.error("Error fetching monthly expenses:", error);
      res.status(500).json({ error: "Failed to fetch monthly expenses" });
    }
  });

  // Get credit card spending trend
  app.get("/api/credit-card-spending/monthly", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const accounts = await storage.getAllAccounts(userId);
      const creditCards = accounts.filter(acc => acc.type === 'credit_card' && acc.isActive);
      
      if (creditCards.length === 0) {
        return res.json([]);
      }
      
      const now = new Date();
      const monthlyData = [];
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      
      // Get last 6 months of credit card spending data
      for (let i = 5; i >= 0; i--) {
        const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth();
        
        const startOfMonth = new Date(year, month, 1);
        const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);
        
        let totalSpending = 0;
        
        // Sum spending across all credit cards
        for (const card of creditCards) {
          const transactions = await storage.getAllTransactions({
            accountId: card.id,
            startDate: startOfMonth,
            endDate: endOfMonth,
          });
          
          const cardSpending = transactions
            .filter(t => t.type === 'debit')
            .reduce((sum, t) => sum + parseFloat(t.amount), 0);
          
          totalSpending += cardSpending;
        }
        
        monthlyData.push({
          month: monthNames[month],
          year,
          fullMonth: `${monthNames[month]} ${year}`,
          spending: totalSpending,
          monthIndex: month,
        });
      }
      
      res.json(monthlyData);
    } catch (error) {
      console.error("Error fetching monthly credit card spending:", error);
      res.status(500).json({ error: "Failed to fetch monthly credit card spending" });
    }
  });

  app.get("/api/expenses/category-breakdown", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { month, year } = req.query;
      
      if (!month || !year) {
        return res.status(400).json({ error: "Month and year are required" });
      }
      
      const monthNum = parseInt(month as string);
      const yearNum = parseInt(year as string);
      
      const startOfMonth = new Date(yearNum, monthNum, 1);
      const endOfMonth = new Date(yearNum, monthNum + 1, 0, 23, 59, 59);
      
      const transactions = await storage.getAllTransactions({
        startDate: startOfMonth,
        endDate: endOfMonth,
      });
      
      const categoryTotals = new Map<number, { name: string; total: number; color: string; count: number }>();
      
      for (const t of transactions.filter(t => t.type === 'debit')) {
        if (t.categoryId && t.category) {
          const existing = categoryTotals.get(t.categoryId) || { 
            name: t.category.name, 
            total: 0, 
            color: t.category.color || '#9E9E9E',
            count: 0
          };
          existing.total += parseFloat(t.amount);
          existing.count += 1;
          categoryTotals.set(t.categoryId, existing);
        }
      }
      
      const breakdown = Array.from(categoryTotals.entries()).map(([categoryId, data]) => ({
        categoryId,
        categoryName: data.name,
        total: data.total,
        color: data.color,
        transactionCount: data.count,
      })).sort((a, b) => b.total - a.total);
      
      const totalExpenses = breakdown.reduce((sum, item) => sum + item.total, 0);
      
      res.json({
        month: monthNum,
        year: yearNum,
        totalExpenses,
        breakdown,
      });
    } catch (error) {
      console.error("Error fetching category breakdown:", error);
      res.status(500).json({ error: "Failed to fetch category breakdown" });
    }
  });

  // ========== AI Category Suggestion ==========
  app.post("/api/suggest-category", async (req, res) => {
    try {
      const { description, merchant } = req.body;
      const text = `${merchant || ""} ${description || ""}`.trim();
      if (!text) {
        res.status(400).json({ error: "Description or merchant required" });
        return;
      }
      const category = await suggestCategory(text);
      res.json({ category });
    } catch (error) {
      res.status(500).json({ error: "Failed to suggest category" });
    }
  });

  // ========== SMS Parsing ==========

  const SENDER_BANK_MAP: Record<string, string> = {
    hdfcbk: "hdfc",
    hdfc: "hdfc",
    icicibk: "icici",
    icici: "icici",
    sbiinb: "sbi",
    sbi: "sbi",
    axisbk: "axis",
    axis: "axis",
    kotak: "kotak",
    idfcfirst: "idfc",
    idfc: "idfc",
    indusind: "indusind",
    indusb: "indusind",
    yesbank: "yes",
    federal: "federal",
    canara: "canara",
    pnb: "pnb",
  };

  function matchAccountBySender(
    accounts: Awaited<ReturnType<typeof storage.getAllAccounts>>,
    sender: string,
    accountLastDigits?: string
  ): (typeof accounts)[0] | undefined {
    const senderLower = sender.toLowerCase().replace(/[^a-z0-9]/g, "");

    let bankKeyword: string | undefined;
    for (const [key, keyword] of Object.entries(SENDER_BANK_MAP)) {
      if (senderLower.includes(key)) {
        bankKeyword = keyword;
        break;
      }
    }

    if (!bankKeyword) return undefined;

    const candidates = accounts.filter(acc => {
      const name = (acc.name ?? "").toLowerCase();
      const bankName = (acc.bankName ?? "").toLowerCase();
      return name.includes(bankKeyword!) || bankName.includes(bankKeyword!);
    });

    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];

    if (accountLastDigits) {
      const exact = candidates.find(acc =>
        (acc.accountNumber ?? "").endsWith(accountLastDigits)
      );
      if (exact) return exact;
    }

    return candidates[0];
  }

  // Best-effort display name for the "New Accounts Detected" review screen —
  // just a starting suggestion, the user edits/confirms it when mapping the institution.
  function suggestInstitutionName(message: string, institutionKey: string): string {
    const lowerKey = institutionKey.toLowerCase();
    for (const [senderPrefix, bankLabel] of Object.entries(SENDER_BANK_MAP)) {
      if (lowerKey.includes(senderPrefix)) {
        return bankLabel.charAt(0).toUpperCase() + bankLabel.slice(1);
      }
    }
    if (/\bepfo\b/i.test(message) || /\bprovident fund\b/i.test(message)) {
      return "EPFO";
    }
    return institutionKey.charAt(0).toUpperCase() + institutionKey.slice(1).toLowerCase();
  }

  type ParseSmsResult = {
    success: boolean;
    transaction?: any;
    parsed?: any;
    duplicate?: boolean;
    pendingReview?: boolean;
    ignored?: boolean;
    institutionKey?: string;
    message?: string;
    smsLogId?: number;
  };

  // Parses a due-reminder SMS ("has dues of Rs X", "minimum due", "total outstanding") — these
  // aren't transactions, so parseSmsMessage already returned null before this is tried. A credit
  // card due is matched instantly via its stored last-4-digits and reconciled against the
  // existing (transaction-derived) statement balance. Everything else has no reliable identifier
  // on first sight, so it's routed through a learned sender mapping (Bills Inbox) the same way
  // unmatched transaction senders are — see processSingleSms's institution-mapping fallback.
  async function processDueSms(
    messageText: string,
    sender: string | undefined,
    accounts: Awaited<ReturnType<typeof storage.getAllAccounts>>,
    smsLogData: any
  ): Promise<ParseSmsResult | null> {
    const dueData = parseDueSms(messageText);
    if (!dueData) return null;

    const fallbackOwnerAccount = accounts.find(acc => acc.isDefault) || accounts.find(acc => acc.isActive) || accounts[0];
    const userId = fallbackOwnerAccount?.userId;

    // Path 1: credit card, matched instantly by last-4-digits already on file.
    if (dueData.cardLastFourDigits && userId) {
      const card = await storage.getCardDetailsByLastFourDigits(dueData.cardLastFourDigits, userId);
      if (card) {
        const statement = await storage.getOrCreateCurrentStatement(card.accountId);
        const statementBalance = parseFloat(statement.statementBalance || '0');
        const matched = Math.abs(dueData.amount - statementBalance) < 1;
        await storage.confirmCreditCardStatementSms(statement.id, dueData.amount, matched);
        smsLogData.creditCardStatementId = statement.id;
        smsLogData.isParsed = true;
        const smsLog = await storage.createSmsLog(smsLogData);
        return {
          success: true,
          transaction: null,
          parsed: dueData,
          smsLogId: smsLog.id,
          message: matched ? "Credit card due confirmed against statement" : "Credit card due amount disagreed with tracked statement — flagged for review",
        };
      }
      // Card digits didn't match any known card — fall through to the sender-mapping path below.
    }

    // Path 2: everything else — no reliable identifier in the message itself, route via learned
    // sender mapping (same shape as senderInstitutionMappings for transactions).
    if (!userId) {
      const smsLog = await storage.createSmsLog(smsLogData);
      console.warn('⚠️  No accounts found — due SMS not routed. Returning parsed data only.');
      return { success: true, transaction: null, parsed: dueData, smsLogId: smsLog.id };
    }

    const institutionKey = sender ? deriveInstitutionKey(sender) : "UNKNOWN";
    let mapping = await storage.getBillSenderMapping(userId, institutionKey);

    if (mapping?.status === "ignored") {
      await storage.touchBillSenderMapping(mapping.id);
      const smsLog = await storage.createSmsLog(smsLogData);
      return { success: true, transaction: null, ignored: true, institutionKey, parsed: dueData, smsLogId: smsLog.id };
    }

    if (mapping?.status === "mapped" && mapping.scheduledPaymentId) {
      await storage.touchBillSenderMapping(mapping.id);
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const existingOccurrences = await storage.getPaymentOccurrences({ scheduledPaymentId: mapping.scheduledPaymentId, month, year });
      const occurrence = existingOccurrences[0] || await storage.createPaymentOccurrence({
        scheduledPaymentId: mapping.scheduledPaymentId,
        month,
        year,
        dueDate: dueData.dueDate ? new Date(dueData.dueDate) : now,
        status: "pending",
      });
      await storage.confirmPaymentOccurrenceSms(occurrence.id);
      smsLogData.paymentOccurrenceId = occurrence.id;
      smsLogData.billMappingId = mapping.id;
      smsLogData.isParsed = true;
      const smsLog = await storage.createSmsLog(smsLogData);
      return { success: true, transaction: null, parsed: dueData, smsLogId: smsLog.id, message: "Scheduled payment due confirmed by SMS" };
    }

    // New or still-pending sender — queue it in the Bills Inbox, no linkage until the user resolves it.
    if (!mapping) {
      mapping = await storage.createBillSenderMapping({
        userId,
        institutionKey,
        status: "pending",
        // Prefer the provider name actually parsed from the message (e.g. "SPOTIFY INDIA PVT
        // LTD" from an e-mandate alert) over the generic sender/bank-derived guess.
        suggestedName: dueData.providerName || suggestInstitutionName(messageText, institutionKey),
      });
    } else {
      await storage.touchBillSenderMapping(mapping.id);
    }

    smsLogData.billMappingId = mapping.id;
    const smsLog = await storage.createSmsLog(smsLogData);
    return { success: true, transaction: null, pendingReview: true, institutionKey, parsed: dueData, smsLogId: smsLog.id };
  }

  // Parses one SMS, matches it to an account, and creates the transaction — shared by the
  // single and batch parse-sms endpoints so the institution-mapping fallback only lives in one place.
  async function processSingleSms(
    messageText: string,
    sender: string | undefined,
    receivedAt: string | undefined,
    accounts: Awaited<ReturnType<typeof storage.getAllAccounts>>
  ): Promise<ParseSmsResult> {
    const smsLogData: any = {
      message: messageText,
      receivedAt: receivedAt || new Date().toISOString(),
      isParsed: false,
    };
    if (sender && typeof sender === 'string') {
      smsLogData.sender = sender;
    }

    const parsedData = await parseSmsMessage(messageText, sender);

    if (!parsedData || !parsedData.amount) {
      const dueResult = await processDueSms(messageText, sender, accounts, smsLogData);
      if (dueResult) return dueResult;

      const smsLog = await storage.createSmsLog(smsLogData);
      return { success: false, message: "Could not parse transaction from SMS", smsLogId: smsLog.id };
    }

    const finishWithTransaction = async (account: (typeof accounts)[number]): Promise<ParseSmsResult> => {
      const categoryName = await suggestCategory(parsedData.merchant || parsedData.description || "");
      const category = await storage.getCategoryByName(categoryName);

      const transactionData: any = {
        amount: parsedData.amount!.toString(),
        type: parsedData.type || "debit",
        // Prefer the date embedded in the SMS text; if the message doesn't have one, the
        // actual received time (accurate for a rescan of historical messages) beats "now".
        transactionDate: parsedData.date || receivedAt || new Date().toISOString(),
        userId: account.userId,
        accountId: account.id,
      };
      if (parsedData.description) transactionData.description = parsedData.description;
      if (parsedData.merchant) transactionData.merchant = parsedData.merchant;
      if (parsedData.referenceNumber) transactionData.referenceNumber = parsedData.referenceNumber;
      if (parsedData.availableBalance !== undefined) transactionData.availableBalance = parsedData.availableBalance.toString();
      if (category?.id) transactionData.categoryId = category.id;

      // Banks often send the same transaction from multiple sender IDs (or redeliver the
      // same SMS) — the reference number uniquely identifies the real transaction, so skip
      // creating a duplicate if one already exists for this user. Not every bank SMS has a
      // parseable reference number, so fall back to matching on account+amount+type+day —
      // matters most for rescans, which can otherwise re-add the same historical SMS.
      const existingTransaction = parsedData.referenceNumber
        ? await storage.getTransactionByReferenceNumber(account.userId, parsedData.referenceNumber)
        : await storage.getTransactionByFallbackKey(
            account.userId, account.id, transactionData.amount, transactionData.type, new Date(transactionData.transactionDate)
          );

      const smsLog = await storage.createSmsLog(smsLogData);

      if (existingTransaction) {
        await storage.updateSmsLogTransaction(smsLog.id, existingTransaction.id);
        return { success: true, transaction: existingTransaction, duplicate: true, parsed: parsedData };
      }

      transactionData.smsId = smsLog.id;
      const transaction = await storage.createTransaction(transactionData);
      await storage.updateSmsLogTransaction(smsLog.id, transaction.id);
      return { success: true, transaction, parsed: parsedData };
    };

    const matchedAccount = matchAccountBySender(accounts, sender || "", parsedData.accountLastDigits);
    if (matchedAccount) {
      return finishWithTransaction(matchedAccount);
    }

    // Unmatched sender — don't guess an account. Route through institution mapping instead.
    const fallbackOwnerAccount = accounts.find(acc => acc.isDefault) || accounts.find(acc => acc.isActive) || accounts[0];
    if (!fallbackOwnerAccount?.userId) {
      await storage.createSmsLog(smsLogData);
      console.warn('⚠️  No accounts found — transaction not saved. Returning parsed data only.');
      return { success: true, transaction: null, parsed: parsedData };
    }

    const userId = fallbackOwnerAccount.userId;
    const institutionKey = sender ? deriveInstitutionKey(sender) : "UNKNOWN";
    let mapping = await storage.getSenderInstitutionMapping(userId, institutionKey);

    if (mapping?.status === "ignored") {
      await storage.createSmsLog(smsLogData);
      return { success: true, transaction: null, ignored: true, institutionKey, parsed: parsedData };
    }

    if (mapping?.status === "mapped" && mapping.accountId) {
      const mappedAccount = accounts.find(a => a.id === mapping!.accountId);
      if (mappedAccount) {
        await storage.touchSenderInstitutionMapping(mapping.id);
        return finishWithTransaction(mappedAccount);
      }
    }

    // New or still-pending institution — queue it for review, no transaction until approved.
    if (!mapping) {
      mapping = await storage.createSenderInstitutionMapping({
        userId,
        institutionKey,
        status: "pending",
        suggestedName: suggestInstitutionName(messageText, institutionKey),
      });
    } else {
      await storage.touchSenderInstitutionMapping(mapping.id);
    }

    smsLogData.institutionMappingId = mapping.id;
    await storage.createSmsLog(smsLogData);
    return { success: true, transaction: null, pendingReview: true, institutionKey, parsed: parsedData };
  }

  type PreviewSmsResult = {
    message: string;
    sender?: string;
    receivedAt?: string;
    status: 'new' | 'duplicate' | 'unmatched' | 'unparseable';
    amount?: number;
    type?: 'debit' | 'credit';
    merchant?: string;
    date?: string;
    matchedAccountName?: string;
  };

  // Read-only counterpart to processSingleSms, used by the rescan preview — parses and checks
  // for a duplicate/account match exactly like the real path, but never creates anything.
  async function previewSingleSms(
    messageText: string,
    sender: string | undefined,
    receivedAt: string | undefined,
    accounts: Awaited<ReturnType<typeof storage.getAllAccounts>>
  ): Promise<PreviewSmsResult> {
    const parsedData = await parseSmsMessage(messageText, sender);

    if (!parsedData || !parsedData.amount) {
      return { message: messageText, sender, receivedAt, status: 'unparseable' };
    }

    const base = {
      message: messageText,
      sender,
      receivedAt,
      amount: parsedData.amount,
      type: parsedData.type,
      merchant: parsedData.merchant,
      date: parsedData.date,
    };

    const matchedAccount = matchAccountBySender(accounts, sender || "", parsedData.accountLastDigits);
    if (!matchedAccount) {
      return { ...base, status: 'unmatched' };
    }

    const transactionDate = new Date(parsedData.date || receivedAt || new Date().toISOString());
    const existingTransaction = parsedData.referenceNumber
      ? await storage.getTransactionByReferenceNumber(matchedAccount.userId, parsedData.referenceNumber)
      : await storage.getTransactionByFallbackKey(
          matchedAccount.userId, matchedAccount.id, parsedData.amount.toString(), parsedData.type || 'debit', transactionDate
        );

    return {
      ...base,
      status: existingTransaction ? 'duplicate' : 'new',
      matchedAccountName: matchedAccount.name,
    };
  }

  app.post("/api/parse-sms-preview", validateApiKey, async (req, res) => {
    try {
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      const accounts = await storage.getAllAccounts();
      const results = await Promise.all(
        messages.map((msg: any) => {
          const messageText = typeof msg === 'string' ? msg : msg.message;
          const sender = typeof msg === 'string' ? undefined : msg.sender;
          const receivedAt = typeof msg === 'string' ? undefined : msg.receivedAt;
          return previewSingleSms(messageText, sender, receivedAt, accounts);
        })
      );

      res.json({ results });
    } catch (error: any) {
      console.error("SMS preview error:", error.message);
      res.status(500).json({ error: error.message || "Failed to preview SMS" });
    }
  });

  app.post("/api/parse-sms", validateApiKey, async (req, res) => {
    try {
      const { sender, message, receivedAt } = req.body;
      const accounts = await storage.getAllAccounts();
      const result = await processSingleSms(message, sender, receivedAt, accounts);
      res.json(result);
    } catch (error: any) {
      console.error("SMS parsing error:", error.message);
      res.status(500).json({ error: error.message || "Failed to parse SMS" });
    }
  });

  // ========== Batch SMS Parsing ==========
  app.post("/api/parse-sms-batch", validateApiKey, async (req, res) => {
    try {
      const { messages } = req.body; // Array of SMS message strings or objects
      
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      const results = [];
      const accounts = await storage.getAllAccounts();

      for (const msg of messages) {
        const messageText = typeof msg === 'string' ? msg : msg.message;
        const sender = typeof msg === 'string' ? undefined : msg.sender;
        const receivedAt = typeof msg === 'string' ? undefined : msg.receivedAt;

        try {
          const result = await processSingleSms(messageText, sender, receivedAt, accounts);
          results.push({ ...result, message: messageText.substring(0, 50) + '...' });
        } catch (error: any) {
          results.push({
            success: false,
            message: messageText.substring(0, 50) + '...',
            error: error.message
          });
        }
      }
      
      const successful = results.filter(r => r.success).length;
      res.json({ 
        total: messages.length,
        successful,
        failed: messages.length - successful,
        results 
      });
    } catch (error: any) {
      console.error("Batch SMS parsing error:", error.message);
      res.status(500).json({ error: error.message || "Failed to parse batch SMS" });
    }
  });

  // ========== Institution Mapping Review ==========
  // Re-parses every queued SMS for a now-resolved institution and creates the real
  // transactions against the chosen account, in receivedAt order.
  async function backfillQueuedSmsForMapping(mappingId: number, account: { id: number; userId: number }): Promise<number> {
    const queued = await storage.getQueuedSmsLogsForMapping(mappingId);
    let backfilled = 0;

    for (const smsLog of queued) {
      const parsedData = await parseSmsMessage(smsLog.message, smsLog.sender || undefined);
      if (!parsedData || !parsedData.amount) continue;

      const categoryName = await suggestCategory(parsedData.merchant || parsedData.description || "");
      const category = await storage.getCategoryByName(categoryName);

      const existingTransaction = parsedData.referenceNumber
        ? await storage.getTransactionByReferenceNumber(account.userId, parsedData.referenceNumber)
        : undefined;

      if (existingTransaction) {
        await storage.updateSmsLogTransaction(smsLog.id, existingTransaction.id);
        backfilled++;
        continue;
      }

      const transactionData: any = {
        amount: parsedData.amount.toString(),
        type: parsedData.type || "debit",
        transactionDate: parsedData.date || smsLog.receivedAt.toISOString(),
        userId: account.userId,
        accountId: account.id,
        smsId: smsLog.id,
      };
      if (parsedData.description) transactionData.description = parsedData.description;
      if (parsedData.merchant) transactionData.merchant = parsedData.merchant;
      if (parsedData.referenceNumber) transactionData.referenceNumber = parsedData.referenceNumber;
      if (parsedData.availableBalance !== undefined) transactionData.availableBalance = parsedData.availableBalance.toString();
      if (category?.id) transactionData.categoryId = category.id;

      const transaction = await storage.createTransaction(transactionData);
      await storage.updateSmsLogTransaction(smsLog.id, transaction.id);
      backfilled++;
    }

    return backfilled;
  }

  // List institutions detected from unrecognized senders, awaiting your review.
  app.get("/api/institution-mappings/pending", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const mappings = await storage.getPendingSenderInstitutionMappings(userId);

      const enriched = await Promise.all(mappings.map(async (mapping) => {
        const queued = await storage.getQueuedSmsLogsForMapping(mapping.id);
        const latest = queued[queued.length - 1];
        const latestParsed = latest ? await parseSmsMessage(latest.message, latest.sender || undefined) : null;
        return {
          ...mapping,
          queuedCount: queued.length,
          latestAmount: latestParsed?.amount ?? null,
          latestAvailableBalance: latestParsed?.availableBalance ?? null,
          latestReceivedAt: latest?.receivedAt ?? null,
        };
      }));

      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch pending institution mappings" });
    }
  });

  // Detail view: every queued message for one pending institution, parsed.
  app.get("/api/institution-mappings/:id/queued", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const mappingId = parseInt(req.params.id);
      const mapping = await storage.getPendingSenderInstitutionMappings(userId);
      const found = mapping.find(m => m.id === mappingId);
      if (!found) {
        return res.status(404).json({ error: "Institution mapping not found" });
      }

      const queued = await storage.getQueuedSmsLogsForMapping(mappingId);
      const parsed = await Promise.all(queued.map(async (smsLog) => ({
        smsLogId: smsLog.id,
        message: smsLog.message,
        sender: smsLog.sender,
        receivedAt: smsLog.receivedAt,
        parsed: await parseSmsMessage(smsLog.message, smsLog.sender || undefined),
      })));

      res.json({ mapping: found, queued: parsed });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch queued messages" });
    }
  });

  // Map a pending institution to an existing account, backfilling its queued transactions.
  app.post("/api/institution-mappings/:id/map", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const mappingId = parseInt(req.params.id);
      const { accountId } = req.body;

      const pending = await storage.getPendingSenderInstitutionMappings(userId);
      const mapping = pending.find(m => m.id === mappingId);
      if (!mapping) {
        return res.status(404).json({ error: "Institution mapping not found" });
      }

      const account = await storage.getAccount(accountId);
      if (!account || account.userId !== userId) {
        return res.status(404).json({ error: "Account not found" });
      }

      await storage.resolveSenderInstitutionMapping(mappingId, { status: "mapped", accountId: account.id });
      const backfilled = await backfillQueuedSmsForMapping(mappingId, account);

      res.json({ success: true, account, backfilled });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to map institution" });
    }
  });

  // Create a new account for a pending institution, backfilling its queued transactions.
  app.post("/api/institution-mappings/:id/create-account", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const mappingId = parseInt(req.params.id);

      const pending = await storage.getPendingSenderInstitutionMappings(userId);
      const mapping = pending.find(m => m.id === mappingId);
      if (!mapping) {
        return res.status(404).json({ error: "Institution mapping not found" });
      }

      const validatedData = insertAccountSchema.parse({ ...req.body, userId });
      const account = await storage.createAccount(validatedData);

      await storage.resolveSenderInstitutionMapping(mappingId, { status: "mapped", accountId: account.id });
      const backfilled = await backfillQueuedSmsForMapping(mappingId, account);

      res.status(201).json({ success: true, account, backfilled });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to create account" });
    }
  });

  // Dismiss a pending institution permanently — its future SMS are logged but never turned
  // into transactions, and you won't be asked about it again.
  app.post("/api/institution-mappings/:id/ignore", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const mappingId = parseInt(req.params.id);

      const pending = await storage.getPendingSenderInstitutionMappings(userId);
      const mapping = pending.find(m => m.id === mappingId);
      if (!mapping) {
        return res.status(404).json({ error: "Institution mapping not found" });
      }

      const updated = await storage.resolveSenderInstitutionMapping(mappingId, { status: "ignored" });
      res.json({ success: true, mapping: updated });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to ignore institution" });
    }
  });

  // ========== Bills Inbox ==========
  // Due-reminder SMS that couldn't be matched to a credit card (parseDueSms/processDueSms in
  // the SMS parsing section above) land here for one-time triage. Once linked, future SMS from
  // the same sender auto-route — see bill_sender_mappings / processDueSms.

  app.get("/api/bill-mappings/pending", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const mappings = await storage.getPendingBillSenderMappings(userId);

      const enriched = await Promise.all(mappings.map(async (mapping) => {
        const logs = await storage.getSmsLogsForBillMapping(mapping.id);
        const latest = logs[0];
        const latestParsed = latest ? parseDueSms(latest.message) : null;
        return {
          ...mapping,
          latestAmount: latestParsed?.amount ?? null,
          latestDueDate: latestParsed?.dueDate ?? null,
          latestReceivedAt: latest?.receivedAt ?? null,
          latestMessage: latest?.message ?? null,
        };
      }));

      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch pending bill mappings" });
    }
  });

  // Link a pending bill sender to an existing scheduled payment.
  app.post("/api/bill-mappings/:id/link", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const mappingId = parseInt(req.params.id);
      const { scheduledPaymentId } = req.body;

      const pending = await storage.getPendingBillSenderMappings(userId);
      const mapping = pending.find(m => m.id === mappingId);
      if (!mapping) {
        return res.status(404).json({ error: "Bill mapping not found" });
      }

      const scheduledPayment = await storage.getScheduledPayment(scheduledPaymentId);
      if (!scheduledPayment || scheduledPayment.userId !== userId) {
        return res.status(404).json({ error: "Scheduled payment not found" });
      }

      const updated = await storage.resolveBillSenderMapping(mappingId, { status: "mapped", scheduledPaymentId: scheduledPayment.id });
      res.json({ success: true, mapping: updated });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to link bill sender" });
    }
  });

  // Create a new scheduled payment for a pending bill sender and link it in one step.
  app.post("/api/bill-mappings/:id/create-scheduled-payment", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const mappingId = parseInt(req.params.id);

      const pending = await storage.getPendingBillSenderMappings(userId);
      const mapping = pending.find(m => m.id === mappingId);
      if (!mapping) {
        return res.status(404).json({ error: "Bill mapping not found" });
      }

      const validatedData = insertScheduledPaymentSchema.parse({ ...req.body, userId });
      const scheduledPayment = await storage.createScheduledPayment(validatedData);

      const updated = await storage.resolveBillSenderMapping(mappingId, { status: "mapped", scheduledPaymentId: scheduledPayment.id });
      res.status(201).json({ success: true, scheduledPayment, mapping: updated });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to create scheduled payment" });
    }
  });

  // Dismiss a pending bill sender permanently — its future due SMS are logged but never
  // surfaced again.
  app.post("/api/bill-mappings/:id/ignore", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const mappingId = parseInt(req.params.id);

      const pending = await storage.getPendingBillSenderMappings(userId);
      const mapping = pending.find(m => m.id === mappingId);
      if (!mapping) {
        return res.status(404).json({ error: "Bill mapping not found" });
      }

      const updated = await storage.resolveBillSenderMapping(mappingId, { status: "ignored" });
      res.json({ success: true, mapping: updated });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to ignore bill sender" });
    }
  });

  // ========== Export Data ==========
  app.post("/api/export", authenticateToken, async (req, res) => {
    try {
      const { format, startDate, endDate } = req.body;
      
      const filters: any = {};
      if (startDate) filters.startDate = new Date(startDate);
      if (endDate) filters.endDate = new Date(endDate);
      
      const transactions = await storage.getAllTransactions(filters);
      
      if (format === "csv") {
        const headers = ["Date", "Type", "Category", "Merchant", "Amount", "Description", "Account"];
        const rows = transactions.map(t => [
          new Date(t.transactionDate).toLocaleDateString('en-IN'),
          t.type,
          t.category?.name || "",
          t.merchant || "",
          t.amount,
          t.description || "",
          t.account?.name || ""
        ]);
        
        const csv = [
          headers.join(","),
          ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
        ].join("\n");
        
        res.json({
          content: csv,
          filename: `finance-tracker-${new Date().toISOString().split('T')[0]}.csv`,
          format: "csv"
        });
      } else if (format === "json") {
        res.json({
          content: JSON.stringify(transactions, null, 2),
          filename: `finance-tracker-${new Date().toISOString().split('T')[0]}.json`,
          format: "json"
        });
      } else {
        res.status(400).json({ error: "Invalid export format. Use 'csv' or 'json'" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  // ========== User Settings ==========
  app.get("/api/user", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      let user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  app.patch("/api/user", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const user = await storage.updateUser(userId, req.body);
      if (user) {
        res.json(user);
      } else {
        res.status(404).json({ error: "User not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  app.post("/api/user/set-pin", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { pin } = req.body;
      if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        res.status(400).json({ error: "PIN must be 4 digits" });
        return;
      }
      const pinHash = await bcrypt.hash(pin, 10);
      await storage.updateUser(userId, { pinHash });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to set PIN" });
    }
  });

  app.post("/api/user/verify-pin", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { pin } = req.body;
      if (!pin) {
        res.json({ valid: false, message: "PIN required" });
        return;
      }
      const user = await storage.getUser(userId);
      if (!user || !user.pinHash) {
        res.json({ valid: false, message: "No PIN set" });
        return;
      }
      const valid = await bcrypt.compare(pin, user.pinHash);
      res.json({ valid });
    } catch (error) {
      res.status(500).json({ error: "Failed to verify PIN" });
    }
  });

  app.post("/api/user/reset-pin", authenticateToken, async (req, res) => {
    try {
      await storage.updateUser(1, { pinHash: null });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to reset PIN" });
    }
  });

  // ========== Loans ==========
  app.get("/api/loans", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const loans = await storage.getAllLoans(userId);
      res.json(loans);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch loans" });
    }
  });

  app.get("/api/loans/:id", async (req, res) => {
    try {
      const loan = await storage.getLoan(parseInt(req.params.id));
      if (loan) {
        res.json(loan);
      } else {
        res.status(404).json({ error: "Loan not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch loan" });
    }
  });

  app.post("/api/loans", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const loanData = { ...req.body, userId };
      const validatedData = insertLoanSchema.parse(loanData);
      const loan = await storage.createLoan(validatedData);
      
      // Auto-generate installments if EMI info is provided
      if (loan.emiAmount && loan.tenure) {
        await storage.generateLoanInstallments(loan.id);
      }
      
      res.status(201).json(loan);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid loan data" });
    }
  });

  app.patch("/api/loans/:id", async (req, res) => {
    try {
      const loan = await storage.updateLoan(parseInt(req.params.id), req.body);
      if (loan) {
        res.json(loan);
      } else {
        res.status(404).json({ error: "Loan not found" });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid loan data" });
    }
  });

  app.delete("/api/loans/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteLoan(parseInt(req.params.id));
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Loan not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete loan" });
    }
  });

  app.post("/api/loans/:id/regenerate-installments", authenticateToken, async (req, res) => {
    try {
      const loanId = parseInt(req.params.id);
      console.log('API: Regenerate installments requested for loan:', loanId);
      const installments = await storage.regenerateLoanInstallments(loanId);
      console.log('API: Regeneration successful, created', installments.length, 'installments');
      console.log('API: First installment date:', installments[0]?.dueDate);
      console.log('API: Last installment date:', installments[installments.length - 1]?.dueDate);
      res.json(installments);
    } catch (error: any) {
      console.error('API: Regeneration failed:', error);
      res.status(400).json({ error: error.message || "Failed to regenerate installments" });
    }
  });

  // Pre-close a loan
  app.post("/api/loans/:id/preclose", authenticateToken, async (req, res) => {
    try {
      const loanId = parseInt(req.params.id);
      const { closureAmount, closureDate, accountId, createTransaction } = req.body;

      if (!closureAmount || !closureDate) {
        return res.status(400).json({ error: "Closure amount and date are required" });
      }

      // Get the loan
      const loan = await storage.getLoan(loanId);
      if (!loan) {
        return res.status(404).json({ error: "Loan not found" });
      }

      if (loan.status !== 'active') {
        return res.status(400).json({ error: "Only active loans can be pre-closed" });
      }

      // Record the preclosure payment
      const closureAmountNum = parseFloat(closureAmount);
      const closureDateObj = new Date(closureDate);
      
      await storage.createLoanPayment({
        loanId,
        paymentDate: closureDateObj,
        amount: closureAmount,
        principalPaid: loan.outstandingAmount, // Principal equals outstanding
        interestPaid: String(Math.max(0, closureAmountNum - parseFloat(loan.outstandingAmount))),
        paymentType: 'prepayment',
        notes: 'Loan Pre-Closure',
        accountId: accountId || null,
      });

      // Update the loan status
      const updatedLoan = await storage.updateLoan(loanId, {
        status: 'preclosed',
        outstandingAmount: '0',
        closureDate: closureDateObj,
        closureAmount,
      });

      // Cancel pending installments
      const installments = await storage.getLoanInstallments(loanId);
      for (const inst of installments) {
        if (inst.status === 'pending') {
          await storage.updateLoanInstallment(inst.id, { status: 'cancelled' as any });
        }
      }

      // Optionally create a transaction
      if (createTransaction && accountId) {
        // Get or create "Loan" category
        const allCategories = await storage.getAllCategories();
        let loanCategory = allCategories.find((c: { name: string }) => c.name === 'Loan' || c.name === 'EMI');
        if (!loanCategory) {
          loanCategory = await storage.createCategory({
            name: 'Loan',
            type: 'expense',
            icon: 'cash',
            color: '#10b981',
          });
        }

        await storage.createTransaction({
          userId: 1,
          accountId,
          categoryId: loanCategory.id,
          type: 'debit',
          amount: closureAmount,
          merchant: `${loan.name} - Pre-Closure`,
          description: `Loan pre-closure payment`,
          transactionDate: closureDate,
        });

        // Update account balance
        const account = await storage.getAccount(accountId);
        if (account && account.balance) {
          const newBalance = parseFloat(account.balance) - closureAmountNum;
          await storage.updateAccount(accountId, { balance: String(newBalance) });
        }
      }

      res.json(updatedLoan);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to pre-close loan" });
    }
  });

  // Top-up a loan (add additional principal)
  app.post("/api/loans/:id/topup", authenticateToken, async (req, res) => {
    try {
      const loanId = parseInt(req.params.id);
      const { 
        topupAmount, 
        disbursementDate, 
        newEmiAmount, 
        additionalTenure,
        interestRate,
        accountId, 
        createTransaction,
        notes 
      } = req.body;

      if (!topupAmount || parseFloat(topupAmount) <= 0) {
        return res.status(400).json({ error: "Valid top-up amount is required" });
      }

      // Get the loan
      const loan = await storage.getLoan(loanId);
      if (!loan) {
        return res.status(404).json({ error: "Loan not found" });
      }

      if (loan.status !== 'active') {
        return res.status(400).json({ error: "Only active loans can be topped up" });
      }

      const topupAmountNum = parseFloat(topupAmount);
      const currentOutstanding = parseFloat(loan.outstandingAmount);
      const currentPrincipal = parseFloat(loan.principalAmount);
      const newOutstanding = currentOutstanding + topupAmountNum;
      const newPrincipal = currentPrincipal + topupAmountNum;
      
      // Calculate new tenure if additional tenure is provided
      const currentTenure = loan.tenure || 0;
      const newTenure = additionalTenure ? currentTenure + parseInt(additionalTenure) : currentTenure;
      
      // Use new EMI if provided, otherwise keep existing
      const effectiveEmi = newEmiAmount || loan.emiAmount;
      const effectiveRate = interestRate || loan.interestRate;

      // Create a loan term record to track the top-up
      const effectiveFromDate = disbursementDate ? new Date(disbursementDate) : new Date();
      
      await storage.createLoanTerm({
        loanId,
        effectiveFrom: effectiveFromDate,
        interestRate: effectiveRate,
        tenureMonths: newTenure,
        emiAmount: effectiveEmi,
        outstandingAtChange: String(newOutstanding),
        reason: `Top-up of ${topupAmount}`,
        notes: notes || `Loan top-up: Added principal ${topupAmount}`,
      });

      // Update the loan with new amounts
      const updatedLoan = await storage.updateLoan(loanId, {
        principalAmount: String(newPrincipal),
        outstandingAmount: String(newOutstanding),
        tenure: newTenure,
        emiAmount: effectiveEmi,
        interestRate: effectiveRate,
      });

      // Optionally credit the top-up amount to account
      if (createTransaction && accountId) {
        // Get or create "Loan" category
        const allCategories = await storage.getAllCategories();
        let loanCategory = allCategories.find((c: { name: string }) => c.name === 'Loan' || c.name === 'Loan Disbursement');
        if (!loanCategory) {
          loanCategory = await storage.createCategory({
            name: 'Loan Disbursement',
            type: 'income',
            icon: 'cash',
            color: '#10b981',
          });
        }

        await storage.createTransaction({
          userId: 1,
          accountId,
          categoryId: loanCategory.id,
          type: 'credit',
          amount: topupAmount,
          merchant: `${loan.name} - Top-Up`,
          description: `Loan top-up disbursement`,
          transactionDate: effectiveFromDate.toISOString().split('T')[0],
        });

        // Update account balance (credit = add money)
        const account = await storage.getAccount(accountId);
        if (account && account.balance) {
          const newBalance = parseFloat(account.balance) + topupAmountNum;
          await storage.updateAccount(accountId, { balance: String(newBalance) });
        }
      }

      // Regenerate future installments
      await storage.generateLoanInstallments(loanId);

      res.json(updatedLoan);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to top-up loan" });
    }
  });

  // Part Payment - pay extra to reduce outstanding principal
  app.post("/api/loans/:id/part-payment", authenticateToken, async (req, res) => {
    try {
      const loanId = parseInt(req.params.id);
      const { amount, paymentDate, effect, accountId, createTransaction } = req.body;

      if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: "Valid payment amount is required" });
      }

      const paymentAmount = parseFloat(amount);

      // Get the loan
      const loan = await storage.getLoan(loanId);
      if (!loan) {
        return res.status(404).json({ error: "Loan not found" });
      }

      if (loan.status !== 'active') {
        return res.status(400).json({ error: "Only active loans can receive part payments" });
      }

      const outstanding = parseFloat(loan.outstandingAmount);
      if (paymentAmount > outstanding) {
        return res.status(400).json({ error: "Payment amount cannot exceed outstanding balance" });
      }

      // Update outstanding amount
      const newOutstanding = outstanding - paymentAmount;
      
      // Get current loan terms
      const currentTerms = await storage.getLoanTerms(loanId);
      const latestTerm = currentTerms.length > 0 ? currentTerms[currentTerms.length - 1] : null;
      
      // Get current values
      const currentEmi = parseFloat(latestTerm?.emiAmount || loan.emiAmount || '0');
      const currentInterestRate = parseFloat(latestTerm?.interestRate || loan.interestRate || '0');
      const monthlyRate = currentInterestRate / 12 / 100;
      
      // Calculate remaining tenure from loan start date
      const loanStartDate = new Date(loan.startDate || new Date());
      const paymentDateObj = new Date(paymentDate);
      const monthsElapsed = Math.floor(
        (paymentDateObj.getTime() - loanStartDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
      );
      const originalTenure = latestTerm?.tenureMonths || loan.tenure;
      const remainingMonths = Math.max(1, originalTenure - monthsElapsed);
      
      let newEmi = currentEmi;
      let newTenure = remainingMonths;
      
      // Calculate based on effect choice
      if (newOutstanding > 0) {
        if (effect === 'reduce_emi') {
          // Keep same tenure, calculate new EMI
          // EMI = P * r * (1+r)^n / ((1+r)^n - 1)
          if (monthlyRate > 0) {
            const factor = Math.pow(1 + monthlyRate, remainingMonths);
            newEmi = (newOutstanding * monthlyRate * factor) / (factor - 1);
          } else {
            // Simple division for 0% interest
            newEmi = newOutstanding / remainingMonths;
          }
          newTenure = remainingMonths;
        } else {
          // Keep same EMI, calculate new tenure
          // n = log(EMI / (EMI - P * r)) / log(1 + r)
          if (monthlyRate > 0 && currentEmi > newOutstanding * monthlyRate) {
            newTenure = Math.ceil(
              Math.log(currentEmi / (currentEmi - newOutstanding * monthlyRate)) / 
              Math.log(1 + monthlyRate)
            );
          } else if (monthlyRate === 0) {
            // Simple division for 0% interest
            newTenure = Math.ceil(newOutstanding / currentEmi);
          } else {
            // Fallback: EMI too low to cover interest, keep original tenure
            newTenure = remainingMonths;
          }
          newEmi = currentEmi;
        }
      }
      
      // Calculate new EMI due date based on payment date
      const nextEmiDate = new Date(paymentDateObj);
      nextEmiDate.setMonth(nextEmiDate.getMonth() + 1);
      // Use day from start date as EMI due date
      nextEmiDate.setDate(loanStartDate.getDate() || 1);
      
      // Prepare update data
      let updateData: any = {
        outstandingAmount: newOutstanding.toFixed(2),
        emiAmount: newEmi.toFixed(2),
        tenure: newTenure,
      };

      // If payment closes the loan
      if (newOutstanding <= 0) {
        updateData.status = 'preclosed';
        updateData.closureDate = paymentDateObj;
        updateData.closureAmount = paymentAmount.toFixed(2);
        updateData.emiAmount = '0';
        updateData.tenure = 0;
      }

      const updatedLoan = await storage.updateLoan(loanId, updateData);

      // Create payment record with details
      await storage.createLoanPayment({
        loanId,
        paymentDate: paymentDateObj,
        amount: amount,
        paymentType: 'prepayment',
        accountId: accountId || null,
        notes: effect === 'reduce_emi' 
          ? `Part payment - Reduce EMI from ₹${currentEmi.toFixed(0)} to ₹${newEmi.toFixed(0)}` 
          : `Part payment - Reduce Tenure from ${remainingMonths} to ${newTenure} months`
      });

      // Add a term record to track this event with new values
      await storage.createLoanTerm({
        loanId,
        effectiveFrom: paymentDateObj,
        interestRate: currentInterestRate.toString(),
        tenureMonths: newTenure,
        emiAmount: newEmi.toFixed(2),
        reason: effect === 'reduce_emi' 
          ? `Part payment of ₹${paymentAmount.toFixed(0)} - EMI reduced from ₹${currentEmi.toFixed(0)} to ₹${newEmi.toFixed(0)}`
          : `Part payment of ₹${paymentAmount.toFixed(0)} - Tenure reduced from ${remainingMonths} to ${newTenure} months`,
      });

      // Optionally create a transaction
      if (createTransaction && accountId) {
        const allCategories = await storage.getAllCategories();
        let loanCategory = allCategories.find((c: { name: string }) => c.name === 'Loan' || c.name === 'EMI');
        if (!loanCategory) {
          loanCategory = await storage.createCategory({
            name: 'Loan',
            type: 'expense',
            icon: 'cash',
            color: '#10b981',
          });
        }

        await storage.createTransaction({
          userId: 1,
          accountId,
          categoryId: loanCategory.id,
          type: 'debit',
          amount: amount,
          merchant: `${loan.name} - Part Payment`,
          description: effect === 'reduce_emi' 
            ? 'Part payment to reduce EMI' 
            : 'Part payment to reduce tenure',
          transactionDate: paymentDate,
        });

        // Update account balance
        const account = await storage.getAccount(accountId);
        if (account && account.balance) {
          const newBalance = parseFloat(account.balance) - paymentAmount;
          await storage.updateAccount(accountId, { balance: String(newBalance) });
        }
      }

      res.json(updatedLoan);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to process part payment" });
    }
  });

  app.post("/api/loans/:id/generate-schedule", authenticateToken, async (req, res) => {
    try {
      const installments = await storage.generateLoanInstallments(parseInt(req.params.id));
      res.json(installments);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate installments" });
    }
  });

  app.post("/api/loans/:id/generate-installments", authenticateToken, async (req, res) => {
    try {
      const installments = await storage.generateLoanInstallments(parseInt(req.params.id));
      res.json(installments);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate installments" });
    }
  });

  app.get("/api/loans/:id/details", async (req, res) => {
    try {
      const loan = await storage.getLoan(parseInt(req.params.id));
      if (!loan) {
        return res.status(404).json({ error: "Loan not found" });
      }
      const [terms, installments, payments] = await Promise.all([
        storage.getLoanTerms(loan.id),
        storage.getLoanInstallments(loan.id),
        storage.getLoanPayments(loan.id)
      ]);
      res.json({ ...loan, terms, installments, payments });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch loan details" });
    }
  });

  app.get("/api/loans/:loanId/installments", async (req, res) => {
    try {
      const installments = await storage.getLoanInstallments(parseInt(req.params.loanId));
      res.json(installments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch installments" });
    }
  });

  app.patch("/api/loans/:loanId/installments/:id", async (req, res) => {
    try {
      const installment = await storage.updateLoanInstallment(parseInt(req.params.id), req.body);
      if (installment) {
        res.json(installment);
      } else {
        res.status(404).json({ error: "Installment not found" });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid installment data" });
    }
  });

  app.get("/api/loans/:loanId/spending-entries", async (req, res) => {
    try {
      const entries = await storage.getLoanSpendingEntries(parseInt(req.params.loanId));
      res.json(entries);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch spending entries" });
    }
  });

  app.post("/api/loans/:loanId/spending-entries", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const loanId = parseInt(req.params.loanId);

      const loan = await storage.getLoan(loanId);
      if (!loan || loan.userId !== userId) {
        return res.status(404).json({ error: "Loan not found" });
      }

      const { amount, reason } = req.body;
      const existingEntries = await storage.getLoanSpendingEntries(loanId);
      const validationError = validateNewSpendingEntry(loan.receivedAmount, existingEntries, parseFloat(amount));
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const entry = await storage.createLoanSpendingEntry({ loanId, amount, reason: reason || null });
      res.status(201).json(entry);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid spending entry data" });
    }
  });

  app.delete("/api/spending-entries/:id", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const entryId = parseInt(req.params.id);

      // No direct getLoanSpendingEntry(id) lookup exists — fetch via the loan's list instead,
      // matching the pattern used for other sub-resources that lack a single-row getter.
      const allLoans = await storage.getAllLoans(userId);
      let owned = false;
      for (const loan of allLoans) {
        const entries = await storage.getLoanSpendingEntries(loan.id);
        if (entries.some(e => e.id === entryId)) {
          owned = true;
          break;
        }
      }
      if (!owned) {
        return res.status(404).json({ error: "Spending entry not found" });
      }

      const deleted = await storage.deleteLoanSpendingEntry(entryId);
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Spending entry not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete spending entry" });
    }
  });

  app.post("/api/loans/:loanId/installments/:id/pay", authenticateToken, async (req, res) => {
    try {
      const { paidDate, paidAmount, accountId, notes, createTransaction, affectBalance } = req.body;
      const loanId = parseInt(req.params.loanId);
      const installmentId = parseInt(req.params.id);
      
      // Convert to explicit booleans (handle string/undefined values)
      const shouldCreateTransaction = createTransaction === true || createTransaction === 'true';
      const shouldAffectBalance = affectBalance === true || affectBalance === 'true';
      
      const payment = await storage.createLoanPayment({
        loanId,
        installmentId,
        paymentDate: new Date(paidDate),
        amount: paidAmount,
        paymentType: 'emi',
        accountId: accountId || null,
        notes: notes || null
      });
      
      let transactionId: number | undefined = undefined;
      
      // Create transaction ONLY if explicitly requested
      if (shouldCreateTransaction && accountId) {
        const loan = await storage.getLoan(loanId);
        const allCategories = await storage.getAllCategories();
        let loanCategory = allCategories.find((c: { name: string }) => c.name === 'Loan' || c.name === 'EMI');
        if (!loanCategory) {
          loanCategory = await storage.createCategory({
            name: 'EMI',
            type: 'expense',
            icon: 'cash',
            color: '#ef4444',
          });
        }

        const transaction = await storage.createTransaction({
          userId: 1,
          accountId,
          categoryId: loanCategory.id,
          type: 'debit',
          amount: paidAmount,
          merchant: loan?.name || 'Loan EMI',
          description: `EMI payment for ${loan?.name || 'Loan'}`,
          transactionDate: paidDate,
        });
        
        transactionId = transaction.id;
        
        // Update the loan payment to link it to the transaction
        await storage.updateLoanPayment(payment.id, { transactionId: transaction.id });
      }
      
      // Mark the installment as paid with the transaction ID (if created)
      await storage.markInstallmentPaid(installmentId, paidAmount, transactionId);

      // Update account balance ONLY if explicitly requested
      if (shouldAffectBalance && accountId) {
        const account = await storage.getAccount(accountId);
        if (account && account.balance) {
          const newBalance = parseFloat(account.balance) - parseFloat(paidAmount);
          await storage.updateAccount(accountId, { balance: String(newBalance) });
        }
      }
      
      const installment = await storage.getLoanInstallment(installmentId);
      res.json(installment);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to mark installment paid" });
    }
  });

  app.get("/api/loans/:loanId/terms", async (req, res) => {
    try {
      const terms = await storage.getLoanTerms(parseInt(req.params.loanId));
      res.json(terms);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch loan terms" });
    }
  });

  app.post("/api/loans/:loanId/terms", authenticateToken, async (req, res) => {
    try {
      const validatedData = insertLoanTermSchema.parse({
        ...req.body,
        loanId: parseInt(req.params.loanId),
        effectiveFrom: req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : new Date(),
        effectiveTo: req.body.effectiveTo ? new Date(req.body.effectiveTo) : null
      });
      const term = await storage.createLoanTerm(validatedData);
      res.status(201).json(term);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid term data" });
    }
  });

  app.get("/api/loans/:loanId/payments", async (req, res) => {
    try {
      const payments = await storage.getLoanPayments(parseInt(req.params.loanId));
      res.json(payments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch loan payments" });
    }
  });

  app.post("/api/loans/:loanId/payments", authenticateToken, async (req, res) => {
    try {
      const validatedData = insertLoanPaymentSchema.parse({
        ...req.body,
        loanId: parseInt(req.params.loanId),
        paymentDate: req.body.paymentDate ? new Date(req.body.paymentDate) : new Date()
      });
      const payment = await storage.createLoanPayment(validatedData);
      res.status(201).json(payment);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid payment data" });
    }
  });

  app.patch("/api/loan-payments/:id", async (req, res) => {
    try {
      const updateData = {
        ...req.body,
        paymentDate: req.body.paymentDate ? new Date(req.body.paymentDate) : undefined
      };
      const payment = await storage.updateLoanPayment(parseInt(req.params.id), updateData);
      if (payment) {
        res.json(payment);
      } else {
        res.status(404).json({ error: "Payment not found" });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid payment data" });
    }
  });

  app.delete("/api/loan-payments/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteLoanPayment(parseInt(req.params.id));
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Payment not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete payment" });
    }
  });

  // ========== Loan Components (for CC EMIs) ==========
  app.get("/api/loans/:loanId/components", async (req, res) => {
    try {
      const components = await storage.getLoanComponents(parseInt(req.params.loanId));
      res.json(components);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch loan components" });
    }
  });

  app.post("/api/loans/:loanId/components", authenticateToken, async (req, res) => {
    try {
      const validatedData = insertLoanComponentSchema.parse({
        ...req.body,
        loanId: parseInt(req.params.loanId)
      });
      const component = await storage.createLoanComponent(validatedData);
      res.status(201).json(component);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid component data" });
    }
  });

  app.patch("/api/loan-components/:id", async (req, res) => {
    try {
      const component = await storage.updateLoanComponent(parseInt(req.params.id), req.body);
      if (component) {
        res.json(component);
      } else {
        res.status(404).json({ error: "Component not found" });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid component data" });
    }
  });

  app.delete("/api/loan-components/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteLoanComponent(parseInt(req.params.id));
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Component not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete component" });
    }
  });

  // ========== Loan Installments ==========
  app.get("/api/loans/:loanId/installments", async (req, res) => {
    try {
      const installments = await storage.getLoanInstallments(parseInt(req.params.loanId));
      res.json(installments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch installments" });
    }
  });

  app.patch("/api/loan-installments/:id", async (req, res) => {
    try {
      const installment = await storage.updateLoanInstallment(parseInt(req.params.id), req.body);
      if (installment) {
        res.json(installment);
      } else {
        res.status(404).json({ error: "Installment not found" });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid installment data" });
    }
  });

  app.post("/api/loan-installments/:id/mark-paid", async (req, res) => {
    try {
      const { paidAmount, transactionId } = req.body;
      const installment = await storage.markInstallmentPaid(
        parseInt(req.params.id), 
        paidAmount, 
        transactionId
      );
      if (installment) {
        res.json(installment);
      } else {
        res.status(404).json({ error: "Installment not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to mark installment as paid" });
    }
  });

  // ========== Loan BT Allocations ==========
  app.get("/api/loans/:loanId/bt-allocations", async (req, res) => {
    try {
      const allocations = await storage.getLoanBtAllocations(parseInt(req.params.loanId));
      res.json(allocations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch BT allocations" });
    }
  });

  app.get("/api/loans/:loanId/bt-allocations-as-target", async (req, res) => {
    try {
      const allocations = await storage.getLoanBtAllocationsByTarget(parseInt(req.params.loanId));
      res.json(allocations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch BT allocations" });
    }
  });

  app.get("/api/bt-allocations/:id", async (req, res) => {
    try {
      const allocation = await storage.getLoanBtAllocation(parseInt(req.params.id));
      if (allocation) {
        res.json(allocation);
      } else {
        res.status(404).json({ error: "BT allocation not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch BT allocation" });
    }
  });

  app.post("/api/loans/:loanId/bt-allocations", authenticateToken, async (req, res) => {
    try {
      const allocation = await storage.createLoanBtAllocation({
        ...req.body,
        sourceLoanId: parseInt(req.params.loanId),
      });
      res.status(201).json(allocation);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to create BT allocation" });
    }
  });

  app.patch("/api/bt-allocations/:id", async (req, res) => {
    try {
      const allocation = await storage.updateLoanBtAllocation(parseInt(req.params.id), req.body);
      if (allocation) {
        res.json(allocation);
      } else {
        res.status(404).json({ error: "BT allocation not found" });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid BT allocation data" });
    }
  });

  app.delete("/api/bt-allocations/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteLoanBtAllocation(parseInt(req.params.id));
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "BT allocation not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete BT allocation" });
    }
  });

  app.post("/api/bt-allocations/:id/process", authenticateToken, async (req, res) => {
    try {
      const { actualBtAmount, processedDate, processingFee } = req.body;
      
      if (!actualBtAmount || !processedDate) {
        return res.status(400).json({ error: "actualBtAmount and processedDate are required" });
      }

      const result = await storage.processLoanBtPayment(
        parseInt(req.params.id),
        actualBtAmount,
        new Date(processedDate),
        processingFee
      );

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to process BT payment" });
    }
  });

  // ========== Loan Summary ==========
  app.get("/api/loan-summary", async (_req, res) => {
    try {
      const allLoans = await storage.getAllLoans();
      const activeLoans = allLoans.filter(l => l.status === 'active');
      
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      
      let totalOutstanding = 0;
      let totalEmiThisMonth = 0;
      let nextEmiDue: { loanName: string; amount: string; dueDate: string } | null = null;
      
      for (const loan of activeLoans) {
        totalOutstanding += parseFloat(loan.outstandingAmount);
        
        if (loan.installments) {
          for (const inst of loan.installments) {
            const dueDate = new Date(inst.dueDate);
            if (dueDate.getMonth() + 1 === currentMonth && dueDate.getFullYear() === currentYear) {
              totalEmiThisMonth += parseFloat(inst.emiAmount);
            }
            
            // Find next pending EMI
            if (inst.status === 'pending' && dueDate >= now) {
              if (!nextEmiDue || dueDate < new Date(nextEmiDue.dueDate)) {
                nextEmiDue = {
                  loanName: loan.name,
                  amount: inst.emiAmount,
                  dueDate: inst.dueDate.toISOString()
                };
              }
            }
          }
        }
      }
      
      res.json({
        totalLoans: activeLoans.length,
        totalOutstanding,
        totalEmiThisMonth,
        nextEmiDue
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch loan summary" });
    }
  });

  // ========== Card Details ==========
  app.get("/api/accounts/:accountId/card", async (req, res) => {
    try {
      const card = await storage.getCardDetails(parseInt(req.params.accountId));
      if (card) {
        // Return masked card number for security
        res.json({
          ...card,
          cardNumber: `****-****-****-${card.lastFourDigits}`
        });
      } else {
        res.status(404).json({ error: "Card not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch card" });
    }
  });

  app.post("/api/accounts/:accountId/card", async (req, res) => {
    try {
      // Simple encryption for demo - in production use proper encryption
      const cardNumber = req.body.cardNumber.replace(/\s/g, '');
      const lastFourDigits = cardNumber.slice(-4);
      
      // Basic encryption (in production, use AES-256-GCM or similar)
      const encryptedCardNumber = Buffer.from(cardNumber).toString('base64');
      
      const validatedData = insertCardDetailsSchema.parse({
        ...req.body,
        accountId: parseInt(req.params.accountId),
        cardNumber: encryptedCardNumber,
        lastFourDigits
      });
      
      const card = await storage.createCardDetails(validatedData);
      res.status(201).json({
        ...card,
        cardNumber: `****-****-****-${card.lastFourDigits}`
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid card data" });
    }
  });

  app.patch("/api/cards/:id", async (req, res) => {
    try {
      const updateData = { ...req.body };
      if (updateData.cardNumber) {
        updateData.cardNumber = Buffer.from(updateData.cardNumber.replace(/\s/g, '')).toString('base64');
        updateData.lastFourDigits = req.body.cardNumber.slice(-4);
      }
      
      const card = await storage.updateCardDetails(parseInt(req.params.id), updateData);
      if (card) {
        res.json({
          ...card,
          cardNumber: `****-****-****-${card.lastFourDigits}`
        });
      } else {
        res.status(404).json({ error: "Card not found" });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid card data" });
    }
  });

  app.delete("/api/cards/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteCardDetails(parseInt(req.params.id));
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Card not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete card" });
    }
  });

  // Secure endpoint to get full card number (requires PIN verification in real app)
  app.get("/api/accounts/:accountId/card/full", async (req, res) => {
    try {
      const card = await storage.getCardDetails(parseInt(req.params.accountId));
      if (card) {
        // Decrypt card number
        const decryptedCardNumber = Buffer.from(card.cardNumber, 'base64').toString('utf8');
        res.json({
          ...card,
          cardNumber: decryptedCardNumber
        });
      } else {
        res.status(404).json({ error: "Card not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch card" });
    }
  });

  // ========== Insurance ==========
  app.get("/api/insurances", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const insurances = await storage.getAllInsurances(userId);
      res.json(insurances);
    } catch (error) {
      console.error("Error fetching insurances:", error);
      res.status(500).json({ error: "Failed to fetch insurances" });
    }
  });

  app.get("/api/insurances/:id", async (req, res) => {
    try {
      const insurance = await storage.getInsurance(parseInt(req.params.id));
      if (insurance) {
        res.json(insurance);
      } else {
        res.status(404).json({ error: "Insurance not found" });
      }
    } catch (error) {
      console.error("Error fetching insurance:", error);
      res.status(500).json({ error: "Failed to fetch insurance" });
    }
  });

  app.post("/api/insurances", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const insuranceData = { ...req.body, userId };
      const validatedData = insertInsuranceSchema.parse(insuranceData);
      const insurance = await storage.createInsurance(validatedData);
      
      // Auto-generate premium terms
      if (insurance.id) {
        await storage.generateInsurancePremiums(insurance.id);
      }
      
      // Return with premiums
      const fullInsurance = await storage.getInsurance(insurance.id);
      res.status(201).json(fullInsurance);
    } catch (error: any) {
      console.error("Error creating insurance:", error);
      res.status(400).json({ error: error.message || "Invalid insurance data" });
    }
  });

  app.patch("/api/insurances/:id", async (req, res) => {
    try {
      const validatedData = insertInsuranceSchema.partial().parse(req.body);
      const insurance = await storage.updateInsurance(parseInt(req.params.id), validatedData);
      if (insurance) {
        // If premium-related fields changed, regenerate premiums
        if (req.body.premiumAmount || req.body.termsPerPeriod || req.body.premiumFrequency || req.body.startDate || req.body.endDate) {
          await storage.generateInsurancePremiums(insurance.id);
        }
        const fullInsurance = await storage.getInsurance(insurance.id);
        res.json(fullInsurance);
      } else {
        res.status(404).json({ error: "Insurance not found" });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid insurance data" });
    }
  });

  app.delete("/api/insurances/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteInsurance(parseInt(req.params.id));
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Insurance not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete insurance" });
    }
  });

  // ========== Insurance Premiums ==========
  app.get("/api/insurances/:insuranceId/premiums", async (req, res) => {
    try {
      const premiums = await storage.getInsurancePremiums(parseInt(req.params.insuranceId));
      res.json(premiums);
    } catch (error) {
      console.error("Error fetching premiums:", error);
      res.status(500).json({ error: "Failed to fetch premiums" });
    }
  });

  app.post("/api/insurances/:insuranceId/premiums", authenticateToken, async (req, res) => {
    try {
      const validatedData = insertInsurancePremiumSchema.parse({
        ...req.body,
        insuranceId: parseInt(req.params.insuranceId)
      });
      const premium = await storage.createInsurancePremium(validatedData);
      res.status(201).json(premium);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid premium data" });
    }
  });

  app.patch("/api/insurances/:insuranceId/premiums/:id", async (req, res) => {
    try {
      const premium = await storage.updateInsurancePremium(parseInt(req.params.id), req.body);
      if (premium) {
        res.json(premium);
      } else {
        res.status(404).json({ error: "Premium not found" });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid premium data" });
    }
  });

  app.post("/api/insurances/:insuranceId/premiums/:id/pay", authenticateToken, async (req, res) => {
    try {
      const { amount, accountId, createTransaction: shouldCreateTransaction, affectAccountBalance } = req.body;
      const premiumId = parseInt(req.params.id);
      const insuranceId = parseInt(req.params.insuranceId);
      
      let transactionId: number | undefined;
      const targetAccountId = accountId;
      
      // Create transaction if requested
      if (shouldCreateTransaction) {
        const insurance = await storage.getInsurance(insuranceId);
        if (insurance) {
          // Get or create insurance category
          let category = await storage.getCategoryByName("Insurance");
          if (!category) {
            category = await storage.createCategory({
              name: "Insurance",
              icon: "shield",
              color: "#6366f1",
              type: "expense"
            });
          }
          
          const transaction = await storage.createTransaction({
            userId: insurance.userId,
            accountId: targetAccountId || insurance.accountId,
            categoryId: category.id,
            amount,
            type: "debit",
            description: `Insurance Premium - ${insurance.name}`,
            merchant: insurance.providerName || insurance.name,
            transactionDate: new Date().toISOString()
          });
          transactionId = transaction.id;
        }
      }
      
      // Deduct from account balance if requested
      if (affectAccountBalance && targetAccountId) {
        const account = await storage.getAccount(targetAccountId);
        if (account) {
          const currentBalance = parseFloat(account.balance || '0') || 0;
          const paymentAmount = parseFloat(amount) || 0;
          const newBalance = (currentBalance - paymentAmount).toFixed(2);
          await storage.updateAccount(targetAccountId, { balance: newBalance });
        }
      }
      
      const premium = await storage.markPremiumPaid(premiumId, amount, targetAccountId, transactionId);
      if (premium) {
        res.json(premium);
      } else {
        res.status(404).json({ error: "Premium not found" });
      }
    } catch (error: any) {
      console.error("Error marking premium as paid:", error);
      res.status(400).json({ error: error.message || "Failed to mark premium as paid" });
    }
  });

  app.delete("/api/insurances/:insuranceId/premiums/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteInsurancePremium(parseInt(req.params.id));
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Premium not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete premium" });
    }
  });

  // Regenerate premiums for an insurance
  app.post("/api/insurances/:id/regenerate-premiums", authenticateToken, async (req, res) => {
    try {
      const premiums = await storage.generateInsurancePremiums(parseInt(req.params.id));
      res.json(premiums);
    } catch (error) {
      console.error("Error regenerating premiums:", error);
      res.status(500).json({ error: "Failed to regenerate premiums" });
    }
  });

  app.delete("/api/users/delete-account", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");

      await db.execute(sql`DELETE FROM loan_payments WHERE loan_id IN (SELECT id FROM loans WHERE user_id = ${userId})`);
      await db.execute(sql`DELETE FROM loan_installments WHERE loan_id IN (SELECT id FROM loans WHERE user_id = ${userId})`);
      await db.execute(sql`DELETE FROM loan_components WHERE loan_id IN (SELECT id FROM loans WHERE user_id = ${userId})`);
      await db.execute(sql`DELETE FROM loan_terms WHERE loan_id IN (SELECT id FROM loans WHERE user_id = ${userId})`);
      await db.execute(sql`DELETE FROM loan_bt_allocations WHERE source_loan_id IN (SELECT id FROM loans WHERE user_id = ${userId}) OR target_loan_id IN (SELECT id FROM loans WHERE user_id = ${userId})`);
      await db.execute(sql`DELETE FROM loans WHERE user_id = ${userId}`);

      await db.execute(sql`DELETE FROM insurance_premiums WHERE insurance_id IN (SELECT id FROM insurances WHERE user_id = ${userId})`);
      await db.execute(sql`DELETE FROM insurances WHERE user_id = ${userId}`);

      await db.execute(sql`DELETE FROM card_details WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ${userId})`);
      await db.execute(sql`DELETE FROM credit_card_statements WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ${userId})`);

      await db.execute(sql`DELETE FROM payment_occurrences WHERE scheduled_payment_id IN (SELECT id FROM scheduled_payments WHERE user_id = ${userId})`);
      await db.execute(sql`DELETE FROM scheduled_payments WHERE user_id = ${userId}`);

      await db.execute(sql`DELETE FROM savings_contributions WHERE savings_goal_id IN (SELECT id FROM savings_goals WHERE user_id = ${userId})`);
      await db.execute(sql`DELETE FROM savings_goals WHERE user_id = ${userId}`);

      await db.execute(sql`DELETE FROM salary_cycles WHERE salary_profile_id IN (SELECT id FROM salary_profiles WHERE user_id = ${userId})`);
      await db.execute(sql`DELETE FROM salary_profiles WHERE user_id = ${userId}`);

      await db.execute(sql`DELETE FROM sms_logs WHERE user_id = ${userId} OR transaction_id IN (SELECT id FROM transactions WHERE user_id = ${userId})`);
      await db.execute(sql`DELETE FROM budgets WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM transactions WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM accounts WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);

      res.json({ message: "Account and all data deleted successfully" });
    } catch (error) {
      console.error("Error deleting user account:", error);
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
