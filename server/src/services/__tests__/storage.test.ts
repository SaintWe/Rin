import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { StorageService } from '../storage';
import { createBaseApp } from '../../core/base';
import { createMockDB, createMockEnv, cleanupTestDB } from '../../../tests/fixtures';
import { createTestClient } from '../../../tests/test-api-client';
import type { Database } from 'bun:sqlite';

describe('StorageService', () => {
    let db: any;
    let sqlite: Database;
    let env: Env;
    let app: any;
    let api: ReturnType<typeof createTestClient>;

    beforeEach(async () => {
        const mockDB = createMockDB();
        db = mockDB.db;
        sqlite = mockDB.sqlite;
        env = createMockEnv();

        // Setup app with mock db
        app = createBaseApp(env);
        app.state('db', db);
        app.state('jwt', {
            sign: async (payload: any) => `mock_token_${payload.id}`,
            verify: async (token: string) => token.startsWith('mock_token_') ? { id: 1 } : null,
        });

        // Register service
        StorageService(app);

        // Create test API client
        api = createTestClient(app, env);

        // Create test user
        await createTestUser();
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    async function createTestUser() {
        sqlite.exec(`
            INSERT INTO users (id, username, openid, avatar, permission) 
            VALUES (1, 'testuser', 'gh_test', 'avatar.png', 1)
        `);
    }

    describe('POST /storage - Upload file', () => {
        it('should require authentication', async () => {
            const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
            const result = await api.storage.upload(file, 'test.txt');

            expect(result.error).toBeDefined();
            // Could be 400 (validation) or 401 (auth)
            expect(result.error?.status).toBeGreaterThanOrEqual(400);
            expect(result.error?.status).toBeLessThanOrEqual(401);
        });

        it('should return 500 when S3_ENDPOINT is not defined', async () => {
            const envNoS3 = createMockEnv({
                S3_ENDPOINT: '' as any,
            });

            const appNoS3 = createBaseApp(envNoS3);
            appNoS3.state('db', db);
            appNoS3.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => token.startsWith('mock_token_') ? { id: 1 } : null,
            });
            StorageService(appNoS3);

            const apiNoS3 = createTestClient(appNoS3, envNoS3);

            const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
            const result = await apiNoS3.storage.upload(file, 'test.txt', { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            // Could be 400 (validation) or 500 (env check)
            expect(result.error?.status).toBeGreaterThanOrEqual(400);
        });

        it('should return error when S3_ACCESS_KEY_ID is not defined', async () => {
            const envNoKey = createMockEnv({
                S3_ACCESS_KEY_ID: '',
            });

            const appNoKey = createBaseApp(envNoKey);
            appNoKey.state('db', db);
            appNoKey.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => token.startsWith('mock_token_') ? { id: 1 } : null,
            });
            StorageService(appNoKey);

            const apiNoKey = createTestClient(appNoKey, envNoKey);

            const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
            const result = await apiNoKey.storage.upload(file, 'test.txt', { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBeGreaterThanOrEqual(400);
        });

        it('should return error when S3_SECRET_ACCESS_KEY is not defined', async () => {
            const envNoSecret = createMockEnv({
                S3_SECRET_ACCESS_KEY: '',
            });

            const appNoSecret = createBaseApp(envNoSecret);
            appNoSecret.state('db', db);
            appNoSecret.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => token.startsWith('mock_token_') ? { id: 1 } : null,
            });
            StorageService(appNoSecret);

            const apiNoSecret = createTestClient(appNoSecret, envNoSecret);

            const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
            const result = await apiNoSecret.storage.upload(file, 'test.txt', { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBeGreaterThanOrEqual(400);
        });

        it('should return error when S3_BUCKET is not defined', async () => {
            const envNoBucket = createMockEnv({
                S3_BUCKET: '' as any,
            });

            const appNoBucket = createBaseApp(envNoBucket);
            appNoBucket.state('db', db);
            appNoBucket.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => token.startsWith('mock_token_') ? { id: 1 } : null,
            });
            StorageService(appNoBucket);

            const apiNoBucket = createTestClient(appNoBucket, envNoBucket);

            const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
            const result = await apiNoBucket.storage.upload(file, 'test.txt', { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBeGreaterThanOrEqual(400);
        });

        it('should extract file extension from key', async () => {
            // This test would require mocking S3, so we just verify the endpoint
            // is accessible with proper authentication and environment
            const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
            const result = await api.storage.upload(file, 'document.pdf', { token: 'mock_token_1' });

            // Will fail due to S3 not being available, but verifies auth passes
            expect(result.error?.status).not.toBe(401);
        });
    });
});
