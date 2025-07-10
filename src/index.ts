import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
  GetObjectCommandOutput,
  ListObjectsV2CommandOutput,
  PutObjectCommandInput
} from '@aws-sdk/client-s3';
import sanitize from 'sanitize-filename';
import { Readable } from 'stream';

import {
  S3StoreOptions,
  ProcessedS3StoreOptions,
  CacheMetadata,
  TTL,
  CacheKey,
  GetCallback,
  SetCallback,
  DeleteCallback,
  ClearCallback,
  ScanCallback,
  HealthCallback,
  StreamCallback,
  ConfigurationError,
  S3OperationError,
  SerializationError,
  TTLError,
  TypedS3Client,
  isDefined,
  isValidTTL,
  isValidCacheKey
} from './types';

/**
 * Default no-op callback function
 */
const noop = (): void => {};

/**
 * Placeholder for slashes in cache keys
 */
const SLASH_PLACEHOLDER = '__SLASH__';

/**
 * Type-safe S3Store class for caching operations
 */
export class S3Store<T = unknown> {
  private readonly config: ProcessedS3StoreOptions;
  private readonly s3Client: TypedS3Client;

  /**
   * Creates a new S3Store instance
   * @param options - Configuration options
   * @throws {ConfigurationError} If configuration is invalid
   */
  constructor(options: S3StoreOptions) {
    this.config = this.validateAndProcessOptions(options);
    this.s3Client = this.createS3Client();
  }

  /**
   * Validates and processes configuration options
   * @param options - Raw configuration options
   * @returns Processed configuration
   * @throws {ConfigurationError} If configuration is invalid
   */
  private validateAndProcessOptions(options: S3StoreOptions): ProcessedS3StoreOptions {
    if (!options.bucket || typeof options.bucket !== 'string') {
      throw new ConfigurationError('S3 bucket name is required and must be a string');
    }

    if (options.defaultTtl !== undefined && !isValidTTL(options.defaultTtl)) {
      throw new ConfigurationError('Default TTL must be a positive number or -1 for infinite');
    }

    const processed: ProcessedS3StoreOptions = {
      bucket: options.bucket,
      region: options.region ?? 'us-east-1',
      prefix: options.prefix ?? '',
      defaultTtl: options.defaultTtl ?? 60,
      maxRetries: options.maxRetries ?? 3,
      httpTimeout: options.httpTimeout ?? 30000,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      sessionToken: options.sessionToken,
      storageClass: options.storageClass,
      serverSideEncryption: options.serverSideEncryption,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle
    };

    // Validate credentials if provided
    if (options.accessKeyId && !options.secretAccessKey) {
      throw new ConfigurationError('Secret access key is required when access key ID is provided');
    }

    if (options.secretAccessKey && !options.accessKeyId) {
      throw new ConfigurationError('Access key ID is required when secret access key is provided');
    }

    return processed;
  }

  /**
   * Creates and configures S3 client
   * @returns Configured S3 client
   */
  private createS3Client(): TypedS3Client {
    const clientConfig: {
      region: string;
      maxAttempts: number;
      requestHandler: { requestTimeout: number };
      endpoint?: string;
      forcePathStyle?: boolean;
      credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
      };
    } = {
      region: this.config.region,
      maxAttempts: this.config.maxRetries,
      requestHandler: {
        requestTimeout: this.config.httpTimeout
      }
    };

    // Add LocalStack or custom endpoint support
    if (this.config.endpoint) {
      clientConfig.endpoint = this.config.endpoint;
      clientConfig.forcePathStyle = this.config.forcePathStyle ?? true; // Default to true for LocalStack
    }

    // Add credentials if provided
    if (this.config.accessKeyId && this.config.secretAccessKey) {
      const credentials: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
      } = {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey
      };

      if (this.config.sessionToken) {
        credentials.sessionToken = this.config.sessionToken;
      }

      clientConfig.credentials = credentials;
    }

    const client = new S3Client(clientConfig);

    return {
      client,
      send: client.send.bind(client),
      config: client.config
    };
  }

  /**
   * Formats cache key for S3 storage with proper sanitization
   * @param key - Raw cache key
   * @returns Sanitized S3 key
   */
  private formatKey(key: string): CacheKey {
    if (!isValidCacheKey(key)) {
      throw new ConfigurationError('Cache key must be a non-empty string');
    }

    const keyWithPlaceholders = key.toString().replace(/\//g, SLASH_PLACEHOLDER);
    const sanitized = sanitize(keyWithPlaceholders);
    const encoded = encodeURIComponent(sanitized);
    const withSlashes = encoded.replace(new RegExp(encodeURIComponent(SLASH_PLACEHOLDER), 'g'), '/');

    return `${this.config.prefix}${withSlashes}` as CacheKey;
  }

  /**
   * Checks if cached entry has expired based on metadata
   * @param metadata - S3 object metadata
   * @returns True if expired, false otherwise
   */
  private isExpired(metadata: Record<string, string>): boolean {
    const ttl = metadata['cache-ttl'];
    if (!ttl) {
      return false;
    }

    const expirationTime = parseInt(ttl, 10);
    return !isNaN(expirationTime) && Date.now() > expirationTime;
  }

  /**
   * Converts readable stream to string
   * @param stream - Readable stream
   * @param callback - Callback function
   */
  private streamToString(stream: Readable, callback: StreamCallback): void {
    const chunks: Buffer[] = [];

    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    stream.on('error', (error: Error) => {
      callback(new S3OperationError('Failed to read stream', undefined, error));
    });

    stream.on('end', () => {
      try {
        const result = Buffer.concat(chunks).toString('utf-8');
        callback(null, result);
      } catch (error) {
        callback(new S3OperationError('Failed to convert stream to string', undefined, error as Error));
      }
    });
  }

  /**
   * Retrieves a value from the cache
   * @param key - Cache key
   * @param callback - Callback function
   */
  public get(key: string, callback: GetCallback<T> = noop): void {
    try {
      const s3Key = this.formatKey(key);

      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: s3Key
      });

      this.s3Client.send(command)
        .then((result: GetObjectCommandOutput) => {
          // Check TTL expiration
          if (result.Metadata && this.isExpired(result.Metadata)) {
            // Lazy cleanup - delete expired entry
            this.del(key, () => {
              callback(null, null);
            });
            return;
          }

          // Convert stream to string and parse JSON
          if (result.Body instanceof Readable) {
            this.streamToString(result.Body, (error: Error | null, bodyText?: string) => {
              if (error) {
                callback(error);
                return;
              }

              try {
                const value = JSON.parse(bodyText ?? '') as T;
                callback(null, value);
              } catch (parseError) {
                callback(new SerializationError('Failed to parse cached value', parseError as Error));
              }
            });
          } else {
            callback(new S3OperationError('Unexpected response body format'));
          }
        })
        .catch((error: unknown) => {
          // Handle "key not found" as null value
          const errorObj = error as { name?: string; $metadata?: { httpStatusCode?: number } };
          if (errorObj.name === 'NoSuchKey' || errorObj.$metadata?.httpStatusCode === 404) {
            callback(null, null);
            return;
          }

          callback(new S3OperationError('Failed to retrieve cache entry', errorObj.$metadata?.httpStatusCode, error as Error));
        });
    } catch (error) {
      process.nextTick(() => {
        callback(error as Error);
      });
    }
  }

  /**
   * Stores a value in the cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Time to live in seconds (optional)
   * @param callback - Callback function
   */
  public set(key: string, value: T, ttl?: TTL | SetCallback<T>, callback: SetCallback<T> = noop): void {
    // Handle optional TTL parameter
    let actualTtl: TTL = this.config.defaultTtl;
    let actualCallback: SetCallback<T> = callback;

    if (typeof ttl === 'function') {
      actualCallback = ttl;
      actualTtl = this.config.defaultTtl;
    } else if (ttl !== undefined) {
      if (!isValidTTL(ttl)) {
        process.nextTick(() => {
          actualCallback(new TTLError('TTL must be a positive number or -1 for infinite'));
        });
        return;
      }
      actualTtl = ttl;
    }

    if (value === undefined) {
      process.nextTick(() => {
        actualCallback(new SerializationError('Value cannot be undefined'));
      });
      return;
    }

    try {
      const s3Key = this.formatKey(key);
      const expireAt = actualTtl === -1 ? -1 : Date.now() + (actualTtl * 1000);

      // Serialize value
      let serializedValue: string;
      try {
        serializedValue = JSON.stringify(value);
      } catch (serializeError) {
        process.nextTick(() => {
          actualCallback(new SerializationError('Failed to serialize value', serializeError as Error));
        });
        return;
      }

      // Prepare metadata
      const metadata: CacheMetadata = {
        'cache-created': Date.now().toString(),
        'cache-version': '1.0'
      };

      // Set TTL metadata only if not infinite
      if (expireAt !== -1) {
        metadata['cache-ttl'] = expireAt.toString();
      }

      // Filter out undefined values from metadata for S3 compatibility
      const s3Metadata: Record<string, string> = {};
      Object.entries(metadata).forEach(([key, value]) => {
        if (value !== undefined) {
          s3Metadata[key] = value;
        }
      });

      // Prepare S3 parameters
      const params: PutObjectCommandInput = {
        Bucket: this.config.bucket,
        Key: s3Key,
        Body: serializedValue,
        ContentType: 'application/json',
        Metadata: s3Metadata
      };

      // Add optional S3 configurations
      if (this.config.storageClass) {
        params.StorageClass = this.config.storageClass;
      }

      if (this.config.serverSideEncryption) {
        params.ServerSideEncryption = this.config.serverSideEncryption;
      }

      const command = new PutObjectCommand(params);

      this.s3Client.send(command)
        .then(() => {
          actualCallback(null, value);
        })
        .catch((error: unknown) => {
          const errorObj = error as { $metadata?: { httpStatusCode?: number } };
          actualCallback(new S3OperationError('Failed to store cache entry', errorObj.$metadata?.httpStatusCode, error as Error));
        });
    } catch (error) {
      process.nextTick(() => {
        actualCallback(error as Error);
      });
    }
  }

  /**
   * Deletes a value from the cache
   * @param key - Cache key
   * @param callback - Callback function
   */
  public del(key: string, callback: DeleteCallback = noop): void {
    try {
      const s3Key = this.formatKey(key);

      const command = new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: s3Key
      });

      this.s3Client.send(command)
        .then(() => {
          // S3 delete is idempotent - no error if key doesn't exist
          callback(null);
        })
        .catch((error: unknown) => {
          const errorObj = error as { $metadata?: { httpStatusCode?: number } };
          callback(new S3OperationError('Failed to delete cache entry', errorObj.$metadata?.httpStatusCode, error as Error));
        });
    } catch (error) {
      process.nextTick(() => {
        callback(error as Error);
      });
    }
  }

  /**
   * Clears all cache entries with the configured prefix
   * @param callback - Callback function
   */
  public clear(callback: ClearCallback = noop): void {
    this.listAllObjects((error: Error | null, objects?: Array<{ Key: string }>) => {
      if (error) {
        callback(error);
        return;
      }

      if (!objects || objects.length === 0) {
        callback(null);
        return;
      }

      // Delete objects in batches (S3 limit is 1000 per request)
      const batches = this.chunkArray(objects, 1000);
      let completed = 0;
      let hasError = false;

      batches.forEach((batch) => {
        const command = new DeleteObjectsCommand({
          Bucket: this.config.bucket,
          Delete: {
            Objects: batch.map(obj => ({ Key: obj.Key }))
          }
        });

        this.s3Client.send(command)
          .then(() => {
            if (hasError) {
              return;
            } // Don't continue if already errored

            completed++;
            if (completed === batches.length) {
              callback(null);
            }
          })
          .catch((error: unknown) => {
            if (hasError) {
              return;
            } // Prevent multiple error callbacks
            hasError = true;
            const errorObj = error as { $metadata?: { httpStatusCode?: number } };
            callback(new S3OperationError('Failed to clear cache', errorObj.$metadata?.httpStatusCode, error as Error));
          });
      });
    });
  }

  /**
   * Scans cache entries with optional pattern matching
   * @param pattern - Key pattern (optional)
   * @param limit - Maximum number of results
   * @param callback - Callback function
   */
  public scan(pattern?: string | ScanCallback<T>, limit?: number | ScanCallback<T>, callback?: ScanCallback<T>): void {
    // Handle parameter overloading
    let actualPattern = '';
    let actualLimit = 100;
    let actualCallback: ScanCallback<T> = noop;

    if (typeof pattern === 'function') {
      actualCallback = pattern;
    } else if (typeof limit === 'function') {
      actualPattern = pattern ?? '';
      actualCallback = limit;
    } else if (typeof callback === 'function') {
      actualPattern = pattern ?? '';
      actualLimit = limit ?? 100;
      actualCallback = callback;
    }

    let prefix = this.config.prefix;
    if (actualPattern) {
      const patternWithPlaceholders = actualPattern.replace(/\//g, SLASH_PLACEHOLDER);
      const sanitized = sanitize(patternWithPlaceholders);
      const encoded = encodeURIComponent(sanitized);
      const withSlashes = encoded.replace(new RegExp(encodeURIComponent(SLASH_PLACEHOLDER), 'g'), '/');
      prefix = `${this.config.prefix}${withSlashes}`;
    }

    const command = new ListObjectsV2Command({
      Bucket: this.config.bucket,
      Prefix: prefix,
      MaxKeys: actualLimit
    });

    this.s3Client.send(command)
      .then((result: ListObjectsV2CommandOutput) => {
        const objects = result.Contents ?? [];
        const entries: Array<{ key: string; data: T }> = [];
        let processed = 0;

        if (objects.length === 0) {
          actualCallback(null, { cursor: 0, entries: [] });
          return;
        }

        objects.forEach((obj) => {
          if (!obj.Key) {
            processed++;
            if (processed === objects.length) {
              const cursor = result.IsTruncated ? result.NextContinuationToken ?? 1 : 0;
              actualCallback(null, { cursor, entries });
            }
            return;
          }

          // Extract original key by removing prefix and decoding
          const originalKey = decodeURIComponent(obj.Key.replace(this.config.prefix, ''));

          this.get(originalKey, (error: Error | null, data?: T | null) => {
            processed++;

            if (!error && data !== null && isDefined(data)) {
              entries.push({ key: originalKey, data });
            }

            if (processed === objects.length) {
              const cursor = result.IsTruncated ? result.NextContinuationToken ?? 1 : 0;
              actualCallback(null, { cursor, entries });
            }
          });
        });
      })
      .catch((error: unknown) => {
        const errorObj = error as { $metadata?: { httpStatusCode?: number } };
        actualCallback(new S3OperationError('Failed to scan cache entries', errorObj.$metadata?.httpStatusCode, error as Error));
      });
  }

  /**
   * Performs a health check on the S3 connection
   * @param callback - Callback function
   */
  public healthCheck(callback: HealthCallback = noop): void {
    const command = new HeadBucketCommand({ Bucket: this.config.bucket });

    this.s3Client.send(command)
      .then(() => {
        callback(null, {
          status: 'healthy',
          bucket: this.config.bucket,
          region: this.config.region,
          sdkVersion: 'v3'
        });
      })
      .catch((error: unknown) => {
        const errorObj = error as { message?: string };
        callback(null, {
          status: 'unhealthy',
          bucket: this.config.bucket,
          region: this.config.region,
          sdkVersion: 'v3',
          error: errorObj.message ?? 'Unknown error'
        });
      });
  }

  /**
   * Lists all objects with the configured prefix
   * @param callback - Callback function
   */
  private listAllObjects(callback: (error: Error | null, objects?: Array<{ Key: string }>) => void): void {
    const objects: Array<{ Key: string }> = [];
    let continuationToken: string | undefined;

    const listBatch = (): void => {
      const params: {
        Bucket: string;
        Prefix: string;
        ContinuationToken?: string;
      } = {
        Bucket: this.config.bucket,
        Prefix: this.config.prefix
      };

      if (continuationToken) {
        params.ContinuationToken = continuationToken;
      }

      const command = new ListObjectsV2Command(params);

      this.s3Client.send(command)
        .then((result: ListObjectsV2CommandOutput) => {
          if (result.Contents) {
            objects.push(...result.Contents.map(obj => ({ Key: obj.Key ?? '' })).filter(obj => obj.Key));
          }

          if (result.IsTruncated) {
            continuationToken = result.NextContinuationToken;
            listBatch();
          } else {
            callback(null, objects);
          }
        })
        .catch((error: unknown) => {
          const errorObj = error as { $metadata?: { httpStatusCode?: number } };
          callback(new S3OperationError('Failed to list objects', errorObj.$metadata?.httpStatusCode, error as Error));
        });
    };

    listBatch();
  }

  /**
   * Splits an array into chunks of specified size
   * @param array - Array to chunk
   * @param chunkSize - Size of each chunk
   * @returns Array of chunks
   */
  private chunkArray<U>(array: U[], chunkSize: number): U[][] {
    const chunks: U[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

// Export everything for consumers
export * from './types';
export default S3Store;
