import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { FriendService } from '../friends';
import { createBaseApp } from '../../core/base';
import { createMockDB, createMockEnv, cleanupTestDB } from '../../../tests/fixtures';
import { createTestClient } from '../../../tests/test-api-client';
import type { Database } from 'bun:sqlite';

describe('FriendService', () => {
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
            verify: async (token: string) => {
                const match = token.match(/mock_token_(\d+)/);
                return match ? { id: parseInt(match[1]) } : null;
            },
        });
        app.state('cache', {
            get: async () => undefined,
            set: async () => { },
            delete: async () => { },
            deletePrefix: async () => { },
            getOrSet: async (key: string, fn: Function) => fn(),
            getOrDefault: async (_key: string, defaultValue: any) => defaultValue,
        });
        app.state('clientConfig', {
            get: async (_key: string) => undefined,
            set: async (_key: string, _value: any, _autoSave?: boolean) => { },
            save: async () => { },
            all: async () => [],
            getOrDefault: async (_key: string, defaultValue: any) => defaultValue,
        });
        app.state('serverConfig', {
            get: async (_key: string) => undefined,
            set: async (_key: string, _value: any, _autoSave?: boolean) => { },
            save: async () => { },
            all: async () => [],
            getOrDefault: async (_key: string, defaultValue: any) => defaultValue,
        });

        // Register service
        FriendService(app);

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

    describe('GET /friend - List friends', () => {
        it('should return only accepted friends for non-admin', async () => {
            // Insert friends directly
            sqlite.exec(`
                INSERT INTO friends (id, name, desc, avatar, url, uid, accepted, sort_order) VALUES 
                (1, 'Friend 1', 'Desc 1', 'avatar1.png', 'https://friend1.com', 2, 1, 0),
                (2, 'Friend 2', 'Desc 2', 'avatar2.png', 'https://friend2.com', 2, 0, 0)
            `);

            const result = await api.friend.list();

            expect(result.error).toBeUndefined();
            expect(result.data?.friend_list).toBeArray();
            expect(result.data?.friend_list.length).toBe(1);
            expect(result.data?.friend_list[0].name).toBe('Friend 1');
        });

        it('should return all friends for admin', async () => {
            // Insert friends directly
            sqlite.exec(`
                INSERT INTO friends (id, name, desc, avatar, url, uid, accepted, sort_order) VALUES 
                (1, 'Friend 1', 'Desc 1', 'avatar1.png', 'https://friend1.com', 2, 1, 0),
                (2, 'Friend 2', 'Desc 2', 'avatar2.png', 'https://friend2.com', 2, 0, 0)
            `);

            const result = await api.friend.list({ token: 'mock_token_1' });

            expect(result.error).toBeUndefined();
            expect(result.data?.friend_list.length).toBe(2);
        });

        it('should return empty list when no friends exist', async () => {
            const result = await api.friend.list();

            expect(result.error).toBeUndefined();
            expect(result.data?.friend_list).toEqual([]);
        });

        it('should include apply_list for authenticated user', async () => {
            // Insert friend for user 2
            sqlite.exec(`
                INSERT INTO friends (id, name, desc, avatar, url, uid, accepted, sort_order) VALUES 
                (1, 'My Friend', 'Desc', 'avatar.png', 'https://example.com', 2, 0, 0)
            `);

            // Mock JWT to return user 2
            app.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => {
                    if (token === 'mock_token_2') return { id: 2 };
                    return null;
                },
            });

            const result = await api.friend.list({ token: 'mock_token_2' });

            expect(result.error).toBeUndefined();
            expect(result.data?.apply_list).toBeDefined();
        });
    });

    describe('POST /friend - Create friend', () => {
        it('should require authentication', async () => {
            const result = await api.friend.create({
                name: 'New Friend',
                desc: 'Description',
                avatar: 'avatar.png',
                url: 'https://example.com'
            });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(401);
        });

        it('should allow admin to create friend directly', async () => {
            const result = await api.friend.create({
                name: 'New Friend',
                desc: 'Description',
                avatar: 'avatar.png',
                url: 'https://example.com'
            }, { token: 'mock_token_1' });

            expect(result.error).toBeUndefined();
        });

        it('should reject when friend apply is disabled', async () => {
            // Mock clientConfig to return false for friend_apply_enable
            app.state('clientConfig', {
                get: async (key: string) => key === 'friend_apply_enable' ? false : undefined,
                set: async () => { },
                save: async () => { },
                all: async () => [],
                getOrDefault: async (key: string, defaultValue: any) =>
                    key === 'friend_apply_enable' ? false : defaultValue,
            });

            const result = await api.friend.create({
                name: 'New Friend',
                desc: 'Description',
                avatar: 'avatar.png',
                url: 'https://example.com'
            }, { token: 'mock_token_2' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(403);
        });

        it('should validate input length', async () => {
            const result = await api.friend.create({
                name: 'a'.repeat(21), // Too long
                desc: 'Description',
                avatar: 'avatar.png',
                url: 'https://example.com'
            }, { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(400);
        });

        it('should require all fields', async () => {
            const result = await api.friend.create({
                name: '',
                desc: '',
                avatar: '',
                url: ''
            }, { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(400);
        });

        it('should prevent duplicate friend request from same user', async () => {
            // First create a friend
            sqlite.exec(`
                INSERT INTO friends (id, name, desc, avatar, url, uid, accepted) VALUES 
                (1, 'Existing Friend', 'Desc', 'avatar.png', 'https://example.com', 2, 0)
            `);

            // Mock JWT for user 2
            app.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => {
                    if (token === 'mock_token_2') return { id: 2 };
                    return null;
                },
            });

            const result = await api.friend.create({
                name: 'Another Friend',
                desc: 'Description',
                avatar: 'avatar.png',
                url: 'https://example2.com'
            }, { token: 'mock_token_2' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(400);
        });
    });

    describe('PUT /friend/:id - Update friend', () => {
        beforeEach(() => {
            sqlite.exec(`
                INSERT INTO friends (id, name, desc, avatar, url, uid, accepted, sort_order) VALUES 
                (1, 'Original Name', 'Original Desc', 'avatar.png', 'https://example.com', 2, 0, 0)
            `);
        });

        it('should require authentication', async () => {
            const result = await api.friend.update(1, {
                name: 'Updated Name',
                desc: 'Updated Desc',
                url: 'https://example.com'
            });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(401);
        });

        it('should allow admin to update any friend', async () => {
            const result = await api.friend.update(1, {
                name: 'Updated Name',
                desc: 'Updated Desc',
                url: 'https://new-example.com',
                accepted: 1
            }, { token: 'mock_token_1' });

            expect(result.error).toBeUndefined();
        });

        it('should allow user to update their own friend', async () => {
            // Mock JWT for user 2
            app.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => {
                    if (token === 'mock_token_2') return { id: 2 };
                    return null;
                },
            });

            const result = await api.friend.update(1, {
                name: 'Updated Name',
                desc: 'Updated Desc',
                url: 'https://example.com'
            }, { token: 'mock_token_2' });

            expect(result.error).toBeUndefined();
        });

        it('should not allow user to update others friend', async () => {
            // Create another user and friend
            sqlite.exec(`
                INSERT INTO users (id, username, openid, avatar, permission) 
                VALUES (3, 'other', 'gh_other', 'other.png', 0)
            `);

            // Mock JWT for user 3
            app.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => {
                    if (token === 'mock_token_3') return { id: 3 };
                    return null;
                },
            });

            const result = await api.friend.update(1, {
                name: 'Updated Name',
                desc: 'Updated Desc',
                url: 'https://example.com'
            }, { token: 'mock_token_3' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(403);
        });

        it('should return 404 for non-existent friend', async () => {
            const result = await api.friend.update(999, {
                name: 'Updated Name',
                desc: 'Updated Desc',
                url: 'https://example.com'
            }, { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(404);
        });

        it('should reset accepted status for non-admin updates', async () => {
            // First set friend as accepted by admin
            sqlite.exec(`UPDATE friends SET accepted = 1 WHERE id = 1`);

            // Mock JWT for user 2
            app.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => {
                    if (token === 'mock_token_2') return { id: 2 };
                    return null;
                },
            });

            // User updates their friend
            await api.friend.update(1, {
                name: 'Updated Name',
                desc: 'Updated Desc',
                url: 'https://example.com'
            }, { token: 'mock_token_2' });

            // Verify accepted was reset to 0
            const friend = sqlite.prepare('SELECT * FROM friends WHERE id = 1').get() as any;
            expect(friend.accepted).toBe(0);
        });
    });

    describe('DELETE /friend/:id - Delete friend', () => {
        beforeEach(() => {
            sqlite.exec(`
                INSERT INTO friends (id, name, desc, avatar, url, uid, accepted) VALUES 
                (1, 'Friend Name', 'Desc', 'avatar.png', 'https://example.com', 2, 1)
            `);
        });

        it('should require authentication', async () => {
            const result = await api.friend.delete(1);

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(401);
        });

        it('should allow admin to delete any friend', async () => {
            const result = await api.friend.delete(1, { token: 'mock_token_1' });

            expect(result.error).toBeUndefined();

            // Verify deletion
            const friend = sqlite.prepare('SELECT * FROM friends WHERE id = 1').get();
            expect(friend).toBeNull();
        });

        it('should allow user to delete their own friend', async () => {
            // Mock JWT for user 2
            app.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => {
                    if (token === 'mock_token_2') return { id: 2 };
                    return null;
                },
            });

            const result = await api.friend.delete(1, { token: 'mock_token_2' });

            expect(result.error).toBeUndefined();
        });

        it('should not allow user to delete others friend', async () => {
            // Create another user
            sqlite.exec(`
                INSERT INTO users (id, username, openid, avatar, permission) 
                VALUES (3, 'other', 'gh_other', 'other.png', 0)
            `);

            // Mock JWT for user 3
            app.state('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => {
                    if (token === 'mock_token_3') return { id: 3 };
                    return null;
                },
            });

            const result = await api.friend.delete(1, { token: 'mock_token_3' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(403);
        });

        it('should return 404 for non-existent friend', async () => {
            const result = await api.friend.delete(999, { token: 'mock_token_1' });

            expect(result.error).toBeDefined();
            expect(result.error?.status).toBe(404);
        });
    });
});
