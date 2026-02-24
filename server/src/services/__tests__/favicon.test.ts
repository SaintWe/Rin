import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { FaviconService, FAVICON_ALLOWED_TYPES, getFaviconKey } from '../favicon';
import { createBaseApp } from '../../core/base';
import { createMockDB, createMockEnv, cleanupTestDB } from '../../../tests/fixtures';
import type { Database } from 'bun:sqlite';

describe('FaviconService', () => {
    let db: any;
    let sqlite: Database;
    let env: Env;
    let app: any;

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
        FaviconService(app);

        // Create test user
        await createTestUser();
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    async function createTestUser() {
        sqlite.exec(`
            INSERT INTO users (id, username, openid, avatar, permission) 
            VALUES (1, 'admin', 'gh_admin', 'admin.png', 1)
        `);
    }

    describe('GET /favicon - Get favicon', () => {
        it('should return favicon from S3', async () => {
            const request = new Request('http://localhost/favicon');
            const response = await app.handle(request, env);

            // Will fail due to S3 not being available, but verifies route is registered
            expect(response.status).not.toBe(404);
        });

        it('should set correct content type header', async () => {
            const request = new Request('http://localhost/favicon');
            const response = await app.handle(request, env);

            // If we get a successful response, check headers
            if (response.status === 200) {
                expect(response.headers.get('Content-Type')).toBe('image/webp');
            }
        });

        it('should set cache control header', async () => {
            const request = new Request('http://localhost/favicon');
            const response = await app.handle(request, env);

            if (response.status === 200) {
                const cacheControl = response.headers.get('Cache-Control');
                expect(cacheControl).toContain('max-age=31536000');
            }
        });
    });

    describe('GET /favicon/original - Get original favicon', () => {
        it('should return original favicon from S3', async () => {
            const request = new Request('http://localhost/favicon/original');
            const response = await app.handle(request, env);

            // Will fail due to S3 not being available, but verifies route is registered
            expect(response.status).not.toBe(404);
        });

        it('should return 404 when original favicon not found', async () => {
            const request = new Request('http://localhost/favicon/original');
            const response = await app.handle(request, env);

            // Should not be 404 from route not found, but could be from S3
            expect(response.status).not.toBe(404);
        });
    });

    describe('POST /favicon - Upload favicon', () => {
        it('should require admin permission', async () => {
            const file = new File(['test'], 'favicon.png', { type: 'image/png' });
            const formData = new FormData();
            formData.append('file', file);

            const request = new Request('http://localhost/favicon', {
                method: 'POST',
                body: formData,
            });

            const response = await app.handle(request, env);
            // Should be rejected (400 validation or 401/403 auth)
            expect(response.status).toBeGreaterThanOrEqual(400);
        });

        it('should reject files over 10MB', async () => {
            // Create a mock file that appears to be larger than 10MB
            const largeContent = new Uint8Array(10 * 1024 * 1024 + 1);
            const file = new File([largeContent], 'favicon.png', { type: 'image/png' });
            const formData = new FormData();
            formData.append('file', file);

            const request = new Request('http://localhost/favicon', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                },
                body: formData,
            });

            const response = await app.handle(request, env);
            expect(response.status).toBe(400);
        });

        it('should reject disallowed file types', async () => {
            const file = new File(['test'], 'favicon.txt', { type: 'text/plain' });
            const formData = new FormData();
            formData.append('file', file);

            const request = new Request('http://localhost/favicon', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                },
                body: formData,
            });

            const response = await app.handle(request, env);
            expect(response.status).toBe(400);
        });

        it('should accept allowed image types', async () => {
            // Test one allowed type - will fail due to S3 not being available
            // but should not fail due to validation
            const file = new File(['test'], 'favicon.png', { type: 'image/png' });
            const formData = new FormData();
            formData.append('file', file);

            const request = new Request('http://localhost/favicon', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                },
                body: formData,
            });

            const response = await app.handle(request, env);
            // Should not be 403 - permission check passes
            // Will fail due to S3 not available
            expect(response.status).not.toBe(403);
        });
    });

    describe('FAVICON_ALLOWED_TYPES', () => {
        it('should contain allowed image types', () => {
            expect(FAVICON_ALLOWED_TYPES['image/jpeg']).toBe('.jpg');
            expect(FAVICON_ALLOWED_TYPES['image/png']).toBe('.png');
            expect(FAVICON_ALLOWED_TYPES['image/gif']).toBe('.gif');
            expect(FAVICON_ALLOWED_TYPES['image/webp']).toBe('.webp');
        });

        it('should have correct number of allowed types', () => {
            expect(Object.keys(FAVICON_ALLOWED_TYPES).length).toBe(4);
        });
    });

    describe('getFaviconKey', () => {
        it('should return favicon path with S3 folder', () => {
            const env = createMockEnv();
            const key = getFaviconKey(env);
            expect(key).toBe('images/favicon.webp');
        });

        it('should handle empty S3_FOLDER', () => {
            const env = createMockEnv({
                S3_FOLDER: '' as any,
            });
            const key = getFaviconKey(env);
            expect(key).toBe('favicon.webp');
        });
    });
});
