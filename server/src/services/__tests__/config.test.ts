import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ConfigService } from '../config';
import { createBaseApp } from '../../core/base';
import { createMockDB, createMockEnv, cleanupTestDB } from '../../../tests/fixtures';
import { createTestClient } from '../../../tests/test-api-client';
import type { Database } from 'bun:sqlite';

describe('ConfigService', () => {
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
        app.state('cache', {
            get: async () => undefined,
            set: async () => { },
            delete: async () => { },
            deletePrefix: async () => { },
            clear: async () => { },
            getOrSet: async (key: string, fn: Function) => fn(),
            getOrDefault: async (_key: string, defaultValue: any) => defaultValue,
        });
        app.state('serverConfig', {
            get: async (_key: string) => undefined,
            set: async (_key: string, _value: any, _autoSave?: boolean) => { },
            save: async () => { },
            all: async () => [],
            getOrDefault: async (_key: string, defaultValue: any) => defaultValue,
        });
        app.state('clientConfig', {
            get: async (_key: string) => undefined,
            set: async (_key: string, _value: any, _autoSave?: boolean) => { },
            save: async () => { },
            all: async () => [],
            getOrDefault: async (_key: string, defaultValue: any) => defaultValue,
        });

        // Register service
        ConfigService(app);

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

    describe('GET /config/:type - Get config', () => {
        it('should get client config without authentication', async () => {
            const result = await api.config.get('client');

            expect(result.error).toBeUndefined();
            expect(result.data).toBeDefined();
        });

        it('should require authentication for server config', async () => {
            const result = await api.config.get('server');

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(401);
        });

        it('should allow admin to get server config', async () => {
            const result = await api.config.get('server', { token: 'mock_token_1' });

            expect(result.error).toBeUndefined();
            expect(result.data).toBeDefined();
        });

        it('should return 400 for invalid config type', async () => {
            const result = await api.config.get('invalid' as any, { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(400);
        });

        it('should mask sensitive fields in server config', async () => {
            // Set some AI config with API key
            sqlite.exec(`
                INSERT INTO info (key, value) VALUES 
                ('ai_summary.api_key', 'secret_key_123')
            `);

            const result = await api.config.get('server', { token: 'mock_token_1' });

            expect(result.error).toBeUndefined();
            // API key should be masked
            expect(result.data?.['ai_summary.api_key']).toBe('••••••••');
        });
    });

    describe('POST /config/:type - Update config', () => {
        it('should require authentication to update config', async () => {
            const result = await api.config.update('client', {
                'site.name': 'New Name'
            });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(401);
        });

        it('should allow admin to update client config', async () => {
            const result = await api.config.update('client', {
                'site.name': 'New Site Name',
                'site.description': 'New Description'
            }, { token: 'mock_token_1' });

            expect(result.error).toBeUndefined();
        });

        it('should allow admin to update server config', async () => {
            const result = await api.config.update('server', {
                'webhook_url': 'https://example.com/webhook'
            }, { token: 'mock_token_1' });

            expect(result.error).toBeUndefined();
        });

        it('should save AI config to database', async () => {
            const result = await api.config.update('server', {
                'ai_summary.enabled': 'true',
                'ai_summary.provider': 'openai',
                'ai_summary.model': 'gpt-4o-mini'
            }, { token: 'mock_token_1' });

            expect(result.error).toBeUndefined();

            // Verify AI config was saved
            const dbResult = sqlite.prepare("SELECT * FROM info WHERE key LIKE 'ai_summary.%'").all();
            expect(dbResult.length).toBeGreaterThan(0);
        });

        it('should return 400 for invalid config type', async () => {
            const result = await api.config.update('invalid' as any, {
                'key': 'value'
            }, { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(400);
        });
    });

    describe('DELETE /config/cache - Clear cache', () => {
        it('should require authentication to clear cache', async () => {
            const result = await api.config.clearCache();

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(401);
        });

        it('should allow admin to clear cache', async () => {
            const result = await api.config.clearCache({ token: 'mock_token_1' });

            expect(result.error).toBeUndefined();
        });
    });

    describe('POST /config/test-ai - Test AI configuration', () => {
        it('should require authentication to test AI', async () => {
            const result = await api.post('/config/test-ai', {
                provider: 'openai',
                model: 'gpt-4o-mini'
            });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(401);
        });

        it('should allow admin to test AI configuration', async () => {
            // Note: This test may fail if AI service is not available
            // In a real test environment, we would mock the AI service
            const result = await api.post('/config/test-ai', {
                provider: 'openai',
                model: 'gpt-4o-mini',
                api_url: 'https://api.openai.com/v1',
                testPrompt: 'Hello'
            }, { token: 'mock_token_1' });

            // Should either succeed or fail gracefully (not 401)
            expect(result.error?.status).not.toBe(401);
        });
    });
});
