import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to validate API key for external integrations (e.g., Tasker)
 * Checks X-API-Key header against TASKER_API_KEY environment variable
 */
export function validateApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string;
  const validApiKey = process.env.TASKER_API_KEY;

  // If no API key is configured, allow the request (backward compatibility)
  if (!validApiKey) {
    console.warn('⚠️  TASKER_API_KEY not set - SMS endpoint is unsecured');
    return next();
  }

  if (!apiKey) {
    return res.status(401).json({ 
      error: 'API key required',
      hint: 'Include X-API-Key header with your request'
    });
  }

  if (apiKey !== validApiKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

/**
 * Same pattern as validateApiKey, for Milo's cross-app integration routes (e.g. bills summary).
 * Separate key from TASKER_API_KEY so each integration can be rotated/revoked independently.
 * Checks X-Milo-Api-Key header against MILO_INTEGRATION_KEY environment variable.
 */
export function validateMiloApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-milo-api-key'] as string;
  const validApiKey = process.env.MILO_INTEGRATION_KEY;

  if (!validApiKey) {
    console.warn('⚠️  MILO_INTEGRATION_KEY not set - Milo integration endpoints are unsecured');
    return next();
  }

  if (!apiKey) {
    return res.status(401).json({
      error: 'API key required',
      hint: 'Include X-Milo-Api-Key header with your request'
    });
  }

  if (apiKey !== validApiKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}
