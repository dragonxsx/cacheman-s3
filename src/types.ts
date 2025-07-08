/**
 * Core TypeScript interfaces and types for cacheman-s3
 */

import {
  S3Client,
  S3ClientConfig,
  StorageClass,
  ServerSideEncryption
} from '@aws-sdk/client-s3';

/**
 * Branded type for sanitized cache keys
 */
export type CacheKey = string & { readonly __brand: 'CacheKey' };

/**
 * TTL value type - can be a number of seconds or -1 for infinite
 */
export type TTL = number | -1;

/**
 * Standard Node.js callback pattern
 */
export type Callback<T = void> = (error: Error | null, result?: T) => void;

/**
 * S3Store configuration options - compatible with AWS SDK S3ClientConfig
 */
export interface S3StoreOptions extends Pick<S3ClientConfig, 'credentials' | 'forcePathStyle' | 'maxAttempts' | 'requestHandler'> {
  /** S3 bucket name (required) */
  bucket: string;

  /** AWS region */
  region?: string;

  /** AWS access key ID (alternative to credentials object) */
  accessKeyId?: string;

  /** AWS secret access key (alternative to credentials object) */
  secretAccessKey?: string;

  /** AWS session token for temporary credentials (alternative to credentials object) */
  sessionToken?: string;

  /** Cache key prefix */
  prefix?: string;

  /** Default TTL in seconds */
  defaultTtl?: number;

  /** S3 storage class */
  storageClass?: StorageClass;

  /** Server-side encryption */
  serverSideEncryption?: ServerSideEncryption;

  /** Maximum number of retry attempts (alias for maxAttempts) */
  maxRetries?: number;

  /** HTTP request timeout in milliseconds */
  httpTimeout?: number;

  /** Custom S3 endpoint URL (for LocalStack or other S3-compatible services) */
  endpoint?: string;
}

/**
 * Validated and processed S3Store configuration
 */
export interface ProcessedS3StoreOptions extends Required<Pick<S3StoreOptions, 'bucket' | 'prefix' | 'defaultTtl'>> {
  region: string;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  sessionToken: string | undefined;
  storageClass: StorageClass | undefined;
  serverSideEncryption: ServerSideEncryption | undefined;
  maxRetries: number;
  httpTimeout: number;
  endpoint: string | undefined;
  forcePathStyle: boolean | undefined;
}

/**
 * Cache entry metadata stored in S3
 */
export interface CacheMetadata {
  /** Timestamp when cache was created */
  'cache-created': string;

  /** Cache schema version */
  'cache-version': string;

  /** TTL expiration timestamp (optional) */
  'cache-ttl'?: string;

  /** Index signature for additional metadata */
  [key: string]: string | undefined;
}

/**
 * Result of scan operation
 */
export interface ScanResult<T = unknown> {
  /** Continuation cursor (0 means no more results) */
  cursor: number | string;

  /** Array of cache entries */
  entries: Array<{
    key: string;
    data: T;
  }>;
}

/**
 * Health check result
 */
export interface HealthStatus {
  /** Health status */
  status: 'healthy' | 'unhealthy';

  /** S3 bucket name */
  bucket: string;

  /** AWS region */
  region: string;

  /** AWS SDK version */
  sdkVersion: string;

  /** Optional error message */
  error?: string;
}

/**
 * Error types specific to S3Store operations
 */
export class S3StoreError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'S3StoreError';
  }
}

/**
 * Configuration validation error
 */
export class ConfigurationError extends S3StoreError {
  constructor(message: string, originalError?: Error) {
    super(message, 'CONFIGURATION_ERROR', undefined, originalError);
    this.name = 'ConfigurationError';
  }
}

/**
 * S3 operation error
 */
export class S3OperationError extends S3StoreError {
  constructor(message: string, statusCode?: number, originalError?: Error) {
    super(message, 'S3_OPERATION_ERROR', statusCode, originalError);
    this.name = 'S3OperationError';
  }
}

/**
 * Serialization error
 */
export class SerializationError extends S3StoreError {
  constructor(message: string, originalError?: Error) {
    super(message, 'SERIALIZATION_ERROR', undefined, originalError);
    this.name = 'SerializationError';
  }
}

/**
 * TTL validation error
 */
export class TTLError extends S3StoreError {
  constructor(message: string) {
    super(message, 'TTL_ERROR');
    this.name = 'TTLError';
  }
}

/**
 * Get operation callback
 */
export type GetCallback<T = unknown> = Callback<T | null>;

/**
 * Set operation callback
 */
export type SetCallback<T = unknown> = Callback<T>;

/**
 * Delete operation callback
 */
export type DeleteCallback = Callback<void>;

/**
 * Clear operation callback
 */
export type ClearCallback = Callback<void>;

/**
 * Scan operation callback
 */
export type ScanCallback<T = unknown> = Callback<ScanResult<T>>;

/**
 * Health check callback
 */
export type HealthCallback = Callback<HealthStatus>;

/**
 * Stream conversion callback
 */
export type StreamCallback = Callback<string>;

/**
 * Type guard for checking if value is defined
 */
export function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

/**
 * Type guard for checking if value is a valid TTL
 */
export function isValidTTL(value: unknown): value is TTL {
  return typeof value === 'number' && (value === -1 || value > 0);
}

/**
 * Type guard for checking if string is a valid cache key
 */
export function isValidCacheKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0;
}

/**
 * S3Client wrapper interface for better type safety
 */
export interface TypedS3Client {
  client: S3Client;
  send: S3Client['send'];
  config: S3Client['config'];
}
