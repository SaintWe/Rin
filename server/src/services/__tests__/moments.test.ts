import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { MomentsService } from '../moments';
import { createBaseApp } from '../../core/base';
import { createMockDB, createMockEnv, cleanupTestDB } from '../../../tests/fixtures';
import { createTestClient } from '../../../tests/test-api-client';
import type { Database } from 'bun:sqlite';

describe('MomentsService', () => {
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
            getOrSet: async (key: string, fn: Function) => fn(),
            getOrDefault: async (_key: string, defaultValue: any) => defaultValue,
        });

        // Register service
        MomentsService(app);

        // Create test API client
        api = createTestClient(app, env);

        // Create test users
        await createTestUsers();
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    async function createTestUsers() {
        // Create admin user (id=1, permission=1)
        sqlite.exec(`
            INSERT INTO users (id, username, openid, avatar, permission) 
            VALUES (1, 'admin', 'gh_admin', 'admin.png', 1)
        `);
        // Create regular user (id=2, permission=0)
        sqlite.exec(`
            INSERT INTO users (id, username, openid, avatar, permission) 
            VALUES (2, 'regular', 'gh_regular', 'regular.png', 0)
        `);
    }

    describe('GET /moments - List moments', () => {
        it('should return empty list when no moments exist', async () => {
            const result = await api.moments.list();

            expect(result.error).toBeUndefined();
            expect(result.data?.data).toEqual([]);
            expect(result.data?.hasNext).toBe(false);
            expect(result.data?.size).toBe(0);
        });

        it('should return paginated moments', async () => {
            // Insert test moments
            sqlite.exec(`
                INSERT INTO moments (id, content, uid, created_at, updated_at) VALUES 
                (1, 'Moment 1', 1, unixepoch(), unixepoch()),
                (2, 'Moment 2', 1, unixepoch(), unixepoch()),
                (3, 'Moment 3', 1, unixepoch(), unixepoch())
            `);

            const result = await api.moments.list({ page: 1, limit: 2 });

            expect(result.error).toBeUndefined();
            expect(result.data?.data.length).toBe(2);
            expect(result.data?.hasNext).toBe(true);
            expect(result.data?.size).toBe(3);
        });

        it('should return cached result if available', async () => {
            const cachedData = {
                size: 1,
                data: [{ id: 1, content: 'Cached Moment', uid: 1, createdAt: Date.now() }],
                hasNext: false
            };

            app.state('cache', {
                get: async () => cachedData,
                set: async () => { },
                delete: async () => { },
                deletePrefix: async () => { },
                getOrSet: async (_key: string, fn: Function) => fn(),
                getOrDefault: async (_key: string, defaultValue: any) => defaultValue,
            });

            const result = await api.moments.list();

            expect(result.error).toBeUndefined();
            expect(result.data?.data[0].content).toBe('Cached Moment');
        });

        it('should limit to maximum 50 items per page', async () => {
            // Insert many moments
            const values = Array.from({ length: 55 }, (_, i) =>
                `(${i + 1}, 'Moment ${i + 1}', 1, unixepoch(), unixepoch())`
            ).join(',');
            sqlite.exec(`INSERT INTO moments (id, content, uid, created_at, updated_at) VALUES ${values}`);

            const result = await api.moments.list({ page: 1, limit: 100 });

            expect(result.error).toBeUndefined();
            expect(result.data?.data.length).toBeLessThanOrEqual(50);
        });

        it('should order moments by createdAt descending', async () => {
            // Insert moments with different timestamps
            sqlite.exec(`
                INSERT INTO moments (id, content, uid, created_at, updated_at) VALUES 
                (1, 'Oldest', 1, unixepoch() - 100, unixepoch()),
                (2, 'Middle', 1, unixepoch() - 50, unixepoch()),
                (3, 'Newest', 1, unixepoch(), unixepoch())
            `);

            const result = await api.moments.list();

            expect(result.error).toBeUndefined();
            expect(result.data?.data[0].content).toBe('Newest');
            expect(result.data?.data[2].content).toBe('Oldest');
        });
    });

    describe('POST /moments - Create moment', () => {
        it('should require authentication', async () => {
            const result = await api.moments.create({
                content: 'Test moment'
            });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(401);
        });

        it('should require admin permission', async () => {
            // Mock JWT for regular user
            app.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => {
                    if (token === 'mock_token_2') return { id: 2 };
                    return null;
                },
            });

            const result = await api.moments.create({
                content: 'Test moment'
            }, { token: 'mock_token_2' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(403);
        });

        it('should allow admin to create moment', async () => {
            const result = await api.moments.create({
                content: 'Test moment content'
            }, { token: 'mock_token_1' });

            expect(result.error).toBeUndefined();
            expect(result.data?.insertedId).toBeDefined();
        });

        it('should require content', async () => {
            const result = await api.moments.create({
                content: ''
            }, { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(400);
        });

        it('should clear cache after creating', async () => {
            let cacheCleared = false;
            app.state('cache', {
                get: async () => undefined,
                set: async () => { },
                delete: async () => { },
                deletePrefix: async (prefix: string) => {
                    if (prefix === 'moments_') cacheCleared = true;
                },
                getOrSet: async (_key: string, fn: Function) => fn(),
                getOrDefault: async (_key: string, defaultValue: any) => defaultValue,
            });

            await api.moments.create({
                content: 'Test moment'
            }, { token: 'mock_token_1' });

            expect(cacheCleared).toBe(true);
        });
    });

    describe('POST /moments/:id - Update moment', () => {
        beforeEach(() => {
            sqlite.exec(`
                INSERT INTO moments (id, content, uid, created_at, updated_at) VALUES 
                (1, 'Original content', 1, unixepoch(), unixepoch())
            `);
        });

        it('should require authentication', async () => {
            const result = await api.moments.update(1, {
                content: 'Updated content'
            });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(401);
        });

        it('should require admin permission', async () => {
            // Mock JWT for regular user
            app.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => {
                    if (token === 'mock_token_2') return { id: 2 };
                    return null;
                },
            });

            const result = await api.moments.update(1, {
                content: 'Updated content'
            }, { token: 'mock_token_2' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(403);
        });

        it('should allow admin to update moment', async () => {
            const result = await api.moments.update(1, {
                content: 'Updated content'
            }, { token: 'mock_token_1' });

            expect(result.error).toBeUndefined();
        });

        it('should return 404 for non-existent moment', async () => {
            const result = await api.moments.update(999, {
                content: 'Updated content'
            }, { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(404);
        });

        it('should require content', async () => {
            const result = await api.moments.update(1, {
                content: ''
            }, { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(400);
        });

        it('should clear cache after updating', async () => {
            let cacheCleared = false;
            app.state('cache', {
                get: async () => undefined,
                set: async () => { },
                delete: async () => { },
                deletePrefix: async (prefix: string) => {
                    if (prefix === 'moments_') cacheCleared = true;
                },
                getOrSet: async (_key: string, fn: Function) => fn(),
                getOrDefault: async (_key: string, defaultValue: any) => defaultValue,
            });

            await api.moments.update(1, {
                content: 'Updated content'
            }, { token: 'mock_token_1' });

            expect(cacheCleared).toBe(true);
        });
    });

    describe('DELETE /moments/:id - Delete moment', () => {
        beforeEach(() => {
            sqlite.exec(`
                INSERT INTO moments (id, content, uid, created_at, updated_at) VALUES 
                (1, 'Moment to delete', 1, unixepoch(), unixepoch())
            `);
        });

        it('should require authentication', async () => {
            const result = await api.moments.delete(1);

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(401);
        });

        it('should require admin permission', async () => {
            // Mock JWT for regular user
            app.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => {
                    if (token === 'mock_token_2') return { id: 2 };
                    return null;
                },
            });

            const result = await api.moments.delete(1, { token: 'mock_token_2' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(403);
        });

        it('should allow admin to delete moment', async () => {
            const result = await api.moments.delete(1, { token: 'mock_token_1' });

            expect(result.error).toBeUndefined();

            // Verify deletion
            const moment = sqlite.prepare('SELECT * FROM moments WHERE id = 1').get();
            expect(moment).toBeNull();
        });

        it('should return 404 for non-existent moment', async () => {
            const result = await api.moments.delete(999, { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(404);
        });

        it('should clear cache after deleting', async () => {
            let cacheCleared = false;
            app.state('cache', {
                get: async () => undefined,
                set: async () => { },
                delete: async () => { },
                deletePrefix: async (prefix: string) => {
                    if (prefix === 'moments_') cacheCleared = true;
                },
                getOrSet: async (_key: string, fn: Function) => fn(),
                getOrDefault: async (_key: string, defaultValue: any) => defaultValue,
            });

            await api.moments.delete(1, { token: 'mock_token_1' });

            expect(cacheCleared).toBe(true);
        });
    });
});
